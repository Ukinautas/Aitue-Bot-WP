// ----------------------------------------------------
// AITUE COMUNICA S.A. - GESTOR DE CONTEXTO Y ESTADO DE CONVERSACIÓN
// ----------------------------------------------------

const conversationStates = Object.create(null);

export default class ContextManager {
  static memoryObserver = null;
  static setMemoryObserver(observer) { this.memoryObserver = observer; }
  static snapshot() { return structuredClone(conversationStates); }
  static retain(chatIds) {
    const retained = new Set(chatIds);
    for (const id of Object.keys(conversationStates)) if (!retained.has(id)) delete conversationStates[id];
  }
  static restore(states) {
    for (const [id, state] of Object.entries(states || {})) conversationStates[id] = state;
  }
  static getState(chatId) {
    if (!conversationStates[chatId]) {
      let isInternationalNumber = false;
      if (chatId && typeof chatId === 'string') {
        const cleanDigits = chatId.split('@')[0].replace(/\D/g, '');
        // Si tiene longitud de número telefónico (>= 8 dígitos) y NO empieza con 54 (Argentina)
        if (cleanDigits.length >= 8 && !cleanDigits.startsWith('54')) {
          isInternationalNumber = true;
        }
      }

      conversationStates[chatId] = {
        chatId: chatId,
        isInternationalNumber: isInternationalNumber,
        hasGreeted: false,
        currentTopic: null,
        lastIntent: null,
        primary_area: null,
        secondary_areas: [],
        confidence: 0,
        reason: null,
        lastBotQuestion: null,
        pendingCommercialAdviceConfirmation: false,
        weekendNoticePeriod: null,
        sharedContacts: [],
        sharedLinks: {
          web: false,
          shop: false,
          facebook: false,
          instagram: false,
          linkedin: false
        },
        clarificationAsked: false,
        messagesCount: 0,
        history: [], // Historial conversacional multiturno (últimos 8 mensajes)
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
    return conversationStates[chatId];
  }

  static addMessage(chatId, role, text) {
    const state = this.getState(chatId);
    if (!state.history) state.history = [];
    state.history.push({
      role, // 'user' | 'assistant'
      text: (text || '').trim(),
      timestamp: new Date().toISOString()
    });
    // Mantener sólo los últimos 8 mensajes
    if (state.history.length > 8) {
      state.history = state.history.slice(-8);
    }
    state.messagesCount = (state.messagesCount || 0) + 1;
    state.updatedAt = new Date().toISOString();
    if (role === 'user') this.memoryObserver?.(chatId, text, state.history);
    return state;
  }

  static getHistoryText(chatId) {
    const state = this.getState(chatId);
    if (!state.history || state.history.length === 0) return '';
    return state.history
      .map(m => `${m.role === 'user' ? 'Cliente' : m.role === 'operator' ? 'Asesor' : 'Bot'}: ${m.text}`)
      .join('\n');
  }

  static extractEntitiesFromHistory(history = []) {
    const fullText = history.map(h => h.text).join(' ').toLowerCase();
    const entities = [];

    if (fullText.includes('starlink') || fullText.includes('mini') || fullText.includes('pro') || fullText.includes('standard') || fullText.includes('ultra')) {
      entities.push('Líneas AITUE (Standard/Pro/Ultra+) y terminales Starlink compatibles (Mini/Mini X)');
    }
    if (fullText.includes('cable') || fullText.includes('fuente') || fullText.includes('220v') || fullText.includes('12v') || fullText.includes('dbt') || fullText.includes('conector') || fullText.includes('transformador') || fullText.includes('accesorio')) {
      entities.push('Accesorios/Cables (12V/220V/DBT)');
    }
    if (fullText.includes('roto') || fullText.includes('rompio') || fullText.includes('falla') || fullText.includes('no funciona') || fullText.includes('daño') || fullText.includes('danado')) {
      entities.push('Problema Técnico/Falla Reportada');
    }
    if (fullText.includes('sin senal') || fullText.includes('activar') || fullText.includes('baja') || fullText.includes('basja') || fullText.includes('conectividad') || fullText.includes('internet')) {
      entities.push('Gestión de Servicio/Conectividad');
    }
    if (fullText.includes('pedido') || fullText.includes('envio') || fullText.includes('mercado libre') || fullText.includes('despacho') || fullText.includes('no llego')) {
      entities.push('Seguimiento de Pedido/Mercado Libre');
    }

    return entities.length > 0 ? entities.join(' | ') : 'Consulta General';
  }

  static generateSummaryForOperator(chatId, routeResult = {}, customerPhone = null, customerIdentity = {}) {
    const state = this.getState(chatId);
    const phoneSource = customerPhone || routeResult.customerPhone ||
      (chatId?.endsWith('@s.whatsapp.net') ? chatId.split('@')[0].split(':')[0] : '');
    const phoneDigits = String(phoneSource).replace(/\D/g, '');
    const formattedPhone = phoneDigits ? `+${phoneDigits}` : 'No disponible';
    const cleanIdentityValue = value => {
      const identity = String(value || '').replace(/\s+/g, ' ').trim();
      if (!identity || identity.includes('@') || /^whatsapp\s*:/i.test(identity)) return '';
      return identity;
    };
    const customerName = cleanIdentityValue(customerIdentity.name);
    const companyName = cleanIdentityValue(customerIdentity.company);
    const userMessages = (state.history || []).filter(message => message.role === 'user');
    const latestCustomerMessage = userMessages.at(-1)?.text
      ?.replace(/\s+/g, ' ')
      .trim() || 'Consulta no disponible';
    const confirmationOnly = /^(?:si|claro|dale|ok|okay|de acuerdo|por favor|me interesa|confirmo)\b[.!\s]*$/i;
    const normalizeSummaryText = value => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    const substantiveCustomerMessage = [...userMessages]
      .reverse()
      .find(message => !confirmationOnly.test(normalizeSummaryText(message.text)))?.text
      ?.replace(/\s+/g, ' ')
      .trim();
    const consultationLines = substantiveCustomerMessage && substantiveCustomerMessage !== latestCustomerMessage
      ? [`Consulta: ${substantiveCustomerMessage}`, `Confirmación del cliente: ${latestCustomerMessage}`]
      : [`Consulta: ${latestCustomerMessage}`];
    const summary = [
      `Cliente: ${customerName || 'No disponible'}`,
      ...(companyName ? [`Empresa: ${companyName}`] : []),
      ...consultationLines,
      `Teléfono: ${formattedPhone}`
    ].join('\n');

    state.lastOperatorSummary = summary;
    return summary;
  }

  static updateState(chatId, updates) {
    const state = this.getState(chatId);
    Object.assign(state, updates, { updatedAt: new Date().toISOString() });
    return state;
  }

  static setClassificationResult(chatId, classification) {
    const updates = {
      primary_area: classification.primary_area,
      secondary_areas: classification.secondary_areas || [],
      confidence: classification.confidence,
      reason: classification.reason,
      lastIntent: classification.primary_area
    };

    if (classification.primary_area === 'FAREWELL') {
      updates.hasGreeted = false;
    }

    return this.updateState(chatId, updates);
  }

  static markGreeted(chatId) {
    return this.updateState(chatId, { hasGreeted: true });
  }

  static setTopic(chatId, topic) {
    return this.updateState(chatId, { currentTopic: topic });
  }

  static setLastIntent(chatId, intent) {
    return this.updateState(chatId, { lastIntent: intent });
  }

  static setClarificationAsked(chatId, asked) {
    return this.updateState(chatId, { clarificationAsked: asked });
  }

  static addSharedContact(chatId, contactId) {
    const state = this.getState(chatId);
    if (!state.sharedContacts.includes(contactId)) {
      state.sharedContacts.push(contactId);
    }
    return state;
  }

  static resetState(chatId) {
    delete conversationStates[chatId];
    return this.getState(chatId);
  }
}
