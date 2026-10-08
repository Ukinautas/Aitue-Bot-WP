// ----------------------------------------------------
// AITUE COMUNICA S.A. - GENERADOR DE RESPUESTAS Y REDACCIÓN IA
// ----------------------------------------------------

import ContextManager from './context-manager.js';
import { PROTOCOLS } from './protocols.js';

export default class ResponseGenerator {
  static formatResponse(chatId, classification, routeResult, userInput, llmOutput = null) {
    const state = ContextManager.getState(chatId);
    const textLower = (userInput || '').toLowerCase().trim();
    const isGreeting = textLower.includes('hola') || textLower.includes('buenas') || textLower.includes('buen dia');


    // Registrar en ContextManager los resultados semánticos devueltos por el clasificador
    ContextManager.setClassificationResult(chatId, classification);
    ContextManager.updateState(chatId, {
      pendingProductDetailChoice: routeResult.action === 'SEND_PRODUCT_DETAIL_CLARIFICATION'
    });

    // 1. Si es saludo solamente
    if (routeResult.intent === 'GREETING_ONLY') {
      ContextManager.markGreeted(chatId);
      this.logDebug(chatId, userInput, classification, routeResult);
      return PROTOCOLS.WELCOME;
    }

    // 2. Si es segundo saludo
    if (routeResult.intent === 'SECOND_GREETING') {
      this.logDebug(chatId, userInput, classification, routeResult);
      return PROTOCOLS.SECOND_GREETING;
    }

    // 3. Si es despedida
    if (routeResult.intent === 'FAREWELL') {
      this.logDebug(chatId, userInput, classification, routeResult);
      return PROTOCOLS.FAREWELL;
    }

    // 4. Si la IA generó una redacción natural que ya respeta los datos decididos por el router:
    if (llmOutput && llmOutput.trim() && !routeResult.isFallback && classification.primary_area !== 'PRODUCTO_INFO') {
      let cleanedText = this.cleanDuplicatesAndFillers(llmOutput.trim());

      // Si fue Saludo + Consulta, asegurar que comience con saludo breve si aún no saludó
      if (isGreeting && !state.hasGreeted && !cleanedText.toLowerCase().includes('hola')) {
        cleanedText = `¡Hola! 👋 ${cleanedText}`;
      }

      ContextManager.markGreeted(chatId);
      if (routeResult.areaId) ContextManager.setTopic(chatId, routeResult.areaId);

      this.logDebug(chatId, userInput, classification, routeResult);
      return cleanedText;
    }

    // 5. Utilizar la Respuesta Base Oficial Decidida por el Router
    let finalResponse = routeResult.response;

    // Si el usuario incluyó saludo ("Hola, quiero contratar Internet"), agregar saludo breve
    if (isGreeting && !state.hasGreeted) {
      finalResponse = `¡Hola! 👋 ${finalResponse}`;
    }

    // Actualizar estado de contexto
    ContextManager.markGreeted(chatId);
    if (routeResult.areaId) ContextManager.setTopic(chatId, routeResult.areaId);

    if (routeResult.requiresClarification) {
      ContextManager.setClarificationAsked(chatId, true);
    } else {
      ContextManager.setClarificationAsked(chatId, false);
    }

    ContextManager.updateState(chatId, {
      pendingCommercialAdviceConfirmation:
        /asesoramiento[^.\n]*respond[eé][^.\n]*["“]?s[ií](?:[^a-z]|$)/i.test(finalResponse)
    });

    this.logDebug(chatId, userInput, classification, routeResult);
    return this.cleanDuplicatesAndFillers(finalResponse);
  }

  static cleanDuplicatesAndFillers(rawText) {
    if (!rawText) return rawText;
    let text = rawText.trim();

    // Eliminar notas parentéticas e indicaciones explícitas como (como V2)
    text = text.replace(/\s*\(\s*como V2\s*\)/gi, '');
    text = text.replace(/\s*\(como V2\)/gi, '');
    text = text.replace(/\s*\(\s*como V2 o consultas de stock\s*\)/gi, '');
    text = text.replace(/\s*\(\s*Una sola vez por conversación\s*\)/gi, '');
    text = text.replace(/\s*\(\s*Una sola vez\s*\)/gi, '');
    text = text.replace(/\s*\(\s*Atención 24\/7\s*\)/gi, ' — Atención 24/7');
    text = text.replace(/\s*\(\s*Lun-Vie 09:00 a 18:00 hs AR\s*\)/gi, ' — Lunes a viernes, 09:00 a 18:00 hs AR');

    // Eliminar todos los asteriscos (*) de formato
    text = text.replace(/\*/g, '');

    // Deduplicar contacto de Gerencia Comercial
    const comercialMatches = text.match(/susana@aitue\.net/gi);
    if (comercialMatches && comercialMatches.length > 1) {
      const comercialBlock = `💼 Gerencia Comercial\n📧 susana@aitue.net | 📞 +54 9 11 4164-0955 — Atención 24/7`;
      text = text.replace(/(?:(?:•|\*|-)?\s*Gerencia Comercial[^\n]*\n?|💼[^\n]*Gerencia Comercial[^\n]*\n?|📧\s*susana@aitue\.net[^\n]*\n?|📞\s*\+54 9 11 4164-0955[^\n]*\n?)+/gi, '\n__COMERCIAL_MARKER__\n');
      text = text.replace(/(?:__COMERCIAL_MARKER__\s*)+/g, `\n${comercialBlock}\n`).trim();
    }

    return text;
  }

  static logDebug(chatId, message, classification, routeResult) {
    if (typeof process !== 'undefined' && process.env.BOT_DEBUG !== 'true') return;
    console.log(`\n[CHAT_LOG] chatId="${chatId}" message="${message}"`);
    console.log(`[PRIMARY AREA] ${classification.primary_area} (Confidence: ${classification.confidence})`);
    console.log(`[SECONDARY AREAS] ${JSON.stringify(classification.secondary_areas)}`);
    console.log(`[REASON] ${classification.reason}`);
    console.log(`[ROUTE] Area="${routeResult.area}" Action="${routeResult.action}"`);
    console.log(`[RESPONSIBLE] ${routeResult.responsible ? routeResult.responsible.map(r => r.name).join(', ') : 'Ninguno'}`);
    console.log(`[FALLBACK] ${routeResult.isFallback}`);

    // Generar y emitir Resumen Estructurado para el Operador
    const summary = ContextManager.generateSummaryForOperator(chatId, routeResult, routeResult.customerPhone);
    console.log(`\n----------------------------------------\n${summary}\n----------------------------------------\n`);
  }
}
