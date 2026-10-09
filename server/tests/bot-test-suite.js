// ----------------------------------------------------
// AITUE COMUNICA S.A. - BATERÍA DE PRUEBAS SEMÁNTICAS AUTOMATIZADAS
// ----------------------------------------------------

import IntentClassifier from '../intent-classifier.js';
import BotRouter from '../bot-router.js';
import ContextManager from '../context-manager.js';
import ResponseGenerator from '../response-generator.js';

export default function runAllTests() {
  console.log('==================================================');
  console.log('🧪 INICIANDO BATERÍA DE PRUEBAS SEMÁNTICAS (AITUE)');
  console.log('==================================================\n');

  const testCases = [
    { id: 1, name: 'Se me rompió el cable', input: 'Se me rompió el cable', expectedPrimaryArea: 'PRODUCTO_TECNICO', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 2, name: 'Necesito comprar un cable', input: 'Necesito comprar un cable', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 3, name: '¿Qué es Aitue Pro?', input: '¿Qué es Aitue Pro?', expectedPrimaryArea: 'PRODUCTO_INFO', minConfidence: 0.90, checkText: 'Sector Comercial' },
    { id: 3.1, name: 'Consulta por modelo Standard con explicación', input: 'como funciona el modelo standard', expectedPrimaryArea: 'PRODUCTO_INFO', minConfidence: 0.90, checkText: 'soluciones' },
    { id: 3.2, name: 'Consulta por modelo Ultra+', input: 'como funciona un modelo ultra+', expectedPrimaryArea: 'PRODUCTO_INFO', minConfidence: 0.90, checkText: 'soluciones' },
    { id: 3.3, name: 'Consulta del modelo Pro después de una selección comercial', input: 'Quiero saber del modelo Aitue Pro', prevInput: 'QUIERO COMPRAR UN PROTECTOR', expectedPrimaryArea: 'PRODUCTO_INFO', minConfidence: 0.90, checkText: 'Sector Comercial' },
    { id: 3.4, name: 'Acepta derivación comercial desde ficha de producto', input: 'Quiero que me derive al Sector Comercial', prevInput: 'Qué es Aitue Pro?', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', expectedSecondaryArea: 'COMMERCIAL_HANDOFF', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 3.5, name: 'Acepta asesoramiento comercial desde ficha de producto', input: 'Sí', prevInput: 'Qué es Aitue Pro?', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', expectedSecondaryArea: 'COMMERCIAL_HANDOFF', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 4, name: '¿Cuánto cuesta el Pro?', input: '¿Cuánto cuesta el Pro?', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', minConfidence: 0.90, checkText: 'shop.aitue.net' },
    { id: 5, name: 'No funciona mi Pro', input: 'No funciona mi Pro', expectedPrimaryArea: 'PRODUCTO_TECNICO', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 6, name: 'Quiero Internet', input: 'Quiero Internet', expectedPrimaryArea: 'INTERNET_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 7, name: '¿Cuánto cuesta Internet?', input: '¿Cuánto cuesta Internet?', expectedPrimaryArea: 'INTERNET_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 8, name: 'Quiero activar el servicio', input: 'Quiero activar el servicio', expectedPrimaryArea: 'INTERNET_SOPORTE', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 9, name: 'No tengo señal', input: 'No tengo señal', expectedPrimaryArea: 'INTERNET_SOPORTE', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 10, name: 'Mi pago fue rechazado', input: 'Mi pago fue rechazado', expectedPrimaryArea: 'PAGO', minConfidence: 0.90, checkText: 'aguardá un momento' },
    { id: 10.1, name: 'Solicita comprobante de compra', input: 'Quiero el comprobante de compra', expectedPrimaryArea: 'PAGO', minConfidence: 0.90, checkText: 'aguardá un momento' },
    { id: 10.2, name: 'Solicita factura de compra', input: 'Quiero la factura de compra', expectedPrimaryArea: 'PAGO', minConfidence: 0.90, checkText: 'aguardá un momento' },
    { id: 11, name: 'No llegó mi pedido', input: 'No llegó mi pedido', expectedPrimaryArea: 'ENVIO_MERCADOLIBRE', minConfidence: 0.90, checkText: 'paquetes y envíos' },
    { id: 12, name: 'Tenemos 40 camionetas', input: 'Tenemos 40 camionetas', expectedPrimaryArea: 'B2B', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 13, name: 'Quiero ir a conocer los productos', input: 'Quiero ir a conocer los productos', expectedPrimaryArea: 'VISITA_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 13.1, name: 'Pasar por la empresa para comprar un soporte y recibir asesoramiento', input: 'El otro día hablé con esa empresa para pasar por ahí, para la compra de un soporte y que asesoraran con la aplicación', expectedPrimaryArea: 'VISITA_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 14, name: 'Quiero saber más de AITUE', input: 'Quiero saber más de AITUE', expectedPrimaryArea: 'EMPRESA_INFO', minConfidence: 0.90, checkText: 'conectividad satelital' },
    { id: 15, name: 'Necesito ayuda con una cosa (Baja confianza -> Derivación a Clientes)', input: 'Necesito ayuda con una cosa', expectedPrimaryArea: 'OPERATIVA', maxConfidence: 0.69, checkText: 'clientes@aitue.net' },
    { id: 16, name: 'Multi-Intención: Falla + Cotización nueva', input: 'Tengo un Pro que no funciona y quiero cotizar otro.', expectedPrimaryArea: 'PRODUCTO_TECNICO', expectedSecondaryArea: 'PRODUCTO_COMERCIAL', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 17, name: 'Me llegó mal un pedido', input: 'ME LLEGO MAL UN PEDIDO', expectedPrimaryArea: 'ENVIO_MERCADOLIBRE', minConfidence: 0.90, checkText: 'paquetes y envíos' },
    { id: 18, name: 'Me llegó roto un cable (Envío + Soporte)', input: 'ME LLEGO ROTO UN CSBLE', expectedPrimaryArea: 'ENVIO_MERCADOLIBRE', expectedSecondaryArea: 'PRODUCTO_TECNICO', minConfidence: 0.90, checkText: 'paquetes y envíos' },
    { id: 19, name: 'Consulta producto específico V2 (Gerencia Comercial)', input: 'QUIERO SABER SI TIENEN V2', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 20, name: 'Consulta por protector (Menú 3 soluciones)', input: 'QUIERO COMPRAR UN PROTECTOR', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', expectedSecondaryArea: 'PROTECTOR_ADVICE', minConfidence: 0.90, checkText: 'Aitue Standard' },
    { id: 21, name: 'Respuesta tipo instalación: Para Auto (Con contexto previo)', input: 'Para Auto', prevInput: 'QUIERO COMPRAR UN PROTECTOR', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', expectedSecondaryArea: 'PRO_ADVICE', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 22, name: 'Consulta por accesorios / alimentación', input: 'Necesito un conector de alimentación', expectedPrimaryArea: 'PRODUCTO_TECNICO', expectedSecondaryArea: 'ACCESSORIES_ADVICE', minConfidence: 0.90, checkText: 'clientes@aitue.net' },
    { id: 23, name: 'Problema con un producto / conector / cable -> Soporte Técnico', input: 'tuve problemaa con conector', expectedPrimaryArea: 'PRODUCTO_TECNICO', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 24, name: 'Problemas con la conexión de mi antena -> Soporte de Red + Soporte Técnico', input: 'Tuve problemas con la conexión de mi antena', expectedPrimaryArea: 'INTERNET_SOPORTE', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 25, name: 'Tengo un problema con el consumo de datos e interrupción de la conectividad -> Soporte de Red + Soporte Técnico', input: 'Tengo un problema con el consumo de datos e interrupción de la conectividad', expectedPrimaryArea: 'INTERNET_SOPORTE', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 26, name: 'Problemas con el internte (Typo) -> Soporte de Red + Soporte Técnico', input: 'tengo problemas con el internte', expectedPrimaryArea: 'INTERNET_SOPORTE', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 27, name: 'Conectividad a internete (Typo) -> Soporte de Red + Soporte Técnico', input: 'conectividad a internete', expectedPrimaryArea: 'INTERNET_SOPORTE', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 28, name: 'Aclaración de modelo: un ultra (Con contexto previo)', input: 'un ultra', prevInput: 'QUIERO COMPRAR UN PROTECTOR', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', expectedSecondaryArea: 'ULTRA_ADVICE', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 29, name: 'Repuesto de transformador 220V (Typo tranformador)', input: 'tienen repuesto de tranformador 220V', expectedPrimaryArea: 'PRODUCTO_TECNICO', expectedSecondaryArea: 'ACCESSORIES_ADVICE', minConfidence: 0.90, checkText: 'fuentes de alimentación' },
    { id: 30, name: 'Ventas en cantidad o asesoría (Gerencia Comercial)', input: 'necesito ventas en cantidad y asesoria', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 31, name: 'Ventas en cantidad o asesoría internacional (Atención Comercial Internacional)', input: 'quiero asesoria internacional para compra en cantidad', expectedPrimaryArea: 'COMERCIAL_INTERNACIONAL', minConfidence: 0.90, checkText: 'Atención Comercial Internacional' },
    { id: 32, name: 'Consulta por distribuidores nacionales', input: 'quiero ser distribuidor', expectedPrimaryArea: 'DISTRIBUIDORES', minConfidence: 0.90, checkText: 'Atención a Distribuidores' },
    { id: 33, name: 'Problemas de pedidos, despachos y Mercado Libre (Operativa de Envíos)', input: 'tengo un problema con el despacho de mercado libre', expectedPrimaryArea: 'ENVIO_MERCADOLIBRE', minConfidence: 0.90, checkText: 'paquetes y envíos' },
    { id: 34, name: 'Problemas técnicos, conectividad o productos', input: 'tengo problemas tecnicos con la conectividad y productos', expectedPrimaryArea: 'INTERNET_SOPORTE', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 35, name: 'Consulta comercial desde otro país (Chile) -> Atención Comercial Internacional', input: 'hola quiero comprar un equipo desde Chile', expectedPrimaryArea: 'COMERCIAL_INTERNACIONAL', minConfidence: 0.90, checkText: 'Atención Comercial Internacional' },
    { id: 36, name: 'Consulta institucional con error de tipeo (qie hace aitue)', input: 'qie hace aitue', expectedPrimaryArea: 'EMPRESA_INFO', minConfidence: 0.90, checkText: 'AITUE COMUNICA' },
    { id: 37, name: 'Saludo puro con error de tipeo (hla)', input: 'hla', expectedPrimaryArea: 'GREETING_ONLY', minConfidence: 1.0, checkText: 'Bienvenido' },
    { id: 38, name: 'Saludo con error de tipeo + consulta concreta (hla quiero comprar)', input: 'hla quiero comprar', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 39, name: 'Saludo puro tras despedida previa (gracias chau -> hla)', input: 'hla', prevInput: 'gracias chau', expectedPrimaryArea: 'GREETING_ONLY', minConfidence: 1.0, checkText: 'Bienvenido' },
    { id: 40, name: 'Consulta por equipo v2 (quiero una v2) -> Gerencia Comercial', input: 'quiero una v2', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 41, name: 'Consulta por ubicación con error de tipeo (donde stan ubicados)', input: 'donde stan ubicados', expectedPrimaryArea: 'UBICACION_GENERAL', minConfidence: 0.90, checkText: 'Presencia Internacional' },
    { id: 42, name: 'Ubicación con faltas graves (donde stan ubycados)', input: 'donde stan ubycados', expectedPrimaryArea: 'UBICACION_GENERAL', minConfidence: 0.90, checkText: 'Presencia Internacional' },
    { id: 43, name: 'Cotización con typos (cuanto esta el presio o presupusto)', input: 'cuanto esta el presio o presupusto', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 44, name: 'Distribuidor mayorista con typo (quiero ser mayurista)', input: 'quiero ser mayurista', expectedPrimaryArea: 'DISTRIBUIDORES', minConfidence: 0.90, checkText: 'Atención a Distribuidores' },
    { id: 45, name: 'Accesorio con typo (tienen trasformador o kables)', input: 'tienen trasformador o kables', expectedPrimaryArea: 'PRODUCTO_TECNICO', expectedSecondaryArea: 'ACCESSORIES_ADVICE', minConfidence: 0.90, checkText: 'fuentes de alimentación' },
    { id: 46, name: 'Falla con typo (el equipo no funsiona)', input: 'el equipo no funsiona', expectedPrimaryArea: 'PRODUCTO_TECNICO', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 47, name: 'Repregunta de explicación tras consulta de cable (y para que sirve cada uno)', input: 'y para que sirve cada uno', prevInput: 'quiero un cable de alimentacion 220', expectedPrimaryArea: 'PRODUCTO_TECNICO', expectedSecondaryArea: 'ACCESSORIES_EXPLANATION', minConfidence: 0.90, checkText: 'USB-C' },
    { id: 48, name: 'Consulta por página web (cuál es la página web)', input: 'cuál es la página web', expectedPrimaryArea: 'EMPRESA_INFO', minConfidence: 0.90, checkText: 'https://aitue.net/' },
    { id: 49, name: 'Consulta por antena con typo (quiero una antena stralink)', input: 'quiero una antena stralink', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 50, name: 'Accesorio en cantidad mas de 5 (quiero 6 cables dbt)', input: 'quiero 6 cables dbt', expectedPrimaryArea: 'PRODUCTO_TECNICO', expectedSecondaryArea: 'ACCESSORIES_ADVICE', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 51, name: 'Baja con typo (quiero dar de basja mi servicio)', input: 'quiero dar de basja mi servicio', expectedPrimaryArea: 'INTERNET_SOPORTE', minConfidence: 0.90, checkText: 'Atención al Cliente' },
    { id: 52, name: 'Consulta de medios de pago con atención humana', input: 'cuales son los metodos de pago', expectedPrimaryArea: 'FAQ_PAGOS', minConfidence: 0.90, checkText: 'aguardá un momento' },
    { id: 53, name: 'FAQ Tiempos de Envío (cuales son los tiempos de envio)', input: 'cuales son los tiempos de envio', expectedPrimaryArea: 'FAQ_ENVIOS', minConfidence: 0.90, checkText: '24 a 48 hs' },
    { id: 54, name: 'FAQ Garantía Oficial (tienen garantia los productos)', input: 'tienen garantia los productos', expectedPrimaryArea: 'FAQ_GARANTIA', minConfidence: 0.90, checkText: 'garantía oficial' },
    { id: 55, name: 'FAQ Compatibilidad (compatibilidad starlink mini funciona a 12v)', input: 'compatibilidad starlink mini funciona a 12v', expectedPrimaryArea: 'FAQ_COMPATIBILIDAD', minConfidence: 0.90, checkText: '12V' },
    { id: 56, name: 'Consulta de Comparativa (compara las soluciones y antenas)', input: 'compara las soluciones y antenas', expectedPrimaryArea: 'PRODUCTO_COMERCIAL', expectedSecondaryArea: 'PROTECTOR_EXPLANATION', minConfidence: 0.90, checkText: 'Gerencia Comercial' },
    { id: 57, name: 'Baja Confianza -> Pregunta Aclaratoria Interactiva (tengo una consulta rara)', input: 'tengo una consulta rara', expectedPrimaryArea: 'OPERATIVA', maxConfidence: 0.69, checkText: 'clientes@aitue.net' }
  ];

  let passedCount = 0;

  testCases.forEach(tc => {
    const testChatId = `sem_test_${tc.id}`;
    ContextManager.resetState(testChatId);

    if (tc.prevInput) {
      const prevState = ContextManager.getState(testChatId);
      const prevClass = IntentClassifier.classify(tc.prevInput, prevState);
      const prevRoute = BotRouter.route(prevClass, prevState);
      ResponseGenerator.formatResponse(testChatId, prevClass, prevRoute, tc.prevInput);
    }

    const state = ContextManager.getState(testChatId);
    const classification = IntentClassifier.classify(tc.input, state);
    const routeResult = BotRouter.route(classification, state);
    const output = BotRouter.isEmailOnlyHandoff(routeResult) || BotRouter.isCustomerHandoff(routeResult)
      ? BotRouter.formatCustomerHandoffResponse(routeResult)
      : ResponseGenerator.formatResponse(testChatId, classification, routeResult, tc.input);

    const matchesArea = classification.primary_area === tc.expectedPrimaryArea;
    const matchesConfidence = tc.minConfidence ? classification.confidence >= tc.minConfidence : (tc.maxConfidence ? classification.confidence <= tc.maxConfidence : true);
    const matchesSecondary = tc.expectedSecondaryArea ? classification.secondary_areas.includes(tc.expectedSecondaryArea) : true;
    const matchesText = output.toLowerCase().includes(tc.checkText.toLowerCase());

    if (matchesArea && matchesConfidence && matchesSecondary && matchesText) {
      passedCount++;
      console.log(`✅ [TEST ${tc.id}] ${tc.name}: PASADO`);
      console.log(`   [JSON] primary_area="${classification.primary_area}" secondary_areas=${JSON.stringify(classification.secondary_areas)} confidence=${classification.confidence} reason="${classification.reason}"\n`);
    } else {
      console.log(`❌ [TEST ${tc.id}] ${tc.name}: FALLADO`);
      console.log(`   Esperado: primary="${tc.expectedPrimaryArea}" minConf=${tc.minConfidence || 'N/A'}` + (tc.expectedSecondaryArea ? ` secondary="${tc.expectedSecondaryArea}"` : ''));
      console.log(`   Recibido: primary="${classification.primary_area}" confidence=${classification.confidence} secondary=${JSON.stringify(classification.secondary_areas)}`);
      console.log(`   Output: "${output.substring(0, 100)}..."\n`);
    }
  });

  console.log(`==================================================`);
  console.log(`📊 RESULTADO PRUEBAS SEMÁNTICAS: ${passedCount} / ${testCases.length} EXITOSAS (${Math.round((passedCount/testCases.length)*100)}%)`);
  console.log('==================================================\n');

  return { total: testCases.length, passed: passedCount };
}

runAllTests();
