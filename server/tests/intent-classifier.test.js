// Corpus de regresión: cada mensaje representa una intención y una forma habitual de escribirla.
// node --test server/intent-classifier.test.js ejecuta estas comprobaciones sin dependencias extra.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import BotRouter from '../bot-router.js';
import ContextManager from '../context-manager.js';
import IntentClassifier from '../intent-classifier.js';
import ResponseGenerator from '../response-generator.js';

const typoAndMalformedQueries = [
  { input: 'kiero saber el presio del pro', area: 'PRODUCTO_COMERCIAL' },
  { input: 'qiero conprar un aitue pro', area: 'PRODUCTO_COMERCIAL' },
  { input: 'que preçio tiene el ultra', area: 'PRODUCTO_COMERCIAL' },
  { input: 'donde estn ubicados', area: 'UBICACION_GENERAL' },
  { input: 'no me yega el pedido', area: 'ENVIO_MERCADOLIBRE' },
  { input: 'mi starlink no funsiona', area: 'PRODUCTO_TECNICO' },
  { input: 'qiero activar mi antena', area: 'INTERNET_SOPORTE' },
  { input: 'tengo problmas con el internet', area: 'INTERNET_SOPORTE' },
  { input: 'me llego rto el cable', area: 'ENVIO_MERCADOLIBRE' },
  { input: 'ayuda con la antena', area: 'INTERNET_SOPORTE' },
  { input: 'necesito aser una cotizacion', area: 'PRODUCTO_COMERCIAL' },
  { input: 'no me anda la antena', area: 'PRODUCTO_TECNICO' },
  { input: 'quiero saver que modelos tienen', area: 'PRODUCTO_INFO' },
  { input: 'que formas de pago aseptan', area: 'FAQ_PAGOS' },
  { input: 'mi pago fue rechasado', area: 'PAGO' },
  { input: 'quiero ser distribuidor mayurista', area: 'DISTRIBUIDORES' },
  { input: 'hola quiero comprar un cable', area: 'PRODUCTO_COMERCIAL' },
];

describe('IntentClassifier typo and malformed-query corpus', () => {
  for (const { input, area } of typoAndMalformedQueries) {
    it(`classifies "${input}" as ${area}`, () => {
      assert.equal(IntentClassifier.classify(input).primary_area, area);
    });
  }

  it('normalizes misspellings without changing the intended words', () => {
    assert.equal(
      IntentClassifier.normalizeText('Kiero conprar: mi starlink no funsiona'),
      'quiero comprar mi starlink no funciona'
    );
  });

  it('keeps vague messages in the clarification fallback', () => {
    const result = IntentClassifier.classify('no se que necesito');
    assert.equal(result.primary_area, 'OPERATIVA');
    assert.ok(result.confidence < 0.7);
  });

  it('routes remito requests to Pagos y facturación instead of Gerencia Comercial', () => {
    for (const input of [
      'Quiero mi remito de compra',
      'Quería pedir mi remito de compra',
      'Sí, necesito mi factura',
      'Quiero mi remito y derivame al Sector Comercial'
    ]) {
      const classification = IntentClassifier.classify(input);
      const route = BotRouter.route(classification);

      assert.equal(classification.primary_area, 'PAGO');
      assert.equal(route.area, 'Facturación y Administración');
      assert.equal(route.action, 'PAUSE_BOT');
    }

    assert.equal(
      IntentClassifier.classify('Sí, necesito mi factura', {
        pendingCommercialAdviceConfirmation: true,
        secondary_areas: ['PRODUCT_CATALOG']
      }).primary_area,
      'PAGO'
    );
    assert.equal(
      IntentClassifier.classify('Quiero mi remito y derivame al Sector Comercial', {
        pendingProductDetailChoice: true
      }).primary_area,
      'PAGO'
    );
  });

  it('keeps product questions and purchase/shipping requests out of the international sales route', () => {
    const cableQuestion = IntentClassifier.classify('Que cable se usa para alimentar la antena');
    assert.equal(cableQuestion.primary_area, 'PRODUCTO_TECNICO');
    assert.ok(cableQuestion.secondary_areas.includes('ACCESSORIES_ADVICE'));

    const shippingPrice = IntentClassifier.classify('Cuanto cuesta envio a Chile');
    assert.equal(shippingPrice.primary_area, 'FAQ_ENVIOS');
    assert.equal(BotRouter.route(shippingPrice).action, 'SEND_FAQ_ENVIOS');

    const shipmentStatus = IntentClassifier.classify('No me llego el pedido a Chile');
    assert.equal(shipmentStatus.primary_area, 'ENVIO_MERCADOLIBRE');

    const internationalPurchase = IntentClassifier.classify('Quiero comprar un equipo desde Chile');
    assert.equal(internationalPurchase.primary_area, 'COMERCIAL_INTERNACIONAL');

    assert.equal(
      IntentClassifier.classify('Tengo problemas con el despacho y soy distribuidor').primary_area,
      'ENVIO_MERCADOLIBRE'
    );
  });

  it('routes product purchases for internet use to product sales, not satellite internet sales', () => {
    const classification = IntentClassifier.classify('Quiero comprar un cable para Internet');
    assert.equal(classification.primary_area, 'PRODUCTO_COMERCIAL');
    assert.equal(BotRouter.route(classification).action, 'SEND_COMMERCIAL_HANDOFF');
  });

  it('prioritizes internet-service problems over a simultaneous plan inquiry', () => {
    const classification = IntentClassifier.classify(
      'Tengo un problema de internet y quiero contratar un plan'
    );
    const route = BotRouter.route(classification);

    assert.equal(classification.primary_area, 'INTERNET_SOPORTE');
    assert.ok(classification.secondary_areas.includes('INTERNET_COMERCIAL'));
    assert.deepEqual(
      BotRouter.getHandoffContacts(route).map(contact => contact.id),
      ['soporte_tecnico', 'comercial']
    );
  });

  it('uses international sales contacts for commercial inquiries from international numbers', () => {
    const classification = IntentClassifier.classify('Quiero comprar una antena', {
      isInternationalNumber: true
    });
    const route = BotRouter.route(classification);

    assert.equal(classification.primary_area, 'COMERCIAL_INTERNACIONAL');
    assert.equal(route.responsible[0].id, 'comercial_internacional');
  });

  it('recognizes numeric menu selections and product-line choices in their respective contexts', () => {
    const menuAreas = {
      4: 'INTERNET_SOPORTE',
      5: 'PAGO',
      6: 'ENVIO_MERCADOLIBRE',
      7: 'B2B',
      8: 'DISTRIBUIDORES'
    };

    for (const [option, area] of Object.entries(menuAreas)) {
      assert.equal(IntentClassifier.classify(option).primary_area, area);
      assert.equal(IntentClassifier.classify(`opcion ${option}`).primary_area, area);
    }

    const productChoices = {
      1: 'STANDARD_ADVICE',
      2: 'PRO_ADVICE',
      3: 'ULTRA_ADVICE'
    };
    for (const [option, secondaryArea] of Object.entries(productChoices)) {
      const classification = IntentClassifier.classify(option, {
        secondary_areas: ['PROTECTOR_ADVICE']
      });
      assert.equal(classification.primary_area, 'PRODUCTO_COMERCIAL');
      assert.ok(classification.secondary_areas.includes(secondaryArea));
    }
  });

  it('classifies multiple vehicles as a B2B inquiry', () => {
    assert.equal(
      IntentClassifier.classify('Tengo cinco camionetas y quiero cotizar').primary_area,
      'B2B'
    );
  });

  it('does not mistake product protection networks for social-media requests', () => {
    const classification = IntentClassifier.classify('Quiero ver redes de proteccion para antena');
    assert.equal(classification.primary_area, 'PRODUCTO_COMERCIAL');
    assert.ok(classification.secondary_areas.includes('PROTECTOR_ADVICE'));
    assert.equal(IntentClassifier.classify('Quiero ver las redes sociales oficiales').primary_area, 'REDES_INFO');
  });

  it('preserves context-dependent product choices', () => {
    const result = IntentClassifier.classify('para auto', {
      lastIntent: 'PRODUCTO_COMERCIAL',
    });
    assert.equal(result.primary_area, 'PRODUCTO_COMERCIAL');
    assert.ok(result.secondary_areas.includes('PRO_ADVICE'));
  });

  it('honors the commercial handoff choice after a product detail prompt', () => {
    const result = IntentClassifier.classify('Quiero que me derive al Sector Comercial', {
      pendingProductDetailChoice: true,
    });
    assert.equal(result.primary_area, 'PRODUCTO_COMERCIAL');
    assert.ok(result.secondary_areas.includes('COMMERCIAL_HANDOFF'));
  });

  it('routes affirmative replies to the commercial handoff after offering advice', () => {
    const chatId = `test-advice-confirmation-${Date.now()}`;
    const state = ContextManager.getState(chatId);
    const initialClassification = IntentClassifier.classify('Quiero saber que modelos tienen', state);
    const initialRoute = BotRouter.route(initialClassification, state);
    const prompt = ResponseGenerator.formatResponse(
      chatId,
      initialClassification,
      initialRoute,
      'Quiero saber que modelos tienen'
    );

    assert.match(prompt, /respond[eé] "sí"/i);
    assert.equal(state.pendingCommercialAdviceConfirmation, true);

    for (const reply of ['Sí', 'Sí, por favor', 'Sí, me interesa', 'Claro']) {
      const classification = IntentClassifier.classify(reply, state);
      const route = BotRouter.route(classification, state);

      assert.equal(classification.primary_area, 'PRODUCTO_COMERCIAL');
      assert.ok(classification.secondary_areas.includes('COMMERCIAL_HANDOFF'));
      assert.equal(BotRouter.isCustomerHandoff(route), true);
    }

    ContextManager.resetState(chatId);
  });

  it('derives commercial product requests without legacy product-advice responses', () => {
    const chatId = `test-commercial-handoff-${Date.now()}`;
    const state = ContextManager.getState(chatId);
    const initialMessage = 'Quiero ver redes de protección para antena';
    const initialClassification = IntentClassifier.classify(initialMessage, state);
    const initialRoute = BotRouter.route(initialClassification, state);
    const initialResponse = BotRouter.formatCustomerHandoffResponse(initialRoute);

    assert.equal(initialRoute.action, 'SEND_COMMERCIAL_HANDOFF');
    assert.equal(BotRouter.isCustomerHandoff(initialRoute), true);
    assert.match(initialResponse, /Gerencia Comercial/);
    assert.doesNotMatch(initialResponse, /Aitue Standard|soluciones 360/);

    ContextManager.resetState(chatId);
  });

  it('classifies a request to visit the product showroom as a visit', () => {
    assert.equal(
      IntentClassifier.classify('Quiero ir a conocer los productos').primary_area,
      'VISITA_COMERCIAL'
    );
  });

  it('routes a prior visit and accessory purchase to commercial visit handling, not technical support', () => {
    const result = IntentClassifier.classify(
      'El otro día hablé con esa empresa para pasar por ahí, para la compra de un soporte y que asesoraran con la aplicación'
    );

    assert.equal(result.primary_area, 'VISITA_COMERCIAL');
  });

  it('routes accessory purchases with advice to commercial instead of technical support', () => {
    const result = IntentClassifier.classify('Quiero comprar un soporte y que me asesoren con la aplicación');

    assert.equal(result.primary_area, 'PRODUCTO_COMERCIAL');
    assert.ok(!result.secondary_areas.includes('ACCESSORIES_ADVICE'));
  });

  it('distinguishes cable purchases from cable failures and quantity purchases', () => {
    for (const input of [
      'Tienen el cable para alimentar la antena',
      'Quería el cable de 12V',
      'Quiero 6 cables DBT',
      'hola, te queria a pedir el de 30v y un cable usb-c por separado, me decis cuanto te transfiero? el envio es a palermo, me interesaria que sea en el acto',
      'Estoy buscando el cable para starlink original con adaptador para el auto, quería comprar 15 de esos'
    ]) {
      const result = IntentClassifier.classify(input);
      assert.equal(result.primary_area, 'PRODUCTO_COMERCIAL', input);
      assert.equal(result.commercialHandoff, true, input);
    }

    const afterClarification = IntentClassifier.classify(
      'Tienen el cable para alimentar la antena',
      { clarificationAsked: true }
    );
    assert.equal(afterClarification.primary_area, 'PRODUCTO_COMERCIAL');
    assert.equal(afterClarification.commercialHandoff, true);

    for (const input of [
      'Se me rompió el cable de alimentación',
      'El cable no anda'
    ]) {
      const result = IntentClassifier.classify(input);
      assert.equal(result.primary_area, 'PRODUCTO_TECNICO', input);
    }
  });

  it('keeps vague help requests in the low-confidence clarification fallback', () => {
    for (const input of ['Necesito ayuda con una cosa', 'tengo una consulta rara']) {
      const result = IntentClassifier.classify(input);
      assert.equal(result.primary_area, 'OPERATIVA');
      assert.ok(result.confidence <= 0.69);
    }
  });

  it('uses accessory context to resolve a follow-up about what each cable does', () => {
    const result = IntentClassifier.classify('y para que sirve cada uno', {
      history: [{ role: 'user', text: 'quiero un cable de alimentacion 220' }],
      primary_area: 'PRODUCTO_TECNICO',
      secondary_areas: ['ACCESSORIES_ADVICE'],
    });
    assert.equal(result.primary_area, 'PRODUCTO_TECNICO');
    assert.ok(result.secondary_areas.includes('ACCESSORIES_EXPLANATION'));
  });

  it('classifies compatibility questions before applying fuzzy intent matching', () => {
    assert.equal(
      IntentClassifier.classify('compatibilidad starlink mini funciona a 12v').primary_area,
      'FAQ_COMPATIBILIDAD'
    );
  });

  it('keeps comparison requests in the product information route', () => {
    const result = IntentClassifier.classify('compara las soluciones y antenas');
    assert.equal(result.primary_area, 'PRODUCTO_INFO');
    assert.deepEqual(result.secondary_areas, []);
  });

  it('keeps operator replies distinct from bot replies in conversation summaries', () => {
    const chatId = `test-operator-history-${Date.now()}`;
    ContextManager.addMessage(chatId, 'user', 'Consulta del cliente');
    ContextManager.addMessage(chatId, 'operator', 'Respuesta de una persona');
    ContextManager.addMessage(chatId, 'assistant', 'Respuesta del bot');

    assert.match(ContextManager.getHistoryText(chatId), /Asesor: Respuesta de una persona/);
    assert.match(ContextManager.getHistoryText(chatId), /Bot: Respuesta del bot/);
    ContextManager.resetState(chatId);
  });
});
