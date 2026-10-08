import express from 'express';
import qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import makeWASocket, { useMultiFileAuthState, downloadMediaMessage, normalizeMessageContent } from '@whiskeysockets/baileys';
import pino from 'pino';

// Architecture Modules
import IntentClassifier from './intent-classifier.js';
import BotRouter from './bot-router.js';
import ContextManager from './context-manager.js';
import ResponseGenerator from './response-generator.js';
import { CONTACTS, LINKS } from './contacts.js';
import { PROTOCOLS, SYSTEM_PROMPT } from './protocols.js';
import {
  ALWAYS_ACTIVE_PHONE_NUMBERS,
  ALWAYS_PAUSED_PHONE_NUMBERS,
  isAlwaysActivePhone,
  isAlwaysPausedPhone,
  shouldPausePhone
} from './always-paused-phones.js';
import { getWeekendPeriodKey, WEEKEND_UNAVAILABLE_MESSAGE } from './service-schedule.js';
import { JsonStore } from './json-store.js';
import { ChatStore } from './chat-store.js';
import { MessageQueue } from './message-queue.js';
import { QrConnection } from './qr-connection.js';
import { installSecurity } from './admin-security.js';
import { localParts, validateBookingConfig, validateAppointment } from './booking.js';
import { completionBody } from './ai-request.js';
import { CustomerMemory, MEMORY_FIELDS } from './customer-memory.js';
import { RagRetriever } from './rag-retriever.js';
import { GroundedAssistant } from './grounded-assistant.js';
import { AssistantSettings, LIMIT_FIELDS, revisionOf } from './assistant-settings.js';

const app = express();
app.use(express.json({ limit: '256kb' }));
installSecurity(app);
const jsonStore = new JsonStore();
const incomingQueue = new MessageQueue();

const PORT = process.env.WP_PORT || 3001;
const AUTH_DIR = path.join(process.cwd(), 'auth_info_baileys');
const DATA_DIR = path.resolve(process.env.BOT_DATA_DIR || 'server');
fs.mkdirSync(DATA_DIR, { recursive: true });

function ensureDataFile(filename, defaultValue) {
  const dataFile = path.join(DATA_DIR, filename);
  if (!fs.existsSync(dataFile)) {
    const seedFile = path.resolve('server', filename);
    if (process.env.BOT_TEST_MODE !== 'true' && DATA_DIR !== path.resolve('server') && fs.existsSync(seedFile)) {
      fs.copyFileSync(seedFile, dataFile);
    } else {
      fs.writeFileSync(dataFile, JSON.stringify(defaultValue, null, 2), 'utf8');
    }
  }
  return dataFile;
}

// JSON Persistence Files
const CUSTOMERS_FILE = ensureDataFile('customers.json', []);
const OPERATORS_FILE = ensureDataFile('operators.json', []);
const APPOINTMENTS_FILE = ensureDataFile('appointments.json', []);
const APPOINTMENTS_CONFIG_FILE = ensureDataFile('appointments-config.json', {});
const KNOWLEDGE_BASE_FILE = ensureDataFile('knowledge_base.json', []);

// Global status variables
let currentQrDataUrl = null;
let connectionStatus = 'DISCONNECTED'; // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTED'
let connectedUserPhone = null;
let isBotPaused = false; // Global pause toggle
let sock = null;
const chatStore = new ChatStore(jsonStore, DATA_DIR);
const liveServerLogs = chatStore.logs;
const botSentMessageIds = new Map();
const HUMAN_TAKEOVERS_FILE = ensureDataFile('human-takeovers.json', {});
const humanTakeovers = new Map(Object.entries(readJsonFile(HUMAN_TAKEOVERS_FILE, {})).map(([chatId, value]) => [
  chatId,
  typeof value === 'string' ? { pauseReason: value, phone: null } : value
]));

// In-Memory Live Chats database
const activeChats = chatStore.chats;
const SETTINGS_FILE = ensureDataFile('runtime-config.json', {});
const CONTEXTS_FILE = ensureDataFile('conversation-states.json', {});
const runtimeSettings = readJsonFile(SETTINGS_FILE, {});
ContextManager.restore(readJsonFile(CONTEXTS_FILE, {}));
const assistantSettings = new AssistantSettings(jsonStore, DATA_DIR);
const initialAssistantSettings = assistantSettings.get();
const customerMemory = new CustomerMemory(jsonStore, DATA_DIR, { ...initialAssistantSettings.limits, ttlDays: initialAssistantSettings.limits.memoryDays, enabled: initialAssistantSettings.memoryEnabled });
ContextManager.setMemoryObserver((chatId, text, history) => {
  customerMemory.observe(chatId, text, activeChats[chatId]?.messages.at(-1)?.id, history);
});

const OPENAI_ORG_ID = process.env.OPENAI_ORG_ID || '';
let OPENAI_API_KEY = runtimeSettings.apiKey || process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
let currentModelName = runtimeSettings.model || process.env.OPENAI_MODEL || 'gpt-5.6-luna';
let currentTemperature = runtimeSettings.temperature ?? 0.5;
let currentMaxTokens = runtimeSettings.maxTokens ?? 300;
let customWhisperApiKey = runtimeSettings.whisperApiKey || process.env.WHISPER_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
if (!OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY no está configurada; las respuestas dependerán del fallback del bot.');
}

// System Prompt
let customWpSystemPrompt = runtimeSettings.wpSystemPrompt || SYSTEM_PROMPT;
let assistantSystemPrompt = runtimeSettings.assistantSystemPrompt || SYSTEM_PROMPT;
isBotPaused = runtimeSettings.paused ?? false;
for (const [collection, values] of [[CONTACTS, runtimeSettings.contacts], [PROTOCOLS, runtimeSettings.protocols], [LINKS, runtimeSettings.links]]) {
  for (const [id, value] of Object.entries(values || {})) if (Object.hasOwn(collection, id)) {
    if (typeof collection[id] === 'object' && collection[id] && value && typeof value === 'object') {
      for (const [key, stored] of Object.entries(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(collection[id], key);
        if (descriptor && (descriptor.writable || descriptor.set) && typeof collection[id][key] !== 'function') collection[id][key] = stored;
      }
    }
    else collection[id] = value;
  }
}
function persistSettings() {
  Object.assign(runtimeSettings, {
    apiKey: OPENAI_API_KEY, whisperApiKey: customWhisperApiKey, model: currentModelName,
    temperature: currentTemperature, maxTokens: currentMaxTokens, wpSystemPrompt: customWpSystemPrompt,
    assistantSystemPrompt, paused: isBotPaused, contacts: CONTACTS, protocols: PROTOCOLS, links: LINKS
  });
  writeJsonFile(SETTINGS_FILE, JSON.parse(JSON.stringify(runtimeSettings)));
}
function flushChats() {
  customerMemory.flush();
  if (!chatStore.dirty) return;
  chatStore.flush();
  ContextManager.retain(Object.keys(activeChats));
  writeJsonFile(CONTEXTS_FILE, ContextManager.snapshot());
}
const stateFlushTimer = setInterval(() => { try { flushChats(); } catch (err) { console.error('No se pudo guardar el historial:', err.message); } }, 5000);
stateFlushTimer.unref();

// Inactivity timeout manager (5 minutes = 300,000 ms)
const inactivityTimers = {};
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

function resetInactivityTimeout(chatId, channelType = 'whatsapp') {
  if (inactivityTimers[chatId]) {
    clearTimeout(inactivityTimers[chatId]);
    delete inactivityTimers[chatId];
  }

  inactivityTimers[chatId] = setTimeout(async () => {
    try {
      const chat = activeChats[chatId];
      if (chat && !chat.botPaused && !isBotPaused && !chat.closed) {
        const farewellMessage = `¡Gracias por comunicarte con AITUE! 🛰️ Cuando quieras continuar con tu consulta, estamos para ayudarte. Te invitamos a seguir conectados y acompañarnos en nuestras redes sociales oficiales para conocer nuestras nuevas soluciones, novedades, innovaciones y próximos lanzamientos. Si ves el cielo, estamos. 📡\n\nPodés seguirnos en nuestras redes sociales oficiales:\n🌐 Web: ${LINKS.web}\n🛒 Tienda: ${LINKS.shop}\n🔵 Facebook: ${LINKS.facebook}\n📸 Instagram: ${LINKS.instagram}\n💼 LinkedIn: ${LINKS.linkedin}`;

        chat.messages.push({
          id: randomBytes(12).toString('hex'),
          sender: 'bot',
          text: farewellMessage,
          timestamp: new Date().toISOString()
        });

        if (channelType === 'whatsapp' && sock && connectionStatus === 'CONNECTED') {
          await sock.sendMessage(chatId, { text: farewellMessage });
        }
      }
    } catch (err) {
      console.error(`Error enviando despedida por inactividad a ${chatId}:`, err.message);
    } finally {
      delete inactivityTimers[chatId];
    }
  }, INACTIVITY_TIMEOUT_MS);
}

let serverKnowledgeBase = [];

// Helper to load/save JSON safely
function readJsonFile(file, defaultValue = []) { return jsonStore.read(file, defaultValue); }
function writeJsonFile(file, data) { jsonStore.write(file, data); }

function persistHumanTakeovers() {
  writeJsonFile(HUMAN_TAKEOVERS_FILE, Object.fromEntries(humanTakeovers));
}

function getPhoneFromJid(jid) {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
  const phone = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return phone || null;
}

function isInternationalPhoneNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 8 && !digits.startsWith('54');
}

function getCustomerPhoneFromMessage(message, fallback = null) {
  const messagePhone = [
    message?.key?.remoteJidAlt,
    message?.key?.participantAlt,
    message?.key?.remoteJid
  ].map(getPhoneFromJid).find(Boolean);
  if (messagePhone) return `+${messagePhone}`;

  const fallbackDigits = String(fallback || '').replace(/\D/g, '');
  return fallbackDigits.length >= 8 ? `+${fallbackDigits}` : null;
}

function getOwnWhatsAppJids() {
  return [sock?.user?.id, sock?.user?.lid]
    .filter(Boolean)
    .map(jid => jid.toLowerCase().replace(/:\d+(?=@)/, ''));
}

function isOwnWhatsAppChat(chatId) {
  const normalizedJid = chatId.toLowerCase().replace(/:\d+(?=@)/, '');
  if (getOwnWhatsAppJids().includes(normalizedJid)) return true;

  const ownPhone = connectedUserPhone?.replace(/\D/g, '');
  return Boolean(ownPhone && getPhoneFromJid(chatId) === ownPhone);
}

function markChatTakenOver(chatId, chat, phone = null) {
  const customerPhone = phone || chat.phone || getPhoneFromJid(chatId);
  chat.phone = customerPhone;
  setChatBotPaused(chatId, chat, true, 'human');
}

async function markWhatsAppChatUnread(chatId, message) {
  try {
    await sock.chatModify({
      markRead: false,
      lastMessages: [{
        key: message.key,
        messageTimestamp: Number(message.messageTimestamp || Math.floor(Date.now() / 1000))
      }]
    }, chatId);
  } catch (err) {
    console.error(`[WHATSAPP UNREAD ERROR] No se pudo marcar ${chatId} como no leído:`, err.message || err);
  }
}

function setChatBotPaused(chatId, chat, paused, pauseReason = 'manual') {
  const phone = chat.phone || getPhoneFromJid(chatId);
  const permanentlyActive = isAlwaysActivePhone(phone);
  const permanentlyPaused = !permanentlyActive && isAlwaysPausedPhone(phone);
  const effectivePaused = shouldPausePhone(phone, paused);
  const effectivePauseReason = permanentlyPaused ? 'always' : pauseReason;
  chat.botPaused = effectivePaused;
  chat.pauseReason = effectivePaused ? effectivePauseReason : null;
  if (effectivePaused) {
    humanTakeovers.set(chatId, { pauseReason: effectivePauseReason, phone });
  } else {
    humanTakeovers.delete(chatId);
  }
  persistHumanTakeovers();
}

function resumeChatBot(chatId, chat) {
  if (shouldPausePhone(chat.phone || getPhoneFromJid(chatId), false)) {
    setChatBotPaused(chatId, chat, true, 'always');
    return false;
  }
  chat.botPaused = false;
  chat.pauseReason = null;
  humanTakeovers.delete(chatId);
  persistHumanTakeovers();
  return true;
}

function findPausedChat(target) {
  const normalizedTarget = target.toLowerCase();
  const targetPhone = target.replace(/\D/g, '');
  const chatIds = new Set([...humanTakeovers.keys(), ...Object.keys(activeChats)]);

  for (const chatId of chatIds) {
    const chat = activeChats[chatId];
    if (normalizedTarget.includes('@')) {
      if (chatId.toLowerCase() === normalizedTarget) return chatId;
      continue;
    }

    const savedPhone = humanTakeovers.get(chatId)?.phone?.replace(/\D/g, '');
    const chatPhone = chat?.phone?.replace(/\D/g, '') || getPhoneFromJid(chatId);
    if (targetPhone && (savedPhone === targetPhone || chatPhone === targetPhone)) return chatId;
  }

  return null;
}

// Load configurations and knowledge
function initData() {
  serverKnowledgeBase = readJsonFile(KNOWLEDGE_BASE_FILE, []);
  if (!serverKnowledgeBase.length) {
    serverKnowledgeBase = [
      { id: 'kb_0', category: 'Protocolos & Identidad', title: 'Identidad y Firma Corporativa', content: 'AITUE COMUNICA S.A. Firma: "Si ves el cielo, estamos." Soluciones satelitales 360.' }
    ];
  }
}
initData();

// Get active config parameters
function getBookingConfig() {
  return { workDays: [1, 2, 3, 4, 5], openTime: '09:00', closeTime: '18:30', durationMin: 30,
    minAdvanceHours: 2, maxConcurrent: 1, blockedDates: [], operatorAvailable: true,
    ...readJsonFile(APPOINTMENTS_CONFIG_FILE, {}) };
}

// Calculate dynamic slots
function getAvailableSlots() {
  const config = validateBookingConfig(getBookingConfig());
  const appointments = readJsonFile(APPOINTMENTS_FILE);
  const now = new Date();
  const today = localParts(now).date;
  const result = [];
  const [h, m] = config.openTime.split(':').map(Number);
  const [endH, endM] = config.closeTime.split(':').map(Number);
  for (let d = 0; d < 7 && result.length < 8; d++) {
    const date = new Date(today + 'T12:00:00-03:00');
    date.setUTCDate(date.getUTCDate() + d);
    const dateStr = localParts(date).date;
    for (let minute = h * 60 + m; minute + config.durationMin <= endH * 60 + endM && result.length < 8; minute += config.durationMin) {
      const slot = dateStr + 'T' + String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
      try { validateAppointment(slot, appointments, config, now); result.push(slot); } catch {}
    }
  }
  return result;
}

// Retrieval is local and reads the existing knowledge without rewriting its contents.
const ragRetriever = new RagRetriever(() => serverKnowledgeBase, { maxFragments: initialAssistantSettings.limits.ragFragments, maxCharacters: initialAssistantSettings.limits.ragCharacters });
const groundedAssistant = new GroundedAssistant({
  memory: customerMemory, retriever: ragRetriever,
  getSettings: () => assistantSettings.get(),
  canRespond: chatId => !isBotPaused && !activeChats[chatId]?.botPaused && !activeChats[chatId]?.closed,
  allowedContacts: () => JSON.stringify([CONTACTS, LINKS]),
  onAudit: (chatId, audit) => { if (activeChats[chatId]) activeChats[chatId].lastAiAudit = audit; }
});

// Transcribe note of voice
async function transcribeAudioBuffer(audioBuffer) {
  const keyToUse = customWhisperApiKey || process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!keyToUse) return null;

  const isGroq = keyToUse.trim().startsWith('gsk_') || keyToUse.trim().startsWith('key_');
  const endpoint = isGroq
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';
  const modelName = isGroq ? 'whisper-large-v3' : 'whisper-1';

  try {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
    formData.append('file', blob, 'whatsapp_voice.ogg');
    formData.append('model', modelName);
    formData.append('language', 'es');

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyToUse.trim()}`
      },
      body: formData
    });

    if (res.ok) {
      const data = await res.json();
      return data.text || null;
    }
  } catch (e) {
    console.error('Error procesando nota de voz:', e.message);
  }
  return null;
}

// Vision IA Analysis
async function analyzeImageBuffer(imageBuffer) {
  const keyToUse = OPENAI_API_KEY;
  if (!keyToUse) return "No hay Clave de IA configurada para analizar imágenes.";

  try {
    const base64Image = imageBuffer.toString('base64');

    const isNv = keyToUse.startsWith('nvapi-');
    const endpoint = isNv
      ? 'https://integrate.api.nvidia.com/v1/chat/completions'
      : `${OPENAI_BASE_URL}/chat/completions`;
    const model = isNv ? 'nvidia/neva-22b' : currentModelName;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keyToUse.trim()}`
      },
      body: JSON.stringify(completionBody({
        model: model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Eres un ingeniero técnico de AITUE COMUNICA S.A. Analiza esta imagen de una instalación o equipo Starlink / conectividad. Haz un diagnóstico rápido y profesional de la alineación, cables, montaje o gabinetes e indica si todo está correcto o si hay algún problema visible." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ]
          }
        ],
        maxTokens: 250,
        isNvidia: isNv
      })),
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const data = await res.json();
      return data.choices[0]?.message?.content || "No se pudo extraer análisis de la imagen.";
    } else {
      const err = await res.json().catch(() => ({}));
      console.error('Error en Visión IA:', err);
    }
  } catch (e) {
    console.error('Error en análisis de imagen:', e.message);
  }
  return "Por favor, escribí tu consulta o describí el contenido por texto para que podamos ayudarte.";
}

// Generate Chat Response using Modular Architecture (Intent -> Router -> Response Generator)
async function generateOpenAIResponse(chatId, userText) {
  const state = ContextManager.getState(chatId);
  const chat = activeChats[chatId];
  const history = chat ? chat.messages : [];
  const customerPhone = chat?.phone || getPhoneFromJid(chatId);
  state.isInternationalNumber = isInternationalPhoneNumber(customerPhone);

  // 1. Clasificación semántica de la intención
  const classification = IntentClassifier.classify(userText, state);

  // 2. Decisión del Backend (Router Central de Derivaciones)
  const routeResult = BotRouter.route(classification, state);
  routeResult.customerPhone = chat?.phone || getPhoneFromJid(chatId);
  if (state.pendingCommercialAdviceConfirmation) {
    ContextManager.updateState(chatId, { pendingCommercialAdviceConfirmation: false });
  }

  ContextManager.setClassificationResult(chatId, classification);
  if (BotRouter.isEmailOnlyHandoff(routeResult)) {
    return BotRouter.formatCustomerHandoffResponse(routeResult);
  }

  if (BotRouter.isCustomerHandoff(routeResult)) {
    return BotRouter.formatCustomerHandoffResponse(routeResult);
  }

  // Si es un protocolo fijo (Bienvenida, Segundo Saludo, Despedida, Redes, Derivación Internet Soporte) o Fallback directo, responder inmediatamente sin gastar tokens
  if (routeResult.action === 'SEND_WELCOME_PROTOCOL' ||
      routeResult.action === 'SEND_SECOND_GREETING_PROTOCOL' ||
      routeResult.action === 'SEND_FAREWELL_PROTOCOL' ||
      routeResult.action === 'SEND_REDES_INFO' ||
      routeResult.action === 'SEND_PRODUCT_CATALOG' ||
      routeResult.action === 'SEND_PRODUCT_ADVICE' ||
      routeResult.action === 'SEND_COMMERCIAL_HANDOFF' ||
      routeResult.action === 'SEND_PRODUCT_DETAIL_CLARIFICATION' ||
      routeResult.action === 'SEND_FAQ_ENVIOS' ||
      routeResult.action === 'DERIVE_TO_INTERNET_SUPPORT' ||
      routeResult.action === 'PAUSE_BOT' ||
      classification.primary_area === 'PRODUCTO_INFO') {
    return ResponseGenerator.formatResponse(chatId, classification, routeResult, userText);
  }

  const fallback = ResponseGenerator.formatResponse(chatId, classification, routeResult, userText);
  return groundedAssistant.answer({
    chatId, userText, history, sourceId: history.at(-1)?.id,
    systemPrompt: chat?.type === 'web' ? assistantSystemPrompt : customWpSystemPrompt,
    route: routeResult, fallback, apiKey: OPENAI_API_KEY, model: currentModelName,
    maxTokens: currentMaxTokens, temperature: currentTemperature, organizationId: OPENAI_ORG_ID
  });
}

// Limpiador automático de contactos duplicados, asteriscos y notas parentéticas de backend
function cleanDuplicateContactsAndFillers(rawText) {
  if (!rawText) return rawText;
  let text = rawText.trim();

  // Eliminar notas parentéticas e indicaciones explícitas como (como V2)
  text = text.replace(/\s*\(\s*como V2\s*\)/gi, '');
  text = text.replace(/\s*\(como V2\)/gi, '');
  text = text.replace(/\s*\(\s*como V2 o consultas de stock\s*\)/gi, '');
  text = text.replace(/\s*\(\s*Una sola vez por conversación\s*\)/gi, '');
  text = text.replace(/\s*\(\s*Una sola vez por respuesta\s*\)/gi, '');
  text = text.replace(/\s*\(\s*Una sola vez\s*\)/gi, '');
  text = text.replace(/\s*\(\s*Atención 24\/7\s*\)/gi, ' — Atención 24/7');
  text = text.replace(/\s*\(\s*Lun-Vie 09:00 a 18:00 hs AR\s*\)/gi, ' — Lunes a viernes, 09:00 a 18:00 hs AR');
  text = text.replace(/\s*\(\s*Lunes a viernes, de 09:00 a 18:00 hs AR\s*\)/gi, ' — Lunes a viernes, 09:00 a 18:00 hs AR');
  text = text.replace(/\s*\*\s*\(\s*Si ya realizaste la contratación.*?\)\s*\*/gi, '');
  text = text.replace(/\s*\(\s*Si ya realizaste la contratación.*?\)/gi, '');
  text = text.replace(/\s*\(\s*Regla obligatoria.*?\)/gi, '');
  text = text.replace(/\s*\(\s*Nota interna.*?\)/gi, '');

  // Eliminar todos los asteriscos (*) de formato en la respuesta
  text = text.replace(/\*/g, '');

  // Deduplicar contacto de Gerencia Comercial si aparece más de una vez
  const comercialMatches = text.match(/comercial@aitue\.net/gi);
  if (comercialMatches && comercialMatches.length > 1) {
    const comercialBlock = `💼 Gerencia Comercial\n📧 comercial@aitue.net | 📞 +54 9 11 4164-0955 — Atención 24/7`;
    text = text.replace(/(?:(?:•|\*|-)?\s*Gerencia Comercial[^\n]*\n?|💼[^\n]*Gerencia Comercial[^\n]*\n?|📧\s*comercial@aitue\.net[^\n]*\n?|📞\s*\+54 9 11 4164-0955[^\n]*\n?)+/gi, '\n__COMERCIAL_MARKER__\n');
    text = text.replace(/(?:__COMERCIAL_MARKER__\s*)+/g, `\n${comercialBlock}\n`).trim();
  }

  // Deduplicar contacto de Facturación y Administración si aparece más de una vez
  const facturacionMatches = text.match(/facturacion@aitue\.net|clientes@aitue\.net/gi);
  if (facturacionMatches && facturacionMatches.length > 1) {
    const facturacionBlock = `💳 Facturación y Administración\n📧 clientes@aitue.net — Lunes a viernes, de 09:00 a 18:00 hs AR`;
    text = text.replace(/(?:💳[^\n]*Facturación y Administración[^\n]*\n?|📧\s*(?:facturacion|clientes)@aitue\.net[^\n]*\n?)+/gi, '\n__FACTURACION_MARKER__\n');
    text = text.replace(/(?:__FACTURACION_MARKER__\s*)+/g, `\n${facturacionBlock}\n`).trim();
  }

  // Deduplicar envíos (Operativa de Envíos) si aparecen duplicados
  const enviosMatches = text.match(/logistica@aitue\.net|clientes@aitue\.net/gi);
  if (enviosMatches && enviosMatches.length > 1) {
    const enviosBlock = `📦 Operativa de Envíos\n📧 clientes@aitue.net — Lunes a viernes, de 09:00 a 18:00 hs AR`;
    text = text.replace(/(?:📦[^\n]*Operativa de Envíos[^\n]*\n?|📧\s*(?:logistica|clientes)@aitue\.net[^\n]*\n?)+/gi, '\n__ENVIOS_MARKER__\n');
    text = text.replace(/(?:__ENVIOS_MARKER__\s*)+/g, `\n${enviosBlock}\n`).trim();
  }

  // Deduplicar soporte técnico si aparece repetido
  const soporteMatches = text.match(/laboratorio@aitue\.net|desarrollo@aitue\.net/gi);
  if (soporteMatches && soporteMatches.length > 2) {
    const soporteBlock = `🛠️ Servicio de Soporte Técnico — Atención 24/7\n📧 laboratorio@aitue.net / 📧 desarrollo@aitue.net | 📞 +54 9 3872 12-7974 / +54 9 3875 01-4000`;
    text = text.replace(/(?:🛠️[^\n]*Servicio de Soporte Técnico[^\n]*\n?|📧\s*(?:laboratorio|desarrollo)@aitue\.net[^\n]*\n?)+/gi, '\n__SOPORTE_MARKER__\n');
    text = text.replace(/(?:__SOPORTE_MARKER__\s*)+/g, `\n${soporteBlock}\n`).trim();
  }

  return text;
}

// Fallback conversation generator limpia y directa según jerarquía de prioridad de 12 niveles
function generateSmartFallback(userInput) {
  const text = (userInput || '').toLowerCase().trim();

  // 0a. Audio / Photo / Video / Files indication
  if (text.includes('[audio]') || text.includes('[imagen]') || text.includes('[video]') || text.includes('[archivo]')) {
    return "Por favor, escribí tu consulta o describí el contenido por texto para que podamos ayudarte.";
  }

  // DEFINICIONES DE INTENCIÓN POR PALABRAS CLAVE:
  const isTecnico = text.includes('se rompio') || text.includes('se rompió') || text.includes('roto') || text.includes('no funciona') || text.includes('fallo') || text.includes('falló') || text.includes('se daño') || text.includes('se dañó') || text.includes('falla') || text.includes('fallando') || text.includes('cable') || text.includes('cable roto') || text.includes('accesorio roto') || text.includes('instalacion') || text.includes('instalación') || text.includes('configuracion') || text.includes('configuración') || text.includes('reparacion') || text.includes('reparación') || text.includes('no anda') || text.includes('problema tecnico') || text.includes('problema técnico');
  
  const isAntennaConnection = text.includes('conexion') || text.includes('conexión') || text.includes('conectividad') || text.includes('comcetividad') || text.includes('comectividad') || text.includes('conectivida') || text.includes('conecti') || text.includes('internet') || text.includes('consumo') || text.includes('interrupcion') || text.includes('interrupción') || (text.includes('antena') && (text.includes('problema') || text.includes('falla') || text.includes('no anda') || text.includes('no funciona'))) || text.includes('sin senal') || text.includes('sin señal') || text.includes('no tengo internet') || text.includes('servicio caido') || text.includes('servicio caído');
  
  const isInternetSoporte = isAntennaConnection || text.includes('activar') || text.includes('activación') || text.includes('activacion') || text.includes('actibar') || text.includes('aktivar') || text.includes('desactivar') || text.includes('desactivación') || text.includes('desactivacion') || text.includes('desactibar') || text.includes('desaktivar') || text.includes('baja') || text.includes('basja') || text.includes('vaja') || text.includes('vasja') || text.includes('cancelar') || text.includes('cancelación') || text.includes('cancelacion') || text.includes('pausar') || text.includes('suspender') || text.includes('ayuda para activar') || text.includes('ayuda activar') || text.includes('problema de red') || text.includes('falla de internet') || text.includes('soporte del servicio') || text.includes('ya pague') || text.includes('ya pagué') || text.includes('ya contrate') || text.includes('ya contraté');

  const isComercial = text.includes('precio') || text.includes('precios') || text.includes('cuanto cuesta') || text.includes('cuánto cuesta') || text.includes('cotización') || text.includes('cotizacion') || text.includes('cotizar') || text.includes('presupuesto') || text.includes('comprar') || text.includes('compra') || text.includes('disponibilidad') || text.includes('quiero uno') || text.includes('cual me conviene') || text.includes('cuál me conviene') || text.includes('asesoramiento') || text.includes('recomendacion') || text.includes('recomendación') || text.includes('propuesta comercial') || text.includes('ventas');

  const isInternetComercial = text.includes('internet') || text.includes('satelital') || text.includes('contratar') || text.includes('contratación') || text.includes('contratacion') || text.includes('quiero internet') || text.includes('planes');

  const isEnvio = text.includes('envio') || text.includes('envío') || text.includes('envios') || text.includes('envíos') || text.includes('entrega') || text.includes('entregas') || text.includes('seguimiento') || text.includes('despacho') || text.includes('despachos') || text.includes('donde esta mi pedido') || text.includes('dónde está mi pedido') || text.includes('pedido') || text.includes('pedidos') || text.includes('no llego') || text.includes('no llegó') || text.includes('mercado libre') || text.includes('mercadolibre') || text.includes('ml');

  const isPago = text.includes('pago') || text.includes('pagos') || text.includes('problema con pago') || text.includes('pago rechazado') || text.includes('pago no acreditado') || text.includes('inconveniente al pagar') || text.includes('error de pago') || text.includes('no aparece el pago') || text.includes('factura') || text.includes('facturación') || text.includes('comprobante');

  const isB2B = text.includes('empresa') || text.includes('flota') || text.includes('flotas') || text.includes('camionetas') || text.includes('vehiculos') || text.includes('vehículos') || text.includes('unidades') || text.includes('compra en volumen') || text.includes('mineria') || text.includes('minería') || text.includes('operacion empresarial') || text.includes('operación empresarial') || text.includes('proyecto corporativo');

  const isVisita = text.includes('visitar') || text.includes('visita') || text.includes('puedo ir') || text.includes('conocer la oficina') || text.includes('ver el producto') || text.includes('conocer un producto personalmente');

  const isProductoInfo = text.includes('que productos') || text.includes('qué productos') || text.includes('aitue standard') || text.includes('aitue pro') || text.includes('ultra') || text.includes('gabinete') || text.includes('protector') || text.includes('funda') || text.includes('soporte') || text.includes('accesorios') || text.includes('mini') || text.includes('mini x');

  const isEmpresaInfo = text.includes('que es aitue') || text.includes('qué es aitue') || text.includes('quienes son') || text.includes('quiénes son') || text.includes('que hace aitue') || text.includes('a que se dedican') || text.includes('pagina web') || text.includes('página web') || text.includes('sitio web') || text.includes('cual es la pagina') || text.includes('cuál es la página') || text.includes('cual es la web') || text.includes('cuál es la web') || text.includes('link de la pagina') || text.includes('link web') || text.includes('direccion web') || text.includes('web oficial') || text.includes('sitio oficial');

  const isRedes = text.includes('redes') || text.includes('instagram') || text.includes('facebook') || text.includes('linkedin') || text.includes('donde seguir') || text.includes('dónde seguir') || text.includes('comunidad');

  const isGreeting = text === 'hola' || text.startsWith('hola ') || text.includes('buen dia') || text.includes('buenos dias') || text.includes('buenas tardes') || text.includes('buenas noches') || text.includes('saludos') || text === 'inicio' || text === 'start' || text.includes('holaaitue') || text.includes('hola aitue') || text.includes('que tal') || text.includes('qué tal');

  const isFarewell = text.includes('gracias') || text.includes('adios') || text.includes('adiós') || text.includes('chau') || text.includes('hasta luego') || text.includes('perfecto') || text.includes('listo');

  // SI ES SALUDO + CONSULTA CONCRETA:
  if (isGreeting && (isTecnico || isInternetSoporte || isComercial || isInternetComercial || isEnvio || isPago || isB2B || isVisita || isProductoInfo || isEmpresaInfo)) {
    if (isInternetComercial) {
      return "¡Hola! 👋 Para información y contratación del servicio de Internet vía satélite, nuestra Gerencia Comercial puede brindarte información y realizar la cotización:\n\n💼 Gerencia Comercial — Susana\n📧 susana@aitue.net | 📞 +54 9 11 4164-0955 (Atención 24/7)\n🌐 Conocé más sobre AITUE en https://aitue.net/";
    }
    if (isProductoInfo) {
      return "¡Hola! 👋 Las líneas de integración propias de AITUE son Standard, Pro y Ultra+, compatibles con terminales Starlink Mini y Mini X. También ofrecemos accesorios para instalaciones fijas y móviles.\n\n🛒 Podés conocer nuestros productos en la tienda oficial: https://shop.aitue.net/";
    }
  }

  // 0b. SALUDO SOLAMENTE
  if (isGreeting) {
    return "¡Hola! 👋 Bienvenido al mundo AITUE COMUNICA S.A. 🛰️📡\nSomos una empresa de Soluciones Globales en Telecomunicaciones, con soluciones 360° para equipos Starlink Mini y Mini X, accesorios para Starlink y servicios de acceso a Internet vía satélite.\n\nTe invitamos a recorrer nuestras plataformas oficiales:\n🌐 Sitio Web Oficial: https://aitue.net/\n🛒 Tienda Oficial: https://shop.aitue.net/\n\n¿En qué podemos ayudarte? Podés escribir directamente tu consulta o elegir un área:\n\n1. 🛒 Productos\n2. 💼 Ventas en Cantidad y Asesoría (Susana / Alejandro)\n3. 🛠️ Soporte Técnico, Conectividad y Productos (clientes@aitue.net)\n4. 📦 Pedidos y Despachos (Martin)\n5. 🏬 Distribuidores (facturacion@aitue.net)\n6. 💳 Pagos\n7. 🏢 Empresas / Flotas / B2B\n8. ⚙️ Operativa / Otras consultas";
  }

  // 0c. DESPEDIDA COMPLETA CON REDES SOCIALES
  if (isFarewell) {
    return "¡Gracias por comunicarte con AITUE! 🛰️ Esperamos haberte ayudado con tu consulta. Te invitamos a seguir conectados para conocer nuestras nuevas soluciones, novedades, innovaciones y próximos lanzamientos. Si ves el cielo, estamos. 📡\n\nPodés seguirnos en nuestras redes sociales oficiales:\n🌐 Web: https://aitue.net/\n🛒 Tienda: https://shop.aitue.net/\n🔵 Facebook: https://www.facebook.com/aituecomunicasa\n📸 Instagram: https://www.instagram.com/aituecomunicasa\n💼 LinkedIn: https://www.linkedin.com/company/aitue-comunicasa-sa";
  }

  // CONSULTA DE REDES SOCIALES
  if (isRedes) {
    return "Podés seguirnos y estar al tanto de todas nuestras novedades, lanzamientos e innovaciones en nuestras redes sociales oficiales:\n\n🌐 Web: https://aitue.net/\n🛒 Tienda: https://shop.aitue.net/\n🔵 Facebook: https://www.facebook.com/aituecomunicasa\n📸 Instagram: https://www.instagram.com/aituecomunicasa\n💼 LinkedIn: https://www.linkedin.com/company/aitue-comunicasa-sa";
  }

  // CASOS DUALES (MÚLTIPLES ÁREAS):
  if (isEnvio && isTecnico) {
    return `📦 Operativa de Envíos y Despachos\n📧 clientes@aitue.net (Lun-Vie 09:00 a 18:00 hs AR)\n\n🛠️ Atención al Cliente\n✉️ clientes@aitue.net`;
  }

  if (isComercial && isTecnico) {
    return "Para ayudarte de la mejor manera, derivamos tu consulta a nuestras dos áreas especializadas:\n\n💼 Parte Comercial (Ventas / Cotización):\n• Gerencia Comercial — Susana: 📧 susana@aitue.net | 📞 +54 9 11 4164-0955 (Atención 24/7)\n\n📧 Atención al Cliente:\n✉️ clientes@aitue.net";
  }

  // JERARQUÍA DE PRIORIDAD MÁXIMA DE 12 PASOS:

  // 1. PROBLEMAS DE CONEXIÓN O CONECTIVIDAD A INTERNET
  if (isAntennaConnection) {
    return "Para problemas de conectividad o red satelital, comunicate con Soporte:\n\n📡 Soporte de Red y Conectividad — Benjamín:\n📞 WhatsApp / Mensajes: +54 9 3872 12-7974 (Atención 24/7)";
  }

  // 2. PRODUCTO_TECNICO (DAÑOS O FALLAS GENERALES DE PRODUCTO/ACCESORIOS)
  if (isTecnico) {
    return "Para problemas técnicos, fallas de funcionamiento o reclamos de tu equipo, podés comunicarte con Atención al Cliente:\n\n📧 Atención al Cliente\n✉️ clientes@aitue.net";
  }

  // 3. INTERNET_SOPORTE GENERAL (ACTIVACIONES O DESACTIVACIONES)
  if (isInternetSoporte) {
    return "Para activaciones de antena, desactivaciones o soporte técnico de red del servicio satelital contratado, podés comunicarte directamente con:\n\n📡 Atención al Cliente — Conectividad y Red\n📧 clientes@aitue.net | 📞 +54 9 3872 12-7974 (Atención 24/7)";
  }

  // 3. PRODUCTO_COMERCIAL
  if (isComercial || text.includes('v2') || text.includes('starlink v2')) {
    return "Para consultas sobre precios, presupuestos, cotizaciones, compras o asesoramiento comercial de productos, podés contactar a Susana en Gerencia Comercial:\n\n💼 Gerencia Comercial — Susana\n📧 susana@aitue.net | 📞 +54 9 11 4164-0955 (Atención 24/7)\n🛒 Tienda oficial: https://shop.aitue.net/";
  }

  // 4. INTERNET_COMERCIAL
  if (isInternetComercial) {
    return "Para solicitar información, planes y cotizaciones sobre nuestros servicios de acceso a Internet vía satélite, podés contactar a Susana en Gerencia Comercial:\n\n💼 Gerencia Comercial — Susana\n📧 susana@aitue.net | 📞 +54 9 11 4164-0955 (Atención 24/7)\n🌐 Conocé más sobre AITUE en https://aitue.net/";
  }

  // 5. ENVIO_MERCADOLIBRE
  if (isEnvio) {
    return `📦 Operativa de Envíos y Despachos\n📧 clientes@aitue.net (Lunes a viernes, de 09:00 a 18:00 hs AR)`;
  }

  // 6. PAGO
  if (isPago) {
    return "Si tenés un inconveniente relacionado exclusivamente con un pago que no se envió, pago rechazado, acreditación o facturación, podés comunicarte con:\n\n📄 Facturación y Administración\n📧 clientes@aitue.net (Lunes a viernes, de 09:00 a 18:00 hs AR)";
  }

  // 7. B2B
  if (isB2B) {
    return "Podés solicitar una propuesta comercial B2B a Susana en Gerencia Comercial:\n\n💼 Gerencia Comercial — Susana\n📧 susana@aitue.net | 📞 +54 9 11 4164-0955 (Atención 24/7)";
  }

  // 8. VISITA_COMERCIAL
  if (isVisita) {
    return "Para consultar sobre la posibilidad de realizar una visita presencial o conocer nuestros productos, podés comunicarte directamente con Susana en Gerencia Comercial:\n\n💼 Gerencia Comercial — Susana\n📧 susana@aitue.net | 📞 +54 9 11 4164-0955 (Atención 24/7)";
  }

  // 9. PRODUCTO_INFO
  if (isProductoInfo) {
    return "AITUE ofrece las líneas Standard, Pro y Ultra+ para integrar terminales Starlink Mini y Mini X en instalaciones permanentes, vehículos y operaciones de campo, además de accesorios compatibles.\n\n🛒 Podés consultar el catálogo oficial: https://shop.aitue.net/";
  }

  // 10. EMPRESA_INFO
  if (isEmpresaInfo) {
    return "🛰️ AITUE COMUNICA S.A. es una empresa líder, especializada en soluciones de conectividad satelital en movimiento.\n\nSi ves el cielo, estamos.\n\n🌐 Conocé más sobre nuestra trayectoria e innovaciones en https://aitue.net/";
  }

  // 11. OPERATIVA & 12. LO_SENTIMOS (ÚLTIMA POSIBILIDAD DE TODAS) -> DERIVAR A ATENCIÓN AL CLIENTE
  return "Disculpas, no logramos interpretar tu consulta con claridad. Podés comunicarte con nuestra área de Atención al Cliente:\n\n📧 Atención al Cliente\n✉️ clientes@aitue.net";
}

// Handle dynamic customer creation/update
function updateCustomerCRM(chatId, updates) {
  const customers = readJsonFile(CUSTOMERS_FILE);
  let clientIndex = customers.findIndex(c => c.id === chatId);

  if (clientIndex === -1) {
    const newClient = {
      id: chatId,
      name: updates.name || (chatId.includes('@') ? `WhatsApp: ${chatId.split('@')[0]}` : 'Usuario Web'),
      phone: getPhoneFromJid(chatId) ? `+${getPhoneFromJid(chatId)}` : '',
      email: updates.email || '',
      company: updates.company || '',
      products: updates.products || '',
      installedDevices: updates.installedDevices || '',
      problems: updates.problems || '',
      interests: updates.interests || '',
      tag: updates.tag || '🟢 Nuevo',
      status: updates.status || 'Nuevo',
      lastInteraction: new Date().toISOString(),
      notes: updates.notes || '',
      nextAppointment: null
    };
    customers.push(newClient);
    writeJsonFile(CUSTOMERS_FILE, customers);
    return newClient;
  } else {
    const updatedClient = {
      ...customers[clientIndex],
      ...updates,
      lastInteraction: new Date().toISOString()
    };
    customers[clientIndex] = updatedClient;
    writeJsonFile(CUSTOMERS_FILE, customers);
    return updatedClient;
  }
}

// Process booking tag
async function processAppointmentTag(chatId, botResponse) {
  if (botResponse.includes('[AGENDA_CITA:')) {
    const match = botResponse.match(/\[AGENDA_CITA:\s*([^\]]+)\]/);
    if (match) {
      const dateTimeStr = match[1].trim(); // YYYY-MM-DDTHH:MM
      try { validateAppointment(dateTimeStr, readJsonFile(APPOINTMENTS_FILE), getBookingConfig()); }
      catch (err) { return err.message; }

      const appointments = readJsonFile(APPOINTMENTS_FILE);
      const [date, time] = dateTimeStr.split('T');

      const newAppointment = {
        id: randomBytes(12).toString('hex'),
        chatId: chatId,
        customerName: activeChats[chatId]?.name || 'Cliente',
        durationMin: getBookingConfig().durationMin,
        reminderSent: false,
        dateTime: dateTimeStr,
        date: date,
        time: time,
        operatorName: 'Asesor IA',
        area: 'Ventas/Soporte',
        notes: 'Cita agendada por el bot virtual'
      };

      appointments.push(newAppointment);
      writeJsonFile(APPOINTMENTS_FILE, appointments);

      // Update CRM
      updateCustomerCRM(chatId, {
        status: 'Seguimiento',
        tag: '🟠 Seguimiento',
        nextAppointment: {
          date: date,
          time: time,
          operatorName: 'Asesor IA',
          area: 'Ventas/Soporte',
          notes: 'Cita agendada por el bot virtual'
        }
      });

      // Return cleaned string
      return botResponse.replace(/\[AGENDA_CITA:\s*[^\]]+\]/, '').trim();
    }
  }
  return botResponse;
}

// Parse operator commands
async function handleOperatorCommand(remoteJid, text) {
  const cmd = text.toLowerCase().trim();
  const phone = '+' + remoteJid.split('@')[0];

  const operators = readJsonFile(OPERATORS_FILE);
  const isAuthorized = operators.some(op => op.phone === phone);
  if (!isAuthorized) return false; // not operator

  let responseText = '';
  if (cmd === '/estado') {
    responseText = `🤖 *AITUE BOT - Estado:*
• *Bot Global:* ${isBotPaused ? '⏸️ Pausado' : '▶️ Activo'}
• *Conexión:* ${connectionStatus}
• *Modelo IA:* ${currentModelName}
• *Temperatura:* ${currentTemperature}`;
  }
  else if (cmd === '/pausar') {
    isBotPaused = !isBotPaused;
    persistSettings();
    responseText = `⏸️ *Bot global:* ${isBotPaused ? 'PAUSADO ⏸️' : 'ACTIVO ▶️'}`;
  }
  else if (cmd === '/qr') {
    responseText = `🔌 *Conexión de WhatsApp:*
• *Estado:* ${connectionStatus}
• *Número vinculado:* ${connectedUserPhone || 'Ninguno'}`;
  }
  else if (cmd === '/clientes') {
    const customers = readJsonFile(CUSTOMERS_FILE);
    responseText = `👥 *CRM - Clientes:*
• *Total registrados:* ${customers.length}
• *Nuevos:* ${customers.filter(c => c.tag === '🟢 Nuevo').length}
• *Seguimientos:* ${customers.filter(c => c.tag === '🟠 Seguimiento').length}`;
  }
  else if (cmd === '/ventas') {
    const customers = readJsonFile(CUSTOMERS_FILE);
    const potentials = customers.filter(c => c.tag === '🟡 Potencial cliente').length;
    const clients = customers.filter(c => c.tag === '🔵 Cliente').length;
    responseText = `📊 *Resumen Comercial:*
• *Clientes Activos:* ${clients}
• *Prospectos de Venta:* ${potentials}`;
  }

  if (responseText) {
    await sock.sendMessage(remoteJid, { text: responseText });
    return true;
  }
  return false;
}

// Check work hours availability
function isWithinWorkHours() {
  const config = getBookingConfig();
  const now = localParts();
  return config.operatorAvailable && config.workDays.includes(now.day) && !config.blockedDates.includes(now.date) && now.time >= config.openTime && now.time < config.closeTime;
}

// 1-minute cron for reminders
let reminderRunning = false;
async function runReminders() {
  if (reminderRunning || !sock || connectionStatus !== 'CONNECTED') return;
  reminderRunning = true;
  try {
    const appointments = readJsonFile(APPOINTMENTS_FILE);
    const now = new Date();
    const config = getBookingConfig();
    let updated = false;

    for (let app of appointments) {
      if (app.reminderSent) continue;

      const appTime = new Date(app.dateTime + ':00-03:00');
      const diffMs = appTime.getTime() - now.getTime();
      const diffMin = Math.round(diffMs / (60 * 1000));

      // If appointment is in exactly 60 minutes (+/- 2 minutes margin)
      if (diffMin > 0 && diffMin <= 65) {

        // Notify client
        if (sock && connectionStatus === 'CONNECTED' && app.chatId.includes('@') && !app.customerReminderSent) {
          await sock.sendMessage(app.chatId, {
            text: `🔔 *Recordatorio de AITUE:* Tu atención personalizada está programada para hoy a las ${app.time}.`
          });
          app.customerReminderSent = true;
          updated = true;
          writeJsonFile(APPOINTMENTS_FILE, appointments);
        }

        // Notify operators
        const operators = readJsonFile(OPERATORS_FILE);
        const customers = readJsonFile(CUSTOMERS_FILE);
        const client = customers.find(c => c.id === app.chatId);

        const opMessage = `🔔 *Atención en 1 hora:*
👤 *Cliente:* ${app.customerName}
🏢 *Empresa:* ${client?.company || 'No especificada'}
📌 *Área:* ${app.area}
📝 *Problema/Notas:* ${client?.problems || client?.notes || 'Sin especificaciones'}`;

        for (let op of operators) {
          const opJid = op.phone.replace('+', '') + '@s.whatsapp.net';
          app.remindedOperators ||= [];
          if (sock && connectionStatus === 'CONNECTED' && !app.remindedOperators.includes(op.phone)) {
            await sock.sendMessage(opJid, { text: opMessage });
            app.remindedOperators.push(op.phone);
            updated = true;
            writeJsonFile(APPOINTMENTS_FILE, appointments);
          }
        }
        app.reminderSent = true;
        updated = true;
      }
    }

    if (updated) {
      writeJsonFile(APPOINTMENTS_FILE, appointments);
    }
  } catch (err) {
    console.error('Error en cron de recordatorios:', err.message);
  } finally { reminderRunning = false; }
}
const reminderTimer = setInterval(runReminders, 60000);
reminderTimer.unref();

// Connect Baileys WhatsApp client
const qrConnection = new QrConnection({
  async createSocket() {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const socket = makeWASocket({ auth: state, logger: pino({ level: 'warn' }), markOnlineOnConnect: false, syncFullHistory: false });
    const send = socket.sendMessage.bind(socket);
    socket.sendMessage = async (jid, content, options = {}) => {
      const messageId = options.messageId || '3EB0' + randomBytes(9).toString('hex').toUpperCase();
      const now = Date.now();
      for (const [id, expiry] of botSentMessageIds) if (expiry <= now) botSentMessageIds.delete(id);
      botSentMessageIds.set(messageId, now + 5 * 60000);
      try { return await send(jid, content, { ...options, messageId }); }
      catch (err) { botSentMessageIds.delete(messageId); throw err; }
    };
    sock = socket;
    return { socket, saveCreds };
  },
  onStatus(status, socket) {
    connectionStatus = status;
    if (status !== 'SCAN_QR') currentQrDataUrl = null;
    connectedUserPhone = status === 'CONNECTED' ? '+' + socket.user.id.split(':')[0].split('@')[0] : null;
    if (status !== 'CONNECTED') sock = null;
  },
  async onQr(qr, current) {
    const data = await qrcode.toDataURL(qr);
    if (current()) { currentQrDataUrl = data; connectionStatus = 'SCAN_QR'; }
  },
  onMessages: handleBaileysBatch,
  onError: err => console.error('Conexión de WhatsApp:', err.message)
});
function startBaileysSocket() { return qrConnection.start(); }
let connectionAction = Promise.resolve();
function runConnectionAction(action) {
  const next = connectionAction.catch(() => {}).then(action);
  connectionAction = next;
  return next;
}
async function handleBaileysBatch(batch) {
  // History synchronization must never trigger replies to old messages.
  if (batch.type && batch.type !== 'notify') return;
  const results = await Promise.allSettled((batch.messages || []).map(msg => incomingQueue.run(msg.key?.remoteJid || '', msg.key?.id, () => processWhatsAppMessage(msg))));
  for (const result of results) if (result.status === 'rejected') console.error('No se pudo procesar el mensaje:', result.reason.message);
}

  async function sendWhatsAppMessageOrList(sock, remoteJid, botResponse, allowContactCard = true) {
    if (isBotPaused || activeChats[remoteJid]?.botPaused || connectionStatus !== 'CONNECTED') return;
    try {
      await sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
    } catch (e) {}

    const isWelcomeGreeting = botResponse.includes('Bienvenido a AITUE COMUNICA S.A.') || botResponse.includes('1. 🛒 Productos y Accesorios');

    if (isWelcomeGreeting) {
      const welcomeHeader = `¡Hola! 👋 Bienvenido a AITUE COMUNICA S.A. 🛰️📡\nSoluciones Globales en Telecomunicaciones y Conectividad Satelital.\n\nNuestras líneas de integración Standard, Pro y Ultra+ son compatibles con terminales Starlink Mini y Mini X. También ofrecemos accesorios de alimentación y fijación e Internet satelital.\n\n🌐 Web: https://aitue.net/ | 🛒 Tienda: https://shop.aitue.net/\n\n¿En qué podemos ayudarte hoy?`;

      const sections = [
        {
          title: "Áreas de Atención AITUE",
          rows: [
            { title: "🛒 Productos y Accesorios", rowId: "PRODUCTO_INFO", description: "Catálogo de productos y tienda oficial" },
            { title: "💼 Ventas y Cotizaciones", rowId: "PRODUCTO_COMERCIAL", description: "Precios, compras y asesoramiento — Gerencia Comercial" },
            { title: "🛠️ Soporte Técnico", rowId: "PRODUCTO_TECNICO", description: "Fallas, cables e instalaciones — Servicio de Soporte Técnico" },
            { title: "📡 Internet vía Satélite", rowId: "INTERNET_SOPORTE", description: "Conectividad, consumo y red — Soporte de Red Vía Satelital" },
            { title: "💳 Pagos y Facturación", rowId: "PAGO", description: "Comprobantes y pagos — Facturación y Administración" },
            { title: "📦 Envíos y Seguimiento", rowId: "ENVIO_MERCADOLIBRE", description: "Estado de pedidos y despachos — Operativa de Envíos" },
            { title: "🏢 Empresas y Flotas (B2B)", rowId: "B2B", description: "Propuestas corporativas para flotas — Gerencia Comercial" },
            { title: "🏬 Distribuidores", rowId: "DISTRIBUIDORES", description: "Atención nacional e internacional a distribuidores" }
          ]
        }
      ];

      try {
        await sock.sendMessage(remoteJid, {
          text: welcomeHeader,
          footer: "AITUE COMUNICA S.A. 🛰️",
          title: "¡Bienvenido a AITUE!",
          buttonText: "Elige una opción",
          sections
        });
        await sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});
        console.log(`[WP SENT LIST] Lista interactiva enviada exitosamente a ${remoteJid}`);
        return;
      } catch (listErr) {
        console.error(`[WP SENT LIST ERROR] Fallback a texto normal:`, listErr.message || listErr);
      }
    }

    await sock.sendMessage(remoteJid, { text: botResponse });

    // Enviar Tarjeta vCard Interactiva de WhatsApp si la respuesta contiene derivación de contacto
    try {
      let targetContact = null;
      if (!allowContactCard) {
        await sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});
        console.log(`[WP VCARD SKIPPED] No se adjunta tarjeta de contacto a una respuesta aclaratoria para ${remoteJid}.`);
        return;
      }
      if (botResponse.includes('susana@aitue.net')) {
        targetContact = CONTACTS.comercial;
      } else if (botResponse.includes('alejandro@aitue.net')) {
        targetContact = CONTACTS.comercial_internacional;
      } else if (botResponse.includes('3872 12-7974')) {
        targetContact = CONTACTS.soporte_red;
      } else if (botResponse.includes('clientes@aitue.net') && (botResponse.includes('7358-3768') || botResponse.includes('Atención al Cliente'))) {
        targetContact = CONTACTS.soporte_tecnico;
      } else if ((CONTACTS.envios.phone && botResponse.includes(CONTACTS.envios.phone)) || botResponse.includes('Operativa de Envíos') || botResponse.includes('Martin')) {
        targetContact = CONTACTS.envios;
      } else if (botResponse.includes('facturacion@aitue.net')) {
        targetContact = CONTACTS.distribuidores;
      }

      if (targetContact && targetContact.phone && typeof targetContact.getVCard === 'function') {
        const vcard = targetContact.getVCard();
        await sock.sendMessage(remoteJid, {
          contacts: {
            displayName: targetContact.name,
            contacts: [{ vcard }]
          }
        });
        console.log(`[WP VCARD SENT] Tarjeta vCard interactiva enviada a ${remoteJid} para ${targetContact.name}`);
      }

    } catch (vcardErr) {
      console.error(`[WP VCARD ERROR] Error enviando tarjeta vCard a ${remoteJid}:`, vcardErr.message || vcardErr);
    }

    await sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});
    console.log(`[WP SENT] Mensaje enviado exitosamente a ${remoteJid}: "${botResponse.substring(0, 40)}..."`);
  }

  async function notifyResponsibleAreas(chatId, chat, routeResult) {
    const customer = readJsonFile(CUSTOMERS_FILE).find(client => client.id === chatId);
    const customerName = [chat.name, customer?.name]
      .map(name => String(name || '').trim())
      .find(name => name && !name.includes('@') && !/^whatsapp\s*:/i.test(name));
    const summary = ContextManager.generateSummaryForOperator(
      chatId,
      { ...routeResult, customerPhone: chat.phone },
      chat.phone,
      {
        name: customerName,
        company: customer?.company
      }
    );
    const contacts = BotRouter.getHandoffNotificationContacts(routeResult);
    const notificationTargets = new Map();

    if (contacts.length === 0) {
      console.info(`[WP HANDOFF SUMMARY SKIPPED] No se envían notificaciones por WhatsApp a Operativa; se indicó al cliente el correo de contacto.`);
      return;
    }

    for (const contact of contacts) {
      const targetNumber = (contact.notificationPhone || contact.phone || '').replace(/\D/g, '');
      if (!targetNumber) {
        console.warn(`[WP HANDOFF SUMMARY SKIPPED] ${contact.name} no tiene WhatsApp de notificación configurado.`);
        continue;
      }
      notificationTargets.set(targetNumber, contact);
    }

    if (notificationTargets.size === 0) {
      console.error(`[WP HANDOFF SUMMARY FAILED] No hay destinatarios WhatsApp configurados para ${routeResult.area || chatId}.`);
      return;
    }

    for (const [targetNumber, contact] of notificationTargets) {
      const targetJid = `${targetNumber}@s.whatsapp.net`;
      if (isOwnWhatsAppChat(targetJid)) {
        console.error(`[WP HANDOFF SUMMARY SKIPPED] ${contact.name} coincide con la cuenta WhatsApp del bot.`);
        continue;
      }

      try {
        const contactSummary = summary.replace(
          `🏢 Área Derivada: ${routeResult.area || 'General'}`,
          `🏢 Área Derivada: ${contact.name}`
        );
        await sock.sendMessage(targetJid, { text: `📩 Nueva derivación\n\n${contactSummary}` });
        console.log(`[WP HANDOFF SUMMARY SENT] Resumen enviado a ${contact.name} (${targetJid}).`);
      } catch (summaryErr) {
        console.error(`[WP HANDOFF SUMMARY ERROR] No se pudo notificar a ${contact.name}:`, summaryErr.message || summaryErr);
      }
    }
  }

  async function processWhatsAppMessage(msg) {
    try {
      if (!msg || !msg.message) return;
      msg = { ...msg, message: normalizeMessageContent(msg.message) };
      if (!msg.message) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.includes('broadcast') || remoteJid === 'status@broadcast') return;

      if (msg.key.fromMe) {
        if (msg.key.id && botSentMessageIds.has(msg.key.id)) {
          botSentMessageIds.delete(msg.key.id);
          return;
        }

        const ownChatText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (isOwnWhatsAppChat(remoteJid)) {
          const command = ownChatText.trim().match(/^\/(reanudar|pausados)(?:\s+(.+))?$/i);
          if (!command) return;

          let responseText;
          if (command[1].toLowerCase() === 'pausados') {
            const pausedChats = new Map([...humanTakeovers.entries()].flatMap(([chatId, record]) => {
              const phone = record.phone || activeChats[chatId]?.phone || getPhoneFromJid(chatId) || chatId;
              if (isAlwaysActivePhone(phone)) return [];
              return [[phone.replace(/\D/g, ''), {
                phone,
                permanentlyPaused: record.pauseReason === 'always'
              }]];
            }));
            for (const phone of ALWAYS_PAUSED_PHONE_NUMBERS) {
              if (!pausedChats.has(phone)) {
                pausedChats.set(phone, { phone: `+${phone}`, permanentlyPaused: true });
              }
            }
            for (const phone of ALWAYS_ACTIVE_PHONE_NUMBERS) {
              pausedChats.delete(phone);
            }
            const pausedChatLines = [...pausedChats.values()].map(({ phone, permanentlyPaused }) =>
              `• ${phone}${permanentlyPaused ? ' (permanente)' : ''}`
            );
            responseText = pausedChatLines.length
              ? `Chats pausados:\n${pausedChatLines.join('\n')}\n\nPara reanudar uno, enviá /reanudar <número>. Los números con pausa permanente no se pueden reanudar mientras estén configurados.`
              : 'No hay chats pausados por atención humana.';
          } else if (!command[2]) {
            responseText = 'Indicá el número del cliente. Ejemplo: /reanudar 54911XXXXXXXX';
          } else if (isAlwaysPausedPhone(command[2].trim())) {
            responseText = `No se puede reanudar ${command[2].trim()}: tiene pausa permanente. Quitá el número de server/always-paused-phones.js y desplegá nuevamente para habilitarlo.`;
          } else {
            const targetChatId = findPausedChat(command[2].trim());
            if (!targetChatId) {
              responseText = `No encontré un chat pausado que coincida con "${command[2].trim()}". Usá /pausados para ver los chats disponibles.`;
            } else {
              const chat = activeChats[targetChatId] || {
                id: targetChatId,
                type: 'whatsapp',
                name: `WhatsApp: ${command[2].trim()}`,
                messages: [],
                botPaused: true,
                pauseReason: humanTakeovers.get(targetChatId)?.pauseReason || 'human',
                phone: humanTakeovers.get(targetChatId)?.phone || getPhoneFromJid(targetChatId)
              };
              activeChats[targetChatId] = chat;
              const resumed = resumeChatBot(targetChatId, chat);
              responseText = resumed
                ? `Bot reanudado para ${chat.phone || command[2].trim()}.`
                : `No se puede reanudar ${chat.phone || command[2].trim()}: tiene pausa permanente. Quitá el número de server/always-paused-phones.js y desplegá nuevamente para habilitarlo.`;
              if (resumed) {
                console.log(`[HUMAN TAKEOVER RELEASED] Bot reanudado desde WhatsApp para ${targetChatId}.`);
              }
            }
          }

          await sock.sendMessage(remoteJid, { text: responseText });
          return;
        }

        const messageContentType = Object.keys(msg.message).find(key =>
          !['messageContextInfo', 'senderKeyDistributionMessage', 'protocolMessage'].includes(key)
        );
        if (!messageContentType) return;

        if (!activeChats[remoteJid]) {
          activeChats[remoteJid] = {
            id: remoteJid,
            type: 'whatsapp',
            name: msg.pushName || `WhatsApp: ${remoteJid.split('@')[0]}`,
            messages: [],
            botPaused: true,
            pauseReason: 'human'
          };
        }

        const chat = activeChats[remoteJid];
        const operatorPhone = getPhoneFromJid(msg.key.remoteJidAlt || msg.key.participantAlt || remoteJid);
        const operatorMessage = msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          (msg.message.audioMessage || msg.message.pttMessage ? '[Audio enviado por la persona]' : '[Mensaje enviado por la persona]');

        chat.messages.push({
          id: msg.key.id || Date.now(),
          sender: 'operator',
          text: operatorMessage,
          timestamp: new Date(Number(msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString()
        });
        ContextManager.addMessage(remoteJid, 'operator', operatorMessage);
        markChatTakenOver(remoteJid, chat, operatorPhone);
        liveServerLogs.unshift({
          id: randomBytes(12).toString('hex'),
          timestamp: new Date().toISOString(),
          source: 'operator_whatsapp',
          userJid: remoteJid,
          userPhone: '+' + remoteJid.split('@')[0],
          userMsg: '[Mensaje enviado desde el teléfono de AITUE]',
          botReply: operatorMessage
        });
        console.log(`[HUMAN TAKEOVER] Respuesta desde el teléfono de AITUE; bot pausado para ${remoteJid}.`);
        return;
      }

      // Initialize chat object
      if (!activeChats[remoteJid]) {
        const savedTakeover = humanTakeovers.get(remoteJid);
        activeChats[remoteJid] = {
          id: remoteJid,
          type: 'whatsapp',
          name: msg.pushName || `WhatsApp: ${remoteJid.split('@')[0]}`,
          messages: [],
          botPaused: humanTakeovers.has(remoteJid),
          pauseReason: savedTakeover?.pauseReason || null,
          phone: savedTakeover?.phone || getPhoneFromJid(msg.key.remoteJidAlt || msg.key.participantAlt || remoteJid)
        };
      }

      const chat = activeChats[remoteJid];
      if (msg.pushName) chat.name = msg.pushName;
      chat.phone = getCustomerPhoneFromMessage(msg, chat.phone);
      if (isAlwaysActivePhone(chat.phone) && (chat.botPaused || humanTakeovers.has(remoteJid))) {
        setChatBotPaused(remoteJid, chat, false);
        console.log(`[BOT ALWAYS ACTIVE] Pausa eliminada para el número de pruebas ${chat.phone}.`);
      }
      if (isAlwaysPausedPhone(chat.phone) && chat.pauseReason !== 'always') {
        setChatBotPaused(remoteJid, chat, true, 'always');
        console.log(`[BOT PERMANENTLY PAUSED] Pausa permanente aplicada a ${chat.phone}.`);
      }

      // Auto-register in CRM
      updateCustomerCRM(remoteJid, {
        name: msg.pushName,
        ...(chat.phone ? { phone: chat.phone } : {})
      });

      let textMessage = msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        msg.message.listResponseMessage?.title ||
        msg.message.buttonsResponseMessage?.selectedButtonId ||
        msg.message.buttonsResponseMessage?.selectedDisplayText ||
        msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        '';
      textMessage = String(textMessage).slice(0, 6000);
      chat.closed = false;
      const isAudio = Boolean(msg.message.audioMessage || msg.message.pttMessage);
      const isImage = Boolean(msg.message.imageMessage);
      let mediaUrl = null;

      // Handle operators administrative commands
      if (textMessage.startsWith('/')) {
        const intercepted = await handleOperatorCommand(remoteJid, textMessage);
        if (intercepted) return; // Command processed
      }

      if (chat.botPaused || isBotPaused) {
        const incomingText = textMessage || (isAudio ? '[Audio]' : isImage ? '[Imagen]' : '[Mensaje]');
        chat.messages.push({ id: msg.key.id || randomBytes(12).toString('hex'), sender: 'user', text: incomingText, timestamp: new Date().toISOString() });
        ContextManager.addMessage(remoteJid, 'user', incomingText);
        return;
      }
      const weekendPeriod = getWeekendPeriodKey();
      if (weekendPeriod && !chat.botPaused) {
        const state = ContextManager.getState(remoteJid);
        const incomingMessage = textMessage || (isAudio
          ? '[Audio enviado por la persona]'
          : isImage ? '[Imagen enviada por la persona]' : '[Mensaje enviado por la persona]');
        chat.messages.push({
          id: msg.key.id || Date.now(),
          sender: 'user',
          text: incomingMessage,
          timestamp: new Date().toISOString()
        });
        ContextManager.addMessage(remoteJid, 'user', incomingMessage);

        if (state.weekendNoticePeriod !== weekendPeriod) {
          state.weekendNoticePeriod = weekendPeriod;
          chat.messages.push({
            id: randomBytes(12).toString('hex'),
            sender: 'bot',
            text: WEEKEND_UNAVAILABLE_MESSAGE,
            timestamp: new Date().toISOString()
          });
          ContextManager.addMessage(remoteJid, 'assistant', WEEKEND_UNAVAILABLE_MESSAGE);
          liveServerLogs.unshift({
            id: randomBytes(12).toString('hex'),
            timestamp: new Date().toISOString(),
            source: 'whatsapp_bot',
            userJid: remoteJid,
            userPhone: chat.phone || '',
            userMsg: incomingMessage,
            botReply: WEEKEND_UNAVAILABLE_MESSAGE
          });
          await sock.sendMessage(remoteJid, { text: WEEKEND_UNAVAILABLE_MESSAGE });
        }
        return;
      }

      if (isAudio) {
        try {
          const audioBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
          );
          const transcribed = await transcribeAudioBuffer(audioBuffer);
          if (transcribed && transcribed.trim()) {
            textMessage = `🎤 [Audio Transcrito]: "${transcribed}"`;
          } else {
            const audioFallback = "No pudimos escuchar tu nota de voz con claridad. Por favor, volvé a enviárnosla o escribinos tu consulta por texto para asistirte.";
            chat.messages.push({
              id: randomBytes(12).toString('hex'),
              sender: 'bot',
              text: audioFallback,
              timestamp: new Date().toISOString()
            });
            await sock.sendMessage(remoteJid, { text: audioFallback });
            return;
          }
        } catch (audioErr) {
          const audioFallback = "No pudimos escuchar tu nota de voz con claridad. Por favor, volvé a enviárnosla o escribinos tu consulta por texto para asistirte.";
          chat.messages.push({
            id: randomBytes(12).toString('hex'),
            sender: 'bot',
            text: audioFallback,
            timestamp: new Date().toISOString()
          });
          await sock.sendMessage(remoteJid, { text: audioFallback });
          return;
        }
      }
      else if (isImage) {
        try {
          const imageBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
          );
          const analysis = await analyzeImageBuffer(imageBuffer);
          textMessage = `🖼️ [Imagen Recibida]`;

          // Log image message
          chat.messages.push({
            id: randomBytes(12).toString('hex'),
            sender: 'user',
            text: textMessage,
            timestamp: new Date().toISOString()
          });

          if (chat.botPaused || isBotPaused) return;

          // AI replies to image technical analysis
          liveServerLogs.unshift({
            id: randomBytes(12).toString('hex'),
            timestamp: new Date().toISOString(),
            source: 'whatsapp_bot',
            userJid: remoteJid,
            userPhone: chat.phone || '',
            userMsg: `🖼️ [Análisis de Imagen]`,
            botReply: analysis
          });
          chat.messages.push({
            id: randomBytes(12).toString('hex'),
            sender: 'bot',
            text: analysis,
            timestamp: new Date().toISOString()
          });
          await sock.sendMessage(remoteJid, { text: analysis });
          return;
        } catch (imgErr) {
          textMessage = `🖼️ [Error procesando Imagen]`;
        }
      }
      else if (msg.message.locationMessage) {
        const loc = msg.message.locationMessage;
        textMessage = `📍 [Ubicación Compartida]: https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}`;
      }
      else if (msg.message.contactMessage) {
        const contact = msg.message.contactMessage;
        textMessage = `👤 [Contacto Compartido]: ${contact.displayName || 'vCard'}`;
      }

      // Log in chat history
      chat.messages.push({
        id: randomBytes(12).toString('hex'),
        sender: 'user',
        text: textMessage,
        timestamp: new Date().toISOString()
      });
      ContextManager.addMessage(remoteJid, 'user', textMessage);

      if (chat.botPaused || isBotPaused) {
        console.log(`⏸️ Bot Pausado para ${remoteJid}. Atención manual activa.`);
        return;
      }

      const handoffState = ContextManager.getState(remoteJid);
      handoffState.isInternationalNumber = isInternationalPhoneNumber(chat.phone);
      const handoffRoute = BotRouter.route(
        IntentClassifier.classify(textMessage, handoffState),
        handoffState
      );
      handoffRoute.customerPhone = chat.phone;

      // Human handoff detection (Requiere intención explícita de operador/humano, no coincidir con 'asesoramiento')
      const textLower = textMessage.toLowerCase();
      const isExplicitHumanHandoff = (
        textLower.includes('hablar con humano') ||
        textLower.includes('hablar con un humano') ||
        textLower.includes('hablar con operador') ||
        textLower.includes('hablar con un operador') ||
        textLower.includes('pasar con humano') ||
        textLower.includes('pasar con operador') ||
        textLower.includes('atencion humana') ||
        textLower.includes('atención humana') ||
        textLower.includes('persona real') ||
        textLower.includes('quiero un humano') ||
        textLower.includes('quiero un operador') ||
        textLower === 'humano' ||
        textLower === 'operador'
      );

      if (isExplicitHumanHandoff || handoffRoute.pauseBot) {
        const available = isWithinWorkHours();
        if (available || handoffRoute.pauseBot) {
          const alertMsg = handoffRoute.pauseBot
            ? handoffRoute.response
            : "Claro, te comunico con nuestro equipo en este momento. Aguarda un instante...";
          chat.messages.push({
            id: randomBytes(12).toString('hex'),
            sender: 'bot',
            text: alertMsg,
            timestamp: new Date().toISOString()
          });
          setChatBotPaused(remoteJid, chat, true, 'human');
          await sock.sendMessage(remoteJid, { text: alertMsg });
          await markWhatsAppChatUnread(remoteJid, msg);
          return;
        } else {
          const config = getBookingConfig();
          const unavailableMsg = `En este momento nuestros asesores no están disponibles. Puedo reservarte una atención personalizada de lunes a viernes, de ${config.openTime} a ${config.closeTime}. ¿Qué día y horario te queda mejor?`;
          chat.messages.push({
            id: randomBytes(12).toString('hex'),
            sender: 'bot',
            text: unavailableMsg,
            timestamp: new Date().toISOString()
          });
          await sock.sendMessage(remoteJid, { text: unavailableMsg });
          return;
        }
      }

      // Process reply via AI
      let botResponse = await generateOpenAIResponse(remoteJid, textMessage);

      // Pause may have changed while the provider was working.
      if (!botResponse || chat.botPaused || isBotPaused || chat.closed) return;
      // Existing server-controlled booking hook remains available.
      botResponse = await processAppointmentTag(remoteJid, botResponse);

      chat.messages.push({
        id: randomBytes(12).toString('hex'),
        sender: 'bot',
        text: botResponse,
        timestamp: new Date().toISOString()
      });
      ContextManager.addMessage(remoteJid, 'assistant', botResponse);

      // Record in logs
      liveServerLogs.unshift({
        id: randomBytes(12).toString('hex'),
        timestamp: new Date().toISOString(),
        source: 'whatsapp_bot',
        userJid: remoteJid,
        userPhone: '+' + remoteJid.split('@')[0],
        userMsg: textMessage,
        botReply: botResponse
      });

      try {
        await sendWhatsAppMessageOrList(sock, remoteJid, botResponse, !handoffRoute.isFallback);
      } catch (sendErr) {
        console.error(`[WP SEND ERROR] Error enviando mensaje a ${remoteJid}:`, sendErr.message);
        throw sendErr;
      }

      if (BotRouter.isCustomerHandoff(handoffRoute)) {
        await notifyResponsibleAreas(remoteJid, chat, handoffRoute);
        setChatBotPaused(remoteJid, chat, true, 'human');
        await markWhatsAppChatUnread(remoteJid, msg);
        console.log(`[HUMAN TAKEOVER] Derivación a ${handoffRoute.area}; bot pausado y chat marcado como no leído para ${remoteJid}.`);
        return;
      }

      // Start 5-minute inactivity timer
      resetInactivityTimeout(remoteJid, 'whatsapp');
    } catch (err) {
      console.error('Error en messages.upsert:', err.message);
      throw err;
    }
  }

// Authenticated diagnostics: no new memory is exposed to public web sessions.
app.get('/api/assistant/limits', (req, res) => res.json({ ...assistantSettings.get().limits, memoryFields: MEMORY_FIELDS.length }));
function assistantPanelState() {
  return { settings: assistantSettings.get(), revision: assistantSettings.revision(), fields: LIMIT_FIELDS, memoryFields: MEMORY_FIELDS, connection: { configured: Boolean(OPENAI_API_KEY), provider: OPENAI_API_KEY.startsWith('nvapi-') ? 'NVIDIA' : 'OpenAI', model: currentModelName, panelMaxTokens: currentMaxTokens } };
}
app.get('/api/assistant/settings', (req, res) => res.json(assistantPanelState()));
app.post('/api/assistant/settings', (req, res) => {
  try {
    const settings = assistantSettings.update(req.body?.settings, req.body?.revision);
    customerMemory.configure(settings);
    ragRetriever.maxFragments = settings.limits.ragFragments;
    ragRetriever.maxCharacters = settings.limits.ragCharacters;
    customerMemory.flush();
    res.json(assistantPanelState());
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});
app.get('/api/chats/:id/memory', (req, res) => res.json({ ...customerMemory.context(req.params.id), revision: customerMemory.revision(req.params.id) }));
app.post('/api/chats/:id/memory', (req, res) => {
  try {
    const data = customerMemory.edit(req.params.id, req.body, req.adminUser);
    res.json({ ...data, revision: customerMemory.revision(req.params.id) });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});
app.get('/api/assistant/memories', (req, res) => {
  customerMemory.prune();
  const search = String(req.query.search || '').toLowerCase().slice(0, 200);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const ids = [...new Set([...customerMemory.clients.keys(), ...Object.keys(activeChats)])].filter(id => !id.startsWith('preview:'));
  const list = ids.map(id => {
    const chat = activeChats[id], record = customerMemory.clients.get(id);
    return { id, name: chat?.name || (id.includes('@') ? 'Cliente WhatsApp' : 'Cliente web'), phone: chat?.phone || '', factsCount: Object.keys(record?.facts || {}).length, updatedAt: record?.lastSeen || null };
  }).filter(item => [item.id, item.name, item.phone].some(value => value.toLowerCase().includes(search))).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json({ items: list.slice(offset, offset + 50), total: list.length, offset });
});
app.post('/api/assistant/preview', async (req, res) => {
  const { message, clientId } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 3000 || (clientId !== undefined && typeof clientId !== 'string')) return res.status(400).json({ error: 'Escribí una consulta de hasta 3000 caracteres.' });
  let audit;
  const previewId = `preview:${req.adminUser}`;
  const preview = new GroundedAssistant({
    memory: { context: () => customerMemory.context(clientId || ''), consume: () => customerMemory.consume(previewId), acceptProposals: () => 0 },
    retriever: ragRetriever, getSettings: () => assistantSettings.get(),
    allowedContacts: () => JSON.stringify([CONTACTS, LINKS]), onAudit: (id, value) => { audit = value; }
  });
  const reply = await preview.answer({ chatId: clientId || previewId, userText: message.trim(), history: [], systemPrompt: customWpSystemPrompt, route: { action: 'PREVIEW', area: 'General' }, fallback: 'No pude preparar una respuesta validada. Revisá las fuentes, los límites y la conexión de IA.', apiKey: OPENAI_API_KEY, model: currentModelName, maxTokens: currentMaxTokens, temperature: currentTemperature, organizationId: OPENAI_ORG_ID });
  customerMemory.flush();
  res.json({ reply, audit });
});

// REST APIs
// Web assistant chatbot messaging
app.post('/api/chat', async (req, res, next) => {
  const { message, sessionId } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 6000) return res.status(400).json({ error: 'El mensaje debe tener entre 1 y 6000 caracteres.' });
  try { await incomingQueue.run(sessionId, null, async () => {

  if (!activeChats[sessionId]) {
    activeChats[sessionId] = {
      id: sessionId,
      type: 'web',
      name: 'Usuario Web',
      messages: [],
      botPaused: false
    };
  }

  const chat = activeChats[sessionId];
  chat.closed = false;
  chat.messages.push({
    id: randomBytes(12).toString('hex'),
    sender: 'user',
    text: message,
    timestamp: new Date().toISOString()
  });

  ContextManager.addMessage(sessionId, 'user', message);
  updateCustomerCRM(sessionId, { name: 'Usuario Web' });
  if (isBotPaused) {
    const reply = 'La atención automática está pausada. Tu mensaje quedó registrado para nuestro equipo.';
    chat.messages.push({ id: randomBytes(12).toString('hex'), sender: 'bot', text: reply, timestamp: new Date().toISOString() });
    return res.json({ success: true, reply });
  }

  if (chat.botPaused) {
    return res.json({ success: true, reply: "Un operador está revisando tu caso. Aguarda en línea." });
  }

  const weekendPeriod = getWeekendPeriodKey();
  if (weekendPeriod) {
    const state = ContextManager.getState(sessionId);
    if (state.weekendNoticePeriod !== weekendPeriod) {
      state.weekendNoticePeriod = weekendPeriod;
      chat.messages.push({
        id: randomBytes(12).toString('hex'),
        sender: 'bot',
        text: WEEKEND_UNAVAILABLE_MESSAGE,
        timestamp: new Date().toISOString()
      });
      ContextManager.addMessage(sessionId, 'assistant', WEEKEND_UNAVAILABLE_MESSAGE);
      liveServerLogs.unshift({
        id: randomBytes(12).toString('hex'),
        timestamp: new Date().toISOString(),
        source: 'virtual_assistant',
        userJid: sessionId,
        userPhone: 'Web App',
        userMsg: message,
        botReply: WEEKEND_UNAVAILABLE_MESSAGE
      });
    }
    return res.json({ success: true, reply: WEEKEND_UNAVAILABLE_MESSAGE });
  }

  // Handle human check
  const textLower = message.toLowerCase();
  if (IntentClassifier.classify(message, ContextManager.getState(sessionId)).primary_area === 'HUMAN_HANDOVER') {
    const available = isWithinWorkHours();
    if (available) {
      const alertMsg = "Claro, te comunico con nuestro equipo en este momento. Aguarda un instante...";
      chat.messages.push({ id: randomBytes(12).toString('hex'), sender: 'bot', text: alertMsg, timestamp: new Date().toISOString() });
      ContextManager.addMessage(sessionId, 'assistant', alertMsg);

      // Clear existing inactivity timer when user sends a new message
      if (inactivityTimers[sessionId]) {
        clearTimeout(inactivityTimers[sessionId]);
        delete inactivityTimers[sessionId];
      }
      setChatBotPaused(sessionId, chat, true, 'human');
      return res.json({ success: true, reply: alertMsg });
    } else {
      const config = getBookingConfig();
      const unavailableMsg = `En este momento nuestros asesores no están disponibles. Puedo reservarte una atención personalizada de lunes a viernes, de ${config.openTime} a ${config.closeTime}.`;
      chat.messages.push({ id: randomBytes(12).toString('hex'), sender: 'bot', text: unavailableMsg, timestamp: new Date().toISOString() });
      return res.json({ success: true, reply: unavailableMsg });
    }
  }

  try {
    let botReply = await generateOpenAIResponse(sessionId, message);
    if (!botReply || chat.botPaused || isBotPaused || chat.closed) return res.json({ success: true, reply: null });
    botReply = await processAppointmentTag(sessionId, botReply);
    if (chat.botPaused || isBotPaused) return res.json({ success: true, reply: null });
    ContextManager.addMessage(sessionId, 'assistant', botReply);

    chat.messages.push({
      id: randomBytes(12).toString('hex'),
      sender: 'bot',
      text: botReply,
      timestamp: new Date().toISOString()
    });

    liveServerLogs.unshift({
      id: randomBytes(12).toString('hex'),
      timestamp: new Date().toISOString(),
      source: 'virtual_assistant',
      userJid: sessionId,
      userPhone: 'Web App',
      userMsg: message,
      botReply: botReply
    });

    const route = BotRouter.route(IntentClassifier.classify(message, ContextManager.getState(sessionId)), ContextManager.getState(sessionId));
    if (BotRouter.isCustomerHandoff(route)) {
      if (sock && connectionStatus === 'CONNECTED') await notifyResponsibleAreas(sessionId, chat, route);
      setChatBotPaused(sessionId, chat, true, 'human');
    }
    res.json({ success: true, reply: botReply });

    // Start 5-minute inactivity timer for web assistant
    resetInactivityTimeout(sessionId, 'web');
  } catch (err) {
    const fallback = generateSmartFallback(sessionId, message);
    chat.messages.push({ id: randomBytes(12).toString('hex'), sender: 'bot', text: fallback, timestamp: new Date().toISOString() });
    res.json({ success: true, reply: fallback });
  }
  }); } catch (err) { next(err); }
});

// ----------------------------------------------------
// ADMIN MANAGEMENT APIs (SISTEMA DE CONTROL DE ESTADO)
// ----------------------------------------------------

// 0. CONTROL DE ESTADO GLOBAL (Sincronización con Panel)
app.get('/api/admin/status', (req, res) => {
  res.json({
    success: true,
    status: {
      connectionStatus: connectionStatus,
      isBotPaused: isBotPaused,
      connectedPhone: connectedUserPhone,
      model: currentModelName
    }
  });
});

app.post('/api/admin/toggle-bot', (req, res) => {
  const { paused } = req.body || {};
  if (typeof paused !== 'boolean') return res.status(400).json({ error: 'Se requiere un valor booleano para "paused"' });

  isBotPaused = paused;
  persistSettings();

  res.json({
    success: true,
    isBotPaused: isBotPaused,
    message: isBotPaused ? 'Bot pausado globalmente' : 'Bot activado globalmente'
  });
});

app.post('/api/admin/restart-bot', async (req, res) => {
  try {
    console.log('[ADMIN] Solicitud de reinicio de Bot recibida...');

    // 1. Cerrar socket actual si existe
    if (sock) {
      try {
        // Intentamos cerrar sesión limpiamente si es posible, o simplemente anulamos la referencia
        // Nota: sock.logout() cierra la sesión en el celular, para un reinicio simple
        // solemos forzar el cierre del proceso o la desconexión del socket.
        sock = null;
      } catch (e) {
        console.log('[ADMIN] Info al cerrar socket:', e.message);
      }
    }

    // 2. Reiniciar la conexión
    await startBaileysSocket();

    res.json({ success: true, message: 'Proceso de reinicio iniciado. Verifique el QR en el panel.' });
  } catch (err) {
    console.error('[ADMIN RESTART ERROR]:', err);
    res.status(500).json({ error: 'Error al intentar reiniciar el bot: ' + err.message });
  }
});

// ADMIN: CONTACTOS
app.get('/api/admin/contacts', (req, res) => {
  res.json({ success: true, contacts: CONTACTS });
});

app.post('/api/admin/contacts', (req, res) => {
  const { contactId, updates } = req.body || {};
  if (contactId && CONTACTS[contactId] && updates) {
    Object.assign(CONTACTS[contactId], updates);
    persistSettings();
    return res.json({ success: true, contact: CONTACTS[contactId] });
  }
  res.status(400).json({ error: 'Contacto no encontrado o datos inválidos' });
});

// 3. ADMIN: PROTOCOLOS
app.get('/api/admin/protocols', (req, res) => {
  res.json({ success: true, protocols: PROTOCOLS });
});

app.post('/api/admin/protocols', (req, res) => {
  const { protocolKey, text } = req.body || {};
  if (protocolKey && PROTOCOLS[protocolKey] !== undefined && text) {
    PROTOCOLS[protocolKey] = text;
    persistSettings();
    return res.json({ success: true, protocolKey, text: PROTOCOLS[protocolKey] });
  }
  res.status(400).json({ error: 'Protocolo no encontrado o texto inválido' });
});

// 4. ADMIN: ENLACES
app.get('/api/admin/links', (req, res) => {
  res.json({ success: true, links: LINKS });
});

app.post('/api/admin/links', (req, res) => {
  const { links } = req.body || {};
  if (links) {
    Object.assign(LINKS, links);
    persistSettings();
    return res.json({ success: true, links: LINKS });
  }
  res.status(400).json({ error: 'Enlaces inválidos' });
});

// 5. ADMIN: HERRAMIENTA INTERNA DE PRUEBA DE BOT (TEST BOT)
app.post('/api/admin/test-bot', (req, res) => {
  const { textMessage, chatId = 'admin_test_session' } = req.body || {};
  if (!textMessage) return res.status(400).json({ error: 'Mensaje requerido' });

  const state = ContextManager.getState(chatId);
  const classification = IntentClassifier.classify(textMessage, state);
  const routeResult = BotRouter.route(classification, state);
  const formattedResponse = ResponseGenerator.formatResponse(chatId, classification, routeResult, textMessage);

  res.json({
    success: true,
    input: textMessage,
    debug: {
      primary_area: classification.primary_area,
      secondary_areas: classification.secondary_areas || [],
      confidence: classification.confidence,
      reason: classification.reason,
      area: routeResult.area,
      responsible: routeResult.responsible ? routeResult.responsible.map(r => r.name) : [],
      action: routeResult.action,
      fallback: routeResult.isFallback,
      contextState: {
        hasGreeted: state.hasGreeted,
        currentTopic: state.currentTopic,
        lastIntent: state.lastIntent,
        primary_area: state.primary_area,
        secondary_areas: state.secondary_areas,
        confidence: state.confidence,
        clarificationAsked: state.clarificationAsked
      }
    },
    botReply: formattedResponse
  });
});

// 6. ADMIN: HISTORIAL Y MÉTRICAS DE DERIVACIONES
app.get('/api/admin/metrics', (req, res) => {
  const totalLogs = liveServerLogs.length;
  const metrics = {
    totalConversations: Object.keys(activeChats).length,
    activeChats: Object.values(activeChats).map(c => c.id),
    pausedChats: Object.values(activeChats).filter(c => c.botPaused).map(c => c.id),
    systemLogsCount: totalLogs
  };
  res.json(metrics);
});

// Client polling for Operator manual replies in web-assistant
app.get('/api/web-assistant/poll/:chatId', (req, res) => {
  const { chatId } = req.params;
  const chat = activeChats[chatId];
  if (!chat) return res.json({ messages: [] });
  res.json({ messages: chat.messages });
});

// GET active live chats
app.get('/api/live-chats', (req, res) => {
  const chatList = Object.values(activeChats).map(chat => ({
    id: chat.id,
    type: chat.type,
    name: chat.name,
    primary_area: ContextManager.getState(chat.id).primary_area,
    confidence: ContextManager.getState(chat.id).confidence,
    closed: Boolean(chat.closed),
    botPaused: chat.botPaused,
    pauseReason: chat.pauseReason || null,
    lastMessage: chat.messages[chat.messages.length - 1] || null
  }));
  res.json(chatList);
});

// GET messages from single chat
app.get('/api/live-chats/:chatId', (req, res) => {
  const { chatId } = req.params;
  const chat = activeChats[chatId] || { id: chatId, messages: [], botPaused: false };
  res.json({ ...chat, assistantMemory: customerMemory.context(chatId) });
});

// SEND operator manual message
app.post('/api/live-chats/send', async (req, res) => {
  const { chatId, message } = req.body || {};
  if (!chatId || !message) return res.status(400).json({ error: 'Faltan parámetros' });
  if (typeof chatId !== 'string' || typeof message !== 'string' || message.length > 6000) return res.status(400).json({ error: 'Mensaje inválido.' });
  if (chatId.includes('@') && (!sock || connectionStatus !== 'CONNECTED')) return res.status(503).json({ error: 'WhatsApp está desconectado. Vinculá el dispositivo antes de enviar.' });

  if (!activeChats[chatId]) {
    activeChats[chatId] = {
      id: chatId,
      type: chatId.includes('@') ? 'whatsapp' : 'web',
      name: chatId.includes('@') ? `WhatsApp: ${chatId.split('@')[0]}` : 'Usuario Web',
      messages: [],
      botPaused: true,
      pauseReason: 'manual'
    };
  }

  const chat = activeChats[chatId];
  setChatBotPaused(chatId, chat, true, 'manual');
  chat.messages.push({
    id: randomBytes(12).toString('hex'),
    sender: 'operator',
    text: message,
    timestamp: new Date().toISOString()
  });
  ContextManager.addMessage(chatId, 'operator', message);

  if (chat.type === 'whatsapp' && sock && connectionStatus === 'CONNECTED') {
    await sock.sendMessage(chatId, { text: message });
  }

  liveServerLogs.unshift({
    id: randomBytes(12).toString('hex'),
    timestamp: new Date().toISOString(),
    source: 'operator',
    userJid: chatId,
    userPhone: chatId.includes('@') ? '+' + chatId.split('@')[0] : 'Web App',
    userMsg: '[Mensaje de Operador]',
    botReply: message
  });

  res.json({ success: true });
});

// TOGGLE bot pause for chat JID
app.post('/api/live-chats/:chatId/toggle-pause', (req, res) => {
  const { chatId } = req.params;
  const { paused } = req.body || {};
  if (!activeChats[chatId]) {
    activeChats[chatId] = {
      id: chatId,
      type: chatId.includes('@') ? 'whatsapp' : 'web',
      name: 'Cliente',
      messages: [],
      botPaused: humanTakeovers.has(chatId),
      pauseReason: humanTakeovers.get(chatId)?.pauseReason || null
    };
  }
  const chat = activeChats[chatId];
  chat.phone = chat.phone || humanTakeovers.get(chatId)?.phone || getPhoneFromJid(chatId);
  const nextPaused = typeof paused === 'boolean' ? paused : !chat.botPaused;
  if (nextPaused) {
    setChatBotPaused(chatId, chat, true, 'manual');
  } else {
    if (!resumeChatBot(chatId, chat)) {
      return res.status(409).json({
        error: `No se puede reanudar ${chat.phone}: tiene pausa permanente.`,
        paused: true,
        pauseReason: 'always'
      });
    }
  }
  res.json({ success: true, paused: chat.botPaused, pauseReason: chat.pauseReason });
});

// CLOSE conversation and run auto-summarization
app.post('/api/live-chats/:chatId/close', async (req, res) => {
  const { chatId } = req.params;
  const chat = activeChats[chatId];
  if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });

  // Update CRM status to Closed
  updateCustomerCRM(chatId, { status: 'Cerrado' });

  // Compile history
  const historyText = chat.messages.map(m => `${m.sender === 'user' ? 'Cliente' : 'Asesor'}: ${m.text}`).join('\n');

  if (inactivityTimers[chatId]) { clearTimeout(inactivityTimers[chatId]); delete inactivityTimers[chatId]; }
  chat.closed = true;
  let summary = {
    resumen: "Cliente consultó detalles generales.",
    interes: "Medio",
    problema: "Ninguno especificado",
    proximoPaso: "Seguimiento periódico",
    prioridad: "Media"
  };

  try {
    if (!OPENAI_API_KEY) throw new Error('Sin clave de IA; se conserva el resumen básico.');
    // Call OpenAI/NVIDIA to generate structured summary
    const prompt = `Analiza la siguiente conversación de chat y genera un resumen estructurado en español respetando EXACTAMENTE el siguiente formato de texto plano sin asteriscos:
RESUMEN: (detalla qué consultó el cliente)
INTERÉS: (intención de compra e intereses comerciales)
PROBLEMA: (puntos de dolor o necesidades que requiere resolver)
PRÓXIMO PASO: (acciones comerciales a seguir)
PRIORIDAD: (Alta / Media / Baja)

Chat:
${historyText}`;

    const isNv = OPENAI_API_KEY.startsWith('nvapi-');
    const endpoint = isNv ? 'https://integrate.api.nvidia.com/v1/chat/completions' : `${OPENAI_BASE_URL}/chat/completions`;

    const resIA = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...(isNv || !OPENAI_ORG_ID ? {} : { 'OpenAI-Organization': OPENAI_ORG_ID })
      },
      body: JSON.stringify(completionBody({
        model: currentModelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 600,
        isNvidia: isNv
      })),
      signal: AbortSignal.timeout(10000)
    });

    if (resIA.ok) {
      const data = await resIA.json();
      const content = data.choices[0]?.message?.content || '';

      const resMatch = content.match(/RESUMEN:\s*([^\n]+)/i);
      const intMatch = content.match(/INTERÉS:\s*([^\n]+)/i);
      const probMatch = content.match(/PROBLEMA:\s*([^\n]+)/i);
      const nextMatch = content.match(/PRÓXIMO\s*PASO:\s*([^\n]+)/i);
      const prioMatch = content.match(/PRIORIDAD:\s*([^\n]+)/i);

      summary = {
        resumen: resMatch ? resMatch[1].trim() : summary.resumen,
        interes: intMatch ? intMatch[1].trim() : summary.interes,
        problema: probMatch ? probMatch[1].trim() : summary.problema,
        proximoPaso: nextMatch ? nextMatch[1].trim() : summary.proximoPaso,
        prioridad: prioMatch ? prioMatch[1].trim() : summary.prioridad
      };
    }
  } catch (err) {
    console.error('Error generando resumen por IA:', err.message);
  }

  // Save IA Summary to CRM memory
  updateCustomerCRM(chatId, {
    problems: summary.problema,
    interests: summary.interes,
    previousQueries: summary.resumen,
    notes: `[Auto-Resumen IA]: ${summary.resumen} | Próximo: ${summary.proximoPaso} | Prioridad: ${summary.prioridad}`
  });

  ContextManager.resetState(chatId);
  res.json({ success: true, summary });
});

// CRM Clients endpoints
app.get('/api/customers', (req, res) => {
  res.json(readJsonFile(CUSTOMERS_FILE));
});

app.get('/api/customers/:customerId', (req, res) => {
  const customers = readJsonFile(CUSTOMERS_FILE);
  const client = customers.find(c => c.id === req.params.customerId);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(client);
});

app.post('/api/customers', (req, res) => {
  const { id, name, company, email, phone, tag, status, notes, products, installedDevices, problems, interests, nextAppointment } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Se requiere ID del cliente' });

  const client = updateCustomerCRM(id, {
    name, company, email, phone, tag, status, notes, products, installedDevices, problems, interests, nextAppointment
  });
  res.json({ success: true, client });
});

// CRM Operators endpoints
app.get('/api/operators', (req, res) => {
  res.json(readJsonFile(OPERATORS_FILE));
});

app.post('/api/operators', (req, res) => {
  const { name, phone, area } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Faltan parámetros' });

  const operators = readJsonFile(OPERATORS_FILE);
  const formattedPhone = phone.trim().startsWith('+') ? phone.trim() : '+' + phone.trim();

  const existingIdx = operators.findIndex(op => op.phone === formattedPhone);
  const newOp = { name, phone: formattedPhone, area: area || 'Operador' };

  if (existingIdx !== -1) {
    operators[existingIdx] = newOp;
  } else {
    operators.push(newOp);
  }

  writeJsonFile(OPERATORS_FILE, operators);
  res.json({ success: true, operator: newOp });
});

app.delete('/api/operators/:phone', (req, res) => {
  const phone = req.params.phone;
  let operators = readJsonFile(OPERATORS_FILE);
  operators = operators.filter(op => op.phone !== phone && op.phone !== '+' + phone);
  writeJsonFile(OPERATORS_FILE, operators);
  res.json({ success: true, message: 'Operador removido' });
});

// Global operator availability toggle
app.get('/api/operators/availability', (req, res) => {
  const config = getBookingConfig();
  res.json({ available: config.operatorAvailable });
});

app.post('/api/operators/availability', (req, res) => {
  const { available } = req.body || {};
  if (typeof available !== 'boolean') return res.status(400).json({ error: 'Parámetro disponible inválido' });

  const config = getBookingConfig();
  config.operatorAvailable = available;
  writeJsonFile(APPOINTMENTS_CONFIG_FILE, config);
  res.json({ success: true, available: config.operatorAvailable });
});

// CRM appointments endpoints
app.get('/api/appointments', (req, res) => {
  res.json(readJsonFile(APPOINTMENTS_FILE));
});

app.post('/api/appointments', (req, res) => {
  const { id, chatId, customerName, dateTime, date, time, operatorName, area, notes } = req.body || {};
  if (!chatId || !dateTime) return res.status(400).json({ error: 'Faltan parámetros de la cita' });

  const appointments = readJsonFile(APPOINTMENTS_FILE);
  try { validateAppointment(dateTime, appointments, getBookingConfig()); }
  catch (err) { return res.status(409).json({ error: err.message }); }
  const newApp = {
    durationMin: getBookingConfig().durationMin,
    id: id || randomBytes(12).toString('hex'),
    chatId,
    customerName: customerName || 'Cliente',
    dateTime,
    date: dateTime.split('T')[0],
    time: dateTime.split('T')[1],
    operatorName: operatorName || 'Operador',
    area: area || 'Atención General',
    notes: notes || '',
    reminderSent: false
  };

  appointments.push(newApp);
  writeJsonFile(APPOINTMENTS_FILE, appointments);

  // Update CRM
  updateCustomerCRM(chatId, {
    status: 'Seguimiento',
    tag: '🟠 Seguimiento',
    nextAppointment: {
      date: newApp.date,
      time: newApp.time,
      operatorName: newApp.operatorName,
      area: newApp.area,
      notes: newApp.notes
    }
  });

  res.json({ success: true, appointment: newApp });
});

app.get('/api/appointments/config', (req, res) => {
  res.json(getBookingConfig());
});

app.post('/api/appointments/config', (req, res) => {
  const { workDays, openTime, closeTime, durationMin, minAdvanceHours, maxConcurrent, blockedDates } = req.body || {};

  const config = getBookingConfig();
  if (Array.isArray(workDays)) config.workDays = workDays.map(Number);
  if (typeof openTime === 'string') config.openTime = openTime;
  if (typeof closeTime === 'string') config.closeTime = closeTime;
  if (typeof durationMin !== 'undefined') config.durationMin = Number(durationMin);
  if (typeof minAdvanceHours !== 'undefined') config.minAdvanceHours = Number(minAdvanceHours);
  if (typeof maxConcurrent !== 'undefined') config.maxConcurrent = Number(maxConcurrent);
  if (Array.isArray(blockedDates)) config.blockedDates = blockedDates;

  try { validateBookingConfig(config); } catch (err) { return res.status(400).json({ error: err.message }); }
  writeJsonFile(APPOINTMENTS_CONFIG_FILE, config);
  res.json({ success: true, config });
});

// Original whatsapp settings configurations
app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: connectionStatus,
    qrDataUrl: currentQrDataUrl,
    connectedPhone: connectedUserPhone,
    paused: isBotPaused
  });
});

app.get(['/api/whatsapp/pause', '/api/bot/toggle'], (req, res) => {
  res.json({ paused: isBotPaused });
});

app.post(['/api/whatsapp/pause', '/api/bot/toggle'], (req, res) => {
  const { paused, enabled } = req.body || {};
  if (typeof enabled === 'boolean') {
    isBotPaused = !enabled;
  } else if (typeof paused === 'boolean') {
    isBotPaused = paused;
  } else {
    isBotPaused = !isBotPaused;
  }
  persistSettings();
  res.json({ success: true, paused: isBotPaused, enabled: !isBotPaused });
});

// Bot Restart / Power Cycle Endpoint (Preserves WhatsApp Session)
app.post(['/api/bot/restart', '/api/whatsapp/restart'], async (req, res, next) => {
  try {
    initData();
    await runConnectionAction(() => qrConnection.restart());
    res.json({ success: true, message: 'Reconexión iniciada. Se conserva la sesión y la configuración.' });
  } catch (err) { next(err); }
});
function removeAuthDirectory() {
  const resolved = path.resolve(AUTH_DIR);
  if (resolved !== path.resolve(process.cwd(), 'auth_info_baileys')) throw new Error('Ruta de sesión inválida.');
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
}
app.post('/api/whatsapp/clear-session', async (req, res, next) => {
  try {
    await runConnectionAction(async () => {
      await qrConnection.disconnect();
      removeAuthDirectory();
      await qrConnection.start();
    });
    res.json({ success: true, message: 'Esperando un nuevo QR para vincular WhatsApp.' });
  } catch (err) { next(err); }
});

app.get('/api/whatsapp/logs', (req, res) => {
  res.json(liveServerLogs);
});

app.delete('/api/whatsapp/logs', (req, res) => {
  liveServerLogs.length = 0;
  res.json({ success: true, message: 'Logs eliminados.' });
});

app.post('/api/config/whisper-key', (req, res) => {
  const { whisperKey } = req.body || {};
  if (typeof whisperKey === 'string') {
    if (whisperKey.trim()) customWhisperApiKey = whisperKey.trim();
    persistSettings();
    res.json({ success: true, message: 'Clave Whisper guardada.' });
  } else {
    res.status(400).json({ error: 'Parámetro inválido' });
  }
});

app.post('/api/config/system-prompt', (req, res) => {
  const { prompt } = req.body || {};
  if (typeof prompt === 'string' && prompt.trim()) {
    customWpSystemPrompt = prompt.trim();
    persistSettings();
    res.json({ success: true, message: 'Prompt guardado.' });
  } else {
    res.status(400).json({ error: 'Parámetro inválido' });
  }
});

app.post('/api/config/knowledge', (req, res) => {
  const { articles } = req.body || {};
  if (Array.isArray(articles) && articles.length <= 500 && Buffer.byteLength(JSON.stringify(articles)) <= 220000) {
    const ids = new Set();
    for (const article of articles) {
      if (!article || typeof article.id !== 'string' || !article.id || article.id.length > 128 || ids.has(article.id) || typeof article.title !== 'string' || !article.title.trim() || article.title.length > 300 || typeof article.content !== 'string' || !article.content.trim() || article.content.length > 100000) return res.status(400).json({ error: 'Revisá el identificador, el título y el contenido de cada documento.' });
      ids.add(article.id);
      for (const key of ['validFrom', 'validUntil', 'expiresAt', 'commercialValidUntil']) if (article[key] && !Number.isFinite(Date.parse(article[key]))) return res.status(400).json({ error: 'Fecha de vigencia inválida.' });
      if (article.validFrom && article.validUntil && Date.parse(article.validFrom) >= Date.parse(article.validUntil)) return res.status(400).json({ error: 'La fecha final debe ser posterior al inicio.' });
      if (article.approved !== undefined && typeof article.approved !== 'boolean') return res.status(400).json({ error: 'Estado de aprobación inválido.' });
      for (const key of ['clientId', 'customerId']) if (article[key] !== undefined && article[key] !== null && (typeof article[key] !== 'string' || article[key].length > 256)) return res.status(400).json({ error: 'Cliente asociado inválido.' });
    }
    if (req.body.revision !== undefined && req.body.revision !== revisionOf(serverKnowledgeBase)) return res.status(409).json({ error: 'El RAG cambió. Actualizá la lista antes de guardar.' });
    writeJsonFile(KNOWLEDGE_BASE_FILE, articles);
    serverKnowledgeBase = articles;
    res.json({ success: true, message: 'RAG actualizado.', revision: revisionOf(articles) });
  } else {
    res.status(400).json({ error: 'Parámetro inválido' });
  }
});

app.get('/api/config/knowledge', (req, res) => {
  res.json({ systemPrompt: customWpSystemPrompt, assistantSystemPrompt, articles: serverKnowledgeBase, revision: revisionOf(serverKnowledgeBase), model: currentModelName, temperature: currentTemperature, maxTokens: currentMaxTokens, apiKeyConfigured: Boolean(OPENAI_API_KEY), whisperKeyConfigured: Boolean(customWhisperApiKey) });
});

app.post('/api/config/model', (req, res) => {
  const { model } = req.body || {};
  if (typeof model === 'string' && model.trim()) {
    currentModelName = model.trim();
    persistSettings();
    res.json({ success: true, message: 'Modelo actualizado.' });
  } else {
    res.status(400).json({ error: 'Parámetro inválido' });
  }
});

app.post('/api/config/temperature', (req, res) => {
  const { temperature } = req.body || {};
  const parsed = parseFloat(temperature);
  if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
    currentTemperature = parsed;
    persistSettings();
    res.json({ success: true, temperature: currentTemperature });
  } else {
    res.status(400).json({ error: 'Parámetro inválido' });
  }
});

app.post('/api/config/max-tokens', (req, res) => {
  const { maxTokens } = req.body || {};
  const parsed = parseInt(maxTokens);
  if (!isNaN(parsed) && parsed > 0 && parsed <= 16000) {
    currentMaxTokens = parsed;
    persistSettings();
    res.json({ success: true, maxTokens: currentMaxTokens });
  } else {
    res.status(400).json({ error: 'Parámetro inválido' });
  }
});

app.post('/api/whatsapp/logout', async (req, res, next) => {
  try { await runConnectionAction(async () => { await qrConnection.disconnect({ logout: true }); removeAuthDirectory(); }); res.json({ success: true, message: 'WhatsApp desvinculado. Generá un QR para conectar nuevamente.' }); }
  catch (err) { next(err); }
});
app.get('/api/health', (req, res) => res.json({ status: 'ok', whatsapp: connectionStatus }));
app.post('/api/config/settings', (req, res) => {
  const data = req.body || {};
  if (data.model !== undefined && (typeof data.model !== 'string' || !data.model.trim() || data.model.length > 100)) return res.status(400).json({ error: 'Modelo inválido.' });
  if (data.temperature !== undefined && (!Number.isFinite(data.temperature) || data.temperature < 0 || data.temperature > 1)) return res.status(400).json({ error: 'Temperatura inválida.' });
  if (data.maxTokens !== undefined && (!Number.isInteger(data.maxTokens) || data.maxTokens < 1 || data.maxTokens > 16000)) return res.status(400).json({ error: 'Límite de respuesta inválido.' });
  if (data.model) currentModelName = data.model.trim();
  if (data.temperature !== undefined) currentTemperature = data.temperature;
  if (data.maxTokens !== undefined) currentMaxTokens = data.maxTokens;
  if (typeof data.apiKey === 'string' && data.apiKey.trim()) OPENAI_API_KEY = data.apiKey.trim();
  if (typeof data.whisperApiKey === 'string' && data.whisperApiKey.trim()) customWhisperApiKey = data.whisperApiKey.trim();
  if (typeof data.wpSystemPrompt === 'string' && data.wpSystemPrompt.trim()) customWpSystemPrompt = data.wpSystemPrompt.trim();
  if (typeof data.assistantSystemPrompt === 'string' && data.assistantSystemPrompt.trim()) assistantSystemPrompt = data.assistantSystemPrompt.trim();
  persistSettings();
  res.json({ success: true });
});
app.post('/api/config/test', async (req, res) => {
  const key = typeof req.body?.apiKey === 'string' && req.body.apiKey.trim() ? req.body.apiKey.trim() : OPENAI_API_KEY;
  if (!key) return res.status(400).json({ error: 'Configurá una clave de IA para probar la conexión.' });
  const isNv = key.startsWith('nvapi-');
  try {
    const response = await fetch(isNv ? 'https://integrate.api.nvidia.com/v1/chat/completions' : OPENAI_BASE_URL + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(completionBody({ model: req.body?.model || currentModelName, messages: [{ role: 'user', content: 'Respondé OK.' }], maxTokens: 15, isNvidia: isNv })),
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: data.error?.message || 'El proveedor rechazó la conexión.' });
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: 'No se pudo conectar con el proveedor de IA: ' + err.message }); }
});
app.post('/api/contact', (req, res) => {
  const { name, email, phone, company, message } = req.body || {};
  if (![name, email, phone, company, message].every(value => typeof value === 'string' && value.trim() && value.length <= 6000) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Completá tus datos de contacto y una consulta válida.' });
  const id = 'contact_' + randomBytes(12).toString('hex');
  updateCustomerCRM(id, { name: name.trim(), email: email.trim(), phone: phone.trim(), company: company.trim(), notes: message.trim(), tag: '🟡 Potencial cliente', status: 'Nuevo' });
  activeChats[id] = { id, type: 'web', name: name.trim(), phone: phone.trim(), botPaused: true, pauseReason: 'contact', messages: [{ id: randomBytes(12).toString('hex'), sender: 'user', text: message.trim(), timestamp: new Date().toISOString() }] };
  flushChats();
  res.status(201).json({ success: true });
});
app.use((err, req, res, next) => {
  console.error('Error de API:', err.message);
  if (!res.headersSent) res.status(err.status || 500).json({ error: err.status === 413 ? 'La solicitud es demasiado grande.' : 'No se pudo completar la operación. Intentá nuevamente.' });
});

if (process.env.BOT_TEST_MODE !== 'true') app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor WhatsApp Web (Baileys) AITUE iniciado en http://localhost:${PORT}`);
  startBaileysSocket();
});

// Launch Frontend Web App Server on Port 3000 in the same master process
if (process.env.SERVE_FRONTEND === 'true') {
  const frontendApp = express();
  frontendApp.use((req, res, next) => {
    if (!req.path.startsWith('/assets/')) res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const p = req.path.toLowerCase();
    if (p === '/admin') return res.redirect('/admin.html');
    if (p === '/empresas') return res.redirect('/empresas.html');
    if (p === '/contacto') return res.redirect('/contacto.html');
    if (p === '/tienda') return res.redirect('/tienda.html');
    next();
  });

  frontendApp.use(app);
  frontendApp.use(express.static('dist', { maxAge: '1h' }));

  const FRONTEND_PORT = process.env.PORT || 3000;
  if (process.env.BOT_TEST_MODE !== 'true') frontendApp.listen(FRONTEND_PORT, '0.0.0.0', () => {
    console.log(`💻 Servidor Frontend Web AITUE iniciado en http://localhost:${FRONTEND_PORT}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ Puerto ${FRONTEND_PORT} ya está en uso.`);
    } else {
      console.error('Error en servidor frontend:', err);
    }
  });
}

async function shutdown() {
  clearInterval(stateFlushTimer);
  clearInterval(reminderTimer);
  for (const timer of Object.values(inactivityTimers)) clearTimeout(timer);
  await qrConnection.disconnect();
  flushChats();
}
if (process.env.BOT_TEST_MODE !== 'true') {
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown().then(() => process.exit(0)).catch(() => process.exit(1)));
}
export { app, shutdown };
export const testHooks = process.env.BOT_TEST_MODE === 'true' ? {
  handleBaileysBatch, runReminders, activeChats, incomingQueue, getBookingConfig,
  generateOpenAIResponse, customerMemory, ragRetriever, groundedAssistant, assistantSettings,
  setSocket(socket) { sock = socket; connectionStatus = socket ? 'CONNECTED' : 'DISCONNECTED'; },
  setPaused(value) { isBotPaused = value; }
} : null;
