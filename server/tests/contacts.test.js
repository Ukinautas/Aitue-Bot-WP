import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONTACTS } from '../contacts.js';
import BotRouter from '../bot-router.js';
import ContextManager from '../context-manager.js';
import IntentClassifier from '../intent-classifier.js';
import ResponseGenerator from '../response-generator.js';

describe('Centralized operations contact details', () => {
  it('keeps operations customer-facing contacts email-only and disables their WhatsApp handoff notifications', () => {
    for (const contact of [CONTACTS.envios, CONTACTS.operativa]) {
      assert.equal(contact.phone, '');
      assert.equal(contact.waLink, '');
      assert.equal(contact.notifyOnHandoff, false);
      assert.ok(!contact.getVCard().includes('TEL;'));
      assert.ok(contact.getVCard().includes('EMAIL:clientes@aitue.net'));
    }
  });

  it('provides the customer service email for package and shipping issues', () => {
    for (const inquiry of ['no me yega el pedido', 'consulta sobre paquetes y envíos']) {
      const route = BotRouter.route(IntentClassifier.classify(inquiry));
      const response = BotRouter.formatCustomerHandoffResponse(route);

      assert.equal(route.primary_area, 'ENVIO_MERCADOLIBRE');
      assert.match(response, /Gracias por comentarnos tu situación/);
      assert.match(response, /paquetes y envíos/);
      assert.match(response, /clientes@aitue\.net/);
      assert.match(response, /Horario de atención de Operativa: lunes a viernes, de 09:00 a 18:00 hs \(Argentina\)/);
      assert.doesNotMatch(response, /Operativa.*contactará|se pondrá en contacto con vos|6300-5133/);
    }
  });

  it('routes technical product and satellite support handoffs to the configured support number', () => {
    const technicalRoute = BotRouter.route(IntentClassifier.classify('mi producto no funciona'));
    const connectivityRoute = BotRouter.route(IntentClassifier.classify('tengo problemas de conectividad'));

    assert.equal(CONTACTS.soporte_tecnico.phone, '+54 9 3872 12-7974');
    assert.equal(CONTACTS.soporte_tecnico.waLink, 'https://wa.me/5493872127974');
    assert.equal(BotRouter.getHandoffNotificationContacts(technicalRoute)[0], CONTACTS.soporte_tecnico);
    assert.equal(BotRouter.getHandoffNotificationContacts(connectivityRoute)[0], CONTACTS.soporte_tecnico);
  });

  it('hands off product purchases to Commercial instead of sending product advice', () => {
    const classification = IntentClassifier.classify('Quiero comprar un Ultra');
    const route = BotRouter.route(classification);

    assert.equal(route.primary_area, 'PRODUCTO_COMERCIAL');
    assert.equal(BotRouter.isCustomerHandoff(route), true);
    assert.deepEqual(BotRouter.getHandoffNotificationContacts(route), [CONTACTS.comercial]);
    assert.match(BotRouter.formatCustomerHandoffResponse(route), /Gerencia Comercial.*se pondrá en contacto/s);
    assert.match(BotRouter.formatCustomerHandoffResponse(route), /Horario de atención del área: 24\/7/);
  });

  it('routes distributors to national or international WhatsApp contacts', () => {
    const domesticClassification = IntentClassifier.classify('quiero ser distribuidor argentino');
    const internationalClassification = IntentClassifier.classify('quiero ser distribuidor en Chile');
    const phoneBasedInternationalClassification = IntentClassifier.classify('quiero ser distribuidor', {
      isInternationalNumber: true
    });
    const domesticRoute = BotRouter.route(domesticClassification);
    const internationalRoute = BotRouter.route(internationalClassification);
    const phoneBasedInternationalRoute = BotRouter.route(phoneBasedInternationalClassification);

    assert.deepEqual(BotRouter.getHandoffNotificationContacts(domesticRoute).map(contact => contact.phone), [
      '+54 9 11 4164-0955'
    ]);
    assert.deepEqual(BotRouter.getHandoffNotificationContacts(internationalRoute).map(contact => contact.phone), [
      '+54 9 11 6230-0000'
    ]);
    assert.deepEqual(BotRouter.getHandoffNotificationContacts(phoneBasedInternationalRoute).map(contact => contact.phone), [
      '+54 9 11 6230-0000'
    ]);
    assert.equal(CONTACTS.distribuidores.phone, '+54 9 11 4164-0955');
  });

  it('pauses the bot for payment issues without sending a handoff notification', () => {
    const route = BotRouter.route(IntentClassifier.classify('mi pago fue rechazado'));
    const paymentFaqRoute = BotRouter.route(IntentClassifier.classify('que formas de pago aceptan'));

    assert.equal(route.action, 'PAUSE_BOT');
    assert.equal(route.pauseBot, true);
    assert.match(route.response, /aguardá un momento/);
    assert.match(route.response, /Horario de atención de Facturación y Administración: 24\/7/);
    assert.equal(BotRouter.isCustomerHandoff(route), false);
    assert.deepEqual(BotRouter.getHandoffNotificationContacts(route), []);
    assert.equal(paymentFaqRoute.action, 'PAUSE_BOT');
    assert.equal(paymentFaqRoute.pauseBot, true);
  });

  it('answers shipping FAQ directly with the customer service email', () => {
    const chatId = `test-shipping-faq-${Date.now()}`;
    const classification = IntentClassifier.classify('cuales son los tiempos de envio');
    const route = BotRouter.route(classification);
    const response = ResponseGenerator.formatResponse(chatId, classification, route, 'cuales son los tiempos de envio');

    assert.equal(classification.primary_area, 'FAQ_ENVIOS');
    assert.equal(route.action, 'SEND_FAQ_ENVIOS');
    assert.match(response, /24 a 48 hs/);
    assert.match(response, /consultas sobre paquetes, pedidos o seguimiento de envíos:\n📧 clientes@aitue\.net/);
    assert.doesNotMatch(response, /Operativa de Envíos y Despachos\n📧|se pondrá en contacto con vos/);
    ContextManager.resetState(chatId);
  });

  it('provides email-only directions for Operativa without promising follow-up', () => {
    const response = BotRouter.formatCustomerHandoffResponse({ primary_area: 'OPERATIVA' });
    const shippingResponse = BotRouter.formatCustomerHandoffResponse({ primary_area: 'ENVIO_MERCADOLIBRE' });

    assert.match(response, /clientes@aitue\.net/);
    assert.match(response, /escribí/);
    assert.doesNotMatch(response, /Operativa revisará|se pondrá en contacto/);
    assert.match(shippingResponse, /clientes@aitue\.net/);
    assert.doesNotMatch(shippingResponse, /se pondrá en contacto con vos/);
  });

  it('does not pause or notify areas for email-only Operativa handoffs', () => {
    const shippingRoute = BotRouter.route(IntentClassifier.classify('no me llegó el pedido'));
    const operationsRoute = BotRouter.route({ primary_area: 'OPERATIVA_INCOHERENT' });

    assert.equal(BotRouter.isEmailOnlyHandoff(shippingRoute), true);
    assert.equal(BotRouter.isCustomerHandoff(shippingRoute), false);
    assert.equal(BotRouter.isEmailOnlyHandoff(operationsRoute), true);
    assert.equal(BotRouter.isCustomerHandoff(operationsRoute), false);
    assert.deepEqual(BotRouter.getHandoffNotificationContacts(shippingRoute), []);
    assert.deepEqual(BotRouter.getHandoffNotificationContacts(operationsRoute), []);
    assert.match(BotRouter.formatCustomerHandoffResponse(operationsRoute), /clientes@aitue\.net/);
  });

  it('never selects Operativa for WhatsApp handoff notifications', () => {
    const shippingRoute = BotRouter.route(IntentClassifier.classify('no me llegó el pedido'));
    const operationsRoute = BotRouter.route(IntentClassifier.classify('otra consulta de operativa'));
    const mixedShippingRoute = {
      ...shippingRoute,
      secondary_areas: ['PRODUCTO_TECNICO']
    };

    assert.deepEqual(BotRouter.getHandoffNotificationContacts(shippingRoute), []);
    assert.deepEqual(BotRouter.getHandoffNotificationContacts(operationsRoute), []);
    assert.deepEqual(
      BotRouter.getHandoffNotificationContacts({
        ...shippingRoute,
        responsible: [{ ...CONTACTS.envios, notifyOnHandoff: true }]
      }),
      []
    );
    assert.deepEqual(
      BotRouter.getHandoffNotificationContacts(mixedShippingRoute).map(contact => contact.id),
      ['soporte_tecnico']
    );
  });

  it('does not treat a low-confidence fallback as an automatic handoff', () => {
    const route = BotRouter.route(IntentClassifier.classify('tengo una consulta rara'));

    assert.equal(route.action, 'ASK_CLARIFICATION');
    assert.equal(route.primary_area, 'OPERATIVA');
    assert.deepEqual(route.responsible, []);
    assert.equal(BotRouter.isCustomerHandoff(route), false);
    assert.deepEqual(BotRouter.getHandoffNotificationContacts(route), []);
    assert.match(route.response, /podés seleccionar la opción deseada/);
    assert.doesNotMatch(route.response, /\+54|wa\.me/);
  });

  it('routes corporate fleet requests with the matching confirmation', () => {
    const route = BotRouter.route(IntentClassifier.classify('Necesito una solución para la flota de la empresa'));
    const response = BotRouter.formatCustomerHandoffResponse(route);

    assert.equal(BotRouter.isCustomerHandoff(route), true);
    assert.match(response, /proyectos corporativos, soluciones integrales para flotas vehiculares o compras institucionales en volumen/);
    assert.match(response, /Gerencia Comercial brindará atención personalizada/);
    assert.match(response, /Horario de atención del área: 24\/7/);
  });

  it('includes the responsible operating hours in handoff messages', () => {
    const operationsResponse = BotRouter.formatCustomerHandoffResponse({ primary_area: 'OPERATIVA' });
    const supportRoute = BotRouter.route(IntentClassifier.classify('mi producto no funciona'));
    const supportResponse = BotRouter.formatCustomerHandoffResponse(supportRoute);

    assert.match(operationsResponse, /Horario de atención de Operativa: lunes a viernes, de 09:00 a 18:00 hs \(Argentina\)/);
    assert.match(supportResponse, /Horario de atención del área: 24\/7/);
  });

  it('includes the visible customer name, company, and resolved phone in operator summaries', () => {
    const chatId = `test-summary-lid-${Date.now()}@lid`;
    ContextManager.addMessage(chatId, 'user', 'No me llegó el pedido');
    ContextManager.addMessage(chatId, 'assistant', 'Operativa va a revisar tu consulta.');
    const summary = ContextManager.generateSummaryForOperator(
      chatId,
      {},
      '+5491122334455',
      { name: 'María Pérez', company: 'Empresa de María' }
    );

    assert.equal(
      summary,
      'Cliente: María Pérez\nEmpresa: Empresa de María\nConsulta: No me llegó el pedido\nTeléfono: +5491122334455'
    );
    assert.doesNotMatch(summary, /test-summary-lid/);
    assert.doesNotMatch(summary, /Operativa va a revisar|HISTORIAL|Confianza|Área Derivada/);
    ContextManager.resetState(chatId);
  });

  it('does not expose a WhatsApp username or LID as the customer name or phone', () => {
    const chatId = `204977482018928@lid`;
    ContextManager.addMessage(chatId, 'user', 'Necesito que revisen mi consulta');
    const summary = ContextManager.generateSummaryForOperator(
      chatId,
      {},
      null,
      { name: `WhatsApp: ${chatId}`, company: '' }
    );

    assert.equal(
      summary,
      'Cliente: No disponible\nConsulta: Necesito que revisen mi consulta\nTeléfono: No disponible'
    );
    assert.doesNotMatch(summary, /@lid|204977482018928/);
    ContextManager.resetState(chatId);
  });

  it('includes the visible customer name without an unnecessary company line', () => {
    const chatId = `test-summary-name-${Date.now()}@s.whatsapp.net`;
    ContextManager.addMessage(chatId, 'user', 'Necesito asesoramiento');
    const summary = ContextManager.generateSummaryForOperator(
      chatId,
      {},
      '+5491122334455',
      { name: 'Lucía Gómez' }
    );

    assert.match(summary, /^Cliente: Lucía Gómez\n/);
    assert.doesNotMatch(summary, /Empresa:/);
    ContextManager.resetState(chatId);
  });
});
