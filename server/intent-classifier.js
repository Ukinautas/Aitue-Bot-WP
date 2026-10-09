// ----------------------------------------------------
// AITUE COMUNICA S.A. - CLASIFICADOR SEMÁNTICO DE INTENCIONES CON ANÁLISIS DE PROPÓSITO
// ----------------------------------------------------

export default class IntentClassifier {
  // Limpia el mensaje y corrige variantes conocidas antes de evaluar reglas o similitud.
  // Los reemplazos por palabra completa evitan alterar accidentalmente términos más largos.
  static normalizeText(str) {
    let t = (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[¿?¡!.,;:_\-\/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const typoMap = [
      ['hla', 'hola'], ['ola', 'hola'], ['olaa', 'hola'], ['holas', 'hola'], ['buenass', 'buenas'], ['holaa', 'hola'], ['holaaa', 'hola'], ['holaf', 'hola'], ['hol', 'hola'],
      ['qie', 'que'], ['qe', 'que'], ['q', 'que'], ['k', 'que'], ['ke', 'que'], ['ki', 'que'],
      ['kero', 'quiero'], ['kiero', 'quiero'], ['qiero', 'quiero'], ['qro', 'quiero'], ['deseo', 'quiero'], ['qero', 'quiero'], ['qeria', 'queria'],
      ['conprar', 'comprar'], ['conpra', 'compra'], ['conpro', 'compro'],
      ['ace', 'hace'], ['asen', 'hace'], ['hacen', 'hace'], ['acen', 'hace'], ['hacee', 'hace'],
      ['kien', 'quien'], ['kiens', 'quienes'], ['qien', 'quien'], ['qiens', 'quienes'], ['quienes', 'quienes'],
      ['dnde', 'donde'], ['dond', 'donde'], ['dondee', 'donde'], ['dn', 'donde'], ['wnde', 'donde'],
      ['presio', 'precio'], ['preco', 'precio'], ['preço', 'precio'], ['precioo', 'precio'], ['preso', 'precio'], ['costo', 'precio'], ['valor', 'precio'], ['prec1o', 'precio'], ['presyo', 'precio'],
      ['soprte', 'soporte'], ['spporte', 'soporte'], ['sopote', 'soporte'], ['soprt', 'soporte'], ['tecnico', 'soporte'], ['tecnic', 'soporte'], ['teknico', 'soporte'], ['sop', 'soporte'],
      ['embio', 'envio'], ['envyo', 'envio'], ['envi', 'envio'], ['enbio', 'envio'], ['enviio', 'envio'], ['despaco', 'envio'], ['despaso', 'envio'],
      ['amtena', 'antena'], ['antenaa', 'antena'], ['antene', 'antena'], ['atena', 'antena'], ['amtna', 'antena'], ['antenaa', 'antena'],
      ['starling', 'starlink'], ['starlik', 'starlink'], ['starli', 'starlink'], ['estarlink', 'starlink'], ['starlinc', 'starlink'], ['estarlin', 'starlink'], ['starlikn', 'starlink'],
      ['conec', 'conectividad'], ['comec', 'conectividad'], ['comcet', 'conectividad'], ['conexion', 'conectividad'], ['conectivida', 'conectividad'], ['conecividad', 'conectividad'], ['conectiv', 'conectividad'], ['conexio', 'conectividad'],
      ['interner', 'internet'], ['intenet', 'internet'], ['interne', 'internet'], ['interned', 'internet'], ['internete', 'internet'], ['intenet', 'internet'],
      ['fala', 'falla'], ['fallando', 'falla'], ['rompio', 'falla'], ['roto', 'falla'], ['dano', 'falla'], ['daño', 'falla'], ['daniado', 'falla'], ['dañado', 'falla'],
      ['pague', 'pago'], ['pagos', 'pago'], ['pag', 'pago'], ['abono', 'pago'],
      ['ultrra', 'ultra'], ['ultr', 'ultra'], ['ultrah', 'ultra'], ['ultrplus', 'ultra'], ['ultra+', 'ultra'],
      ['estandar', 'standard'], ['standar', 'standard'], ['standart', 'standard'], ['estan', 'standard'],
      ['aitu', 'aitue'], ['aituee', 'aitue'], ['aitie', 'aitue'], ['aite', 'aitue'], ['aituee', 'aitue'], ['aitúe', 'aitue'], ['aitue', 'aitue'],
      ['kmprar', 'comprar'], ['comprad', 'comprar'], ['compro', 'comprar'], ['comprra', 'comprar'], ['compraa', 'comprar'], ['cmpra', 'comprar'],
      ['cotisacion', 'cotizacion'], ['cotizasion', 'cotizacion'], ['cotisasion', 'cotizacion'], ['presupusto', 'presupuesto'], ['cotiz', 'cotizacion'],
      ['pedid', 'pedido'], ['peddos', 'pedido'], ['paqete', 'pedido'], ['pedio', 'pedido'], ['pedi', 'pedido'],
      ['yega', 'llega'], ['yegar', 'llegar'], ['llege', 'llegue'], ['llego', 'llego'], ['llegao', 'llego'],
      ['rechasado', 'rechazado'], ['rechazdo', 'rechazado'], ['aseptan', 'aceptan'], ['aseptar', 'aceptar'],
      ['problma', 'problema'], ['problmas', 'problemas'], ['problemaa', 'problema'],
      ['rto', 'roto'], ['kable', 'cable'], ['kables', 'cables'], ['funsiona', 'funciona'], ['funsion', 'funciona'], ['funsionaba', 'funcionaba'],
      ['saver', 'saber'], ['aser', 'hacer'], ['aser', 'hacer'],
      ['distribiudora', 'distribuidor'], ['mayurista', 'distribuidor'], ['distri', 'distribuidor'],
      ['stan', 'estan'], ['estn', 'estan'], ['stn', 'estan'], ['estann', 'estan'], ['tngo', 'tengo'], ['tnog', 'tengo'], ['necesito', 'necesito'], ['nesecito', 'necesito'],
      ['ubycados', 'ubicacion'], ['ubicasion', 'ubicacion'], ['ubycacion', 'ubicacion'], ['ubicacn', 'ubicacion'], ['ubcados', 'ubicacion'], ['ubycado', 'ubicacion'], ['ubicado', 'ubicacion'], ['direcion', 'direccion'], ['direc', 'direccion'], ['adre', 'direccion'],
      ['protec', 'protector'], ['potector', 'protector'], ['protek', 'protector'], ['protekt', 'protector'],
      ['gavinete', 'gabinete'], ['karcasa', 'gabinete'], ['gabin', 'gabinete'],
      ['tranformador', 'transformador'], ['trasformador', 'transformador'], ['transfomador', 'transformador'], ['transf', 'transformador'],
      ['facturasion', 'facturacion'], ['facturasin', 'facturacion'], ['transfrencia', 'transferencia'], ['tranferencia', 'transferencia'], ['trasnferencia', 'transferencia'],
      ['sirve', 'sirve'], ['sivere', 'sirve'], ['sierve', 'sirve'], ['srve', 'sirve'], ['need', 'necesito'], ['nesesito', 'necesito'],
      ['movil', 'movil'], ['movil', 'movil'], ['mvil', 'movil'], ['sms', 'mensaje'], ['msg', 'mensaje'], ['satelite', 'satelital'], ['satelital', 'satelital'], ['satelite', 'satelital']
    ];

    for (const [wrong, right] of typoMap) {
      const regex = new RegExp(`\\b${wrong}\\b`, 'g');
      t = t.replace(regex, right);
    }

    // Normalizaciones de frases frecuentes que no se escriben bien
    t = t.replace(/\b(ayuda por favor|ayudame|ayudame por favor)\b/g, 'ayuda');
    t = t.replace(/\b(tenes|tene|tenemos|tienen)\b/g, 'tienen');
    t = t.replace(/\b(nesecesito|necestito|nececito|necesesito)\b/g, 'necesito');
    return t;
  }

  // Cuenta ediciones de caracteres para tolerar inserciones, omisiones y sustituciones pequeñas.
  static levenshteinDistance(a, b) {
    const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[a.length][b.length];
  }

  // Compara palabras normalizadas con un umbral proporcional a su longitud.
  static fuzzyWordMatch(word, candidate) {
    const normalizeWord = (value = '') => (value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-záéíóúüñ]/g, '');
    const a = normalizeWord(word);
    const b = normalizeWord(candidate);

    if (!a || !b) return false;
    if (a === b) return true;

    const lengthLimit = Math.max(a.length, b.length);
    const allowedDistance = lengthLimit <= 4 ? 1 : lengthLimit <= 6 ? 2 : Math.min(3, Math.round(lengthLimit * 0.25));
    return this.levenshteinDistance(a, b) <= allowedDistance;
  }

  // Puntúa cada área por coincidencia literal o cobertura aproximada de un trigger.
  static checkIncoherentOrGibberish(raw, text) {
    if (!raw || raw.length < 2) return false;
    const words = text.split(' ').filter(w => w.length > 0);
    let badCount = 0;
    for (const w of words) {
      if (w.length > 6 && !/[aeiouy]/.test(w)) badCount++;
      if (/(.)\1{3,}/.test(w)) badCount++;
    }
    return badCount > 0;
  }

  static classify(userText, contextState = {}) {
    const raw = (userText || '').trim();
    const text = this.normalizeText(raw);

    // 0a. Detección de mensajes incoherentes o sin sentido
    if (this.checkIncoherentOrGibberish(raw, text)) {
      return {
        primary_area: 'OPERATIVA_INCOHERENT',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente envió un mensaje incoherente o con caracteres sin sentido.'
      };
    }

    const isPaymentDocumentRequest = /\b(comprobante(?:s)?|factura(?:s)?|facturacion|recibo(?:s)?|remito(?:s)?|constancia de pago)\b/.test(text) ||
      /\b(comprobar|verificar|revisar|consultar)\b/.test(text) && /\b(pago|transferencia|compra)\b/.test(text);
    if (isPaymentDocumentRequest) {
      return {
        primary_area: 'PAGO',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente solicita una factura, comprobante, remito o constancia de una compra o pago.'
      };
    }

    // 0a1. Detección de solicitud de atención humana / operador
    // Detección explícita de Atención al Cliente (solo email clientes@aitue.net)
    const isCustomerCare = text.includes('atencion al cliente') || text.includes('atencion cliente') || text.includes('servicio al cliente') || text.includes('contacto clientes') || text.includes('mail clientes') || text.includes('correo clientes');
    if (isCustomerCare) {
      return {
        primary_area: 'ATENCION_CLIENTE',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente solicita comunicarse con Atención al Cliente.'
      };
    }

    const hasPendingCatalogOffer = contextState.secondary_areas?.includes('PRODUCT_CATALOG');
    const hasPendingCommercialAdviceConfirmation =
      contextState.pendingCommercialAdviceConfirmation === true;
    const hasPendingCommercialAdviceOffer =
      hasPendingCatalogOffer || hasPendingCommercialAdviceConfirmation;
    const isDecliningCommercialAdvice = /^(?:no|ahora no|mejor no|no gracias)(?:\s|$)/.test(text);
    const isCommercialHandoffChoice = /\b(deriv|comercial|asesor|contacto)\w*\b/.test(text) ||
      text.includes('gerencia comercial');
    const hasAffirmativeLead = /^(?:si|dale|ok(?:ay)?|claro|de una|por favor|bueno|me interesa|me sirve|confirmo|correcto)\b/.test(text);
    const isAffirmativeReply = hasAffirmativeLead && !/\bno\b/.test(text);
    const hasExplicitOperationalIntent = /\b(?:pago|pagos|transferencia|envio|pedido|paquete|seguimiento|despacho|falla|fallas|roto|danado|no funciona|no anda|internet|conectividad|conexi|activar|desactivar|cancelar|baja|sin senal|garantia)\b/.test(text);
    const requestsCommercialAdvice = /\b(asesoramiento|asesoria|asesor|gerencia comercial)\b/.test(text);

    if (hasPendingCommercialAdviceOffer && !isDecliningCommercialAdvice && !hasExplicitOperationalIntent &&
      (isAffirmativeReply || requestsCommercialAdvice || isCommercialHandoffChoice)) {
      return {
        primary_area: 'PRODUCTO_COMERCIAL',
        secondary_areas: ['COMMERCIAL_HANDOFF'],
        confidence: 0.99,
        reason: 'El cliente acepta el asesoramiento comercial ofrecido previamente.'
      };
    }

    const isHumanRequest = text.includes('humano') || text.includes('operador') || text.includes('persona') || text.includes('atencion humana') || text.includes('hablar con alguien') || text.includes('agente') || text.includes('representante') || text.includes('atencion personal');
    if (isHumanRequest) {
      return {
        primary_area: 'HUMAN_HANDOVER',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente solicita explícitamente atención por parte de un operador o persona real.'
      };
    }

    const hasPendingProductDetailChoice = contextState.pendingProductDetailChoice === true;
    const isMoreProductInfoChoice = text.includes('mas informacion') || text.includes('mas info') ||
      text.includes('mas detalles') || text.includes('mas data');
    const isAffirmativeOnly = isAffirmativeReply;

    if (hasPendingProductDetailChoice && !hasExplicitOperationalIntent && !isMoreProductInfoChoice && isCommercialHandoffChoice) {
      return {
        primary_area: 'PRODUCTO_COMERCIAL',
        secondary_areas: ['COMMERCIAL_HANDOFF'],
        confidence: 0.99,
        reason: 'El cliente solicita la derivación al Sector Comercial ofrecida en la ficha del producto.'
      };
    }

    if (hasPendingProductDetailChoice && !hasExplicitOperationalIntent && isAffirmativeOnly) {
      return {
        primary_area: 'PRODUCTO_INFO',
        secondary_areas: ['PRODUCT_DETAIL_CLARIFICATION'],
        confidence: 0.99,
        reason: 'El cliente acepta una de las opciones ofrecidas, pero no especifica cuál.'
      };
    }

    // 0. Detección de tipos protocolares
    const isPureGreeting = this.checkPureGreeting(text);
    const isFarewell = this.checkFarewell(text);
    const isRedes = text.includes('redes sociales') || text.includes('redes oficiales') ||
      text.includes('instagram') || text.includes('facebook') || text.includes('linkedin') ||
      text.includes('donde seguir');

    if (isPureGreeting && !this.hasActionIntent(text)) {
      return {
        primary_area: 'GREETING_ONLY',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente realiza un saludo inicial sin consulta explícita.'
      };
    }

    if (isFarewell && !this.hasActionIntent(text)) {
      return {
        primary_area: 'FAREWELL',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente se despide o agradece la atención.'
      };
    }

    if (isRedes) {
      return {
        primary_area: 'REDES_INFO',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente consulta enlaces a redes sociales oficiales.'
      };
    }

    // 0.0b. Detección de Preguntas Frecuentes Rápidas (FAQ / RAG)
    const isFaqPagos = text.includes('metodos de pago') || text.includes('formas de pago') || text.includes('medios de pago') || text.includes('como puedo pagar') || text.includes('como se paga') || text.includes('aceptan tarjeta') || text.includes('mercado pago') || text.includes('transferencia bancaria');
    if (isFaqPagos && !text.includes('rechazado') && !text.includes('error') && !text.includes('no se acredito')) {
      return {
        primary_area: 'FAQ_PAGOS',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente consulta por los métodos y medios de pago disponibles.'
      };
    }

    const isFaqEnvios = text.includes('como hacen los envios') || text.includes('tiempos de envio') ||
      text.includes('envios a todo el pais') || text.includes('cuanto tarda en llegar') ||
      text.includes('como envian') || text.includes('modalidad de envio') ||
      /\bcuanto cuesta (?:el )?envio\b/.test(text) || /\bcuanto sale (?:el )?envio\b/.test(text) ||
      /\bprecio (?:de|del) envio\b/.test(text) || /\bcosto (?:de|del) envio\b/.test(text);
    const isCablePurchaseWithShipping = /\b(?:cable|cables)\b/.test(text) &&
      /\b(?:queria|quiero|pedir|pido|comprar|tienen|busco|buscando|transferencia|transfiero)\b/.test(text);
    if (isFaqEnvios && !isCablePurchaseWithShipping && !text.includes('donde esta mi pedido') && !text.includes('no llego')) {
      return {
        primary_area: 'FAQ_ENVIOS',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente consulta sobre las modalidades y tiempos de despacho.'
      };
    }

    const isFaqGarantia = text.includes('tienen garantia') || text.includes('garantia de los productos') || text.includes('cuanto tiempo de garantia') || text.includes('garantia oficial') || text.includes('que garantia');
    if (isFaqGarantia) {
      return {
        primary_area: 'FAQ_GARANTIA',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente consulta por la garantía y respaldo oficial de los productos.'
      };
    }

    const isFaqCompatibilidad = text.includes('compatibilidad starlink') || text.includes('sirve para starlink mini') || text.includes('funciona a 12v') || text.includes('sirve para 220v') || text.includes('que voltaje soporta') || text.includes('que tension soporta');
    if (isFaqCompatibilidad) {
      return {
        primary_area: 'FAQ_COMPATIBILIDAD',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente consulta por la compatibilidad y tensiones de alimentación soportadas.'
      };
    }

    const isSolutionInformationQuery = text.includes('que soluciones tienen') ||
      text.includes('soluciones para starlink') || text.includes('soluciones para la antena');
    if (isSolutionInformationQuery) {
      return {
        primary_area: 'PRODUCTO_INFO',
        secondary_areas: [],
        confidence: 0.96,
        reason: 'El cliente solicita información general sobre las soluciones AITUE.'
      };
    }

    // 0.0c. Detección de Comparativas ("compara", "comparar", "diferencias")
    const isComparisonQuery = text.includes('compara') || text.includes('comparar') || text.includes('comparativa') || text.includes('diferencias') || text.includes('diferencia') || text.includes('diferencia entre');
    if (isComparisonQuery) {
      return {
        primary_area: 'PRODUCTO_INFO',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente solicita información comparativa sobre las soluciones y líneas de productos AITUE.'
      };
    }

    // 0.0d. Manejo de Opciones Aclaratorias cuando la pregunta anterior fue una derivación aclaratoria
    const isCommercialCablePurchaseInClarification = (text.includes('cable') || text.includes('cables')) &&
      (/(?:\b(?:tienen|queria|quiero|busco|buscando|comprar|compro|pedir|pido|venden|transferir|transfiero)\b)/.test(text) ||
        /\b(?:[2-9]|\d{2,})\b/.test(text));
    if (contextState.clarificationAsked && !isCommercialCablePurchaseInClarification) {
      if (text === '1' || text.includes('falla') || text.includes('cable') || text.includes('equipo')) {
        return {
          primary_area: 'PRODUCTO_TECNICO',
          secondary_areas: [],
          confidence: 1.0,
          selectedClarificationOption: 'Opción 1: Falla Técnica o Problema con Producto / Cable (Atención al Cliente)',
          reason: 'El cliente seleccionó la Opción 1 de la pregunta aclaratoria: Falla Técnica (Atención al Cliente).'
        };
      }
      if (text === '2' || text.includes('senal') || text.includes('activar') || text.includes('red')) {
        return {
          primary_area: 'INTERNET_SOPORTE',
          secondary_areas: [],
          confidence: 1.0,
          selectedClarificationOption: 'Opción 2: Conectividad, Señal de Antena o Activación de Servicio (Atención al Cliente)',
          reason: 'El cliente seleccionó la Opción 2 de la pregunta aclaratoria: Conectividad y Red (Atención al Cliente).'
        };
      }
      if (text === '3' || text.includes('envio') || text.includes('pedido') || text.includes('paquete')) {
        return {
          primary_area: 'ENVIO_MERCADOLIBRE',
          secondary_areas: [],
          confidence: 1.0,
          selectedClarificationOption: 'Opción 3: Seguimiento de Pedido, Despacho o Mercado Libre (Martin)',
          reason: 'El cliente seleccionó la Opción 3 de la pregunta aclaratoria: Envíos y Mercado Libre (Martin).'
        };
      }
    }

    // 0.1. Detección directa de Selección del Menú de Opciones (por ID, número 1-7 o título)
    if (contextState.secondary_areas?.includes('PROTECTOR_ADVICE') && ['1', '2', '3'].includes(text)) {
      const productChoices = {
        '1': {
          secondary_area: 'STANDARD_ADVICE',
          reason: 'El cliente seleccionó la Opción 1: Aitue Standard.'
        },
        '2': {
          secondary_area: 'PRO_ADVICE',
          reason: 'El cliente seleccionó la Opción 2: Aitue Pro.'
        },
        '3': {
          secondary_area: 'ULTRA_ADVICE',
          reason: 'El cliente seleccionó la Opción 3: Línea Ultra+.'
        }
      };
      const choice = productChoices[text];
      return {
        primary_area: 'PRODUCTO_COMERCIAL',
        secondary_areas: [choice.secondary_area],
        confidence: 1.0,
        reason: choice.reason
      };
    }

    if (raw === 'PRODUCTO_INFO' || text === '1' || text === 'opcion 1' || text === '1 productos y accesorios' || text === 'productos y accesorios') {
      return {
        primary_area: 'PRODUCTO_INFO',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente seleccionó la Opción 1: Productos y Accesorios.'
      };
    }
    if (raw === 'PRODUCTO_COMERCIAL' || text === '2' || text === 'opcion 2' || text === '2 ventas y cotizaciones' || text === 'ventas y cotizaciones') {
      return {
        primary_area: 'PRODUCTO_COMERCIAL',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente seleccionó la Opción 2: Ventas y Cotizaciones (Gerencia Comercial).'
      };
    }
    if (raw === 'PRODUCTO_TECNICO' || text === '3' || text === 'opcion 3' || text === '3 soporte tecnico' || text === 'soporte tecnico') {
      return {
        primary_area: 'PRODUCTO_TECNICO',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente seleccionó la Opción 3: Soporte Técnico (Servicio de Soporte Técnico).'
      };
    }
    if (raw === 'INTERNET_SOPORTE' || text === '4' || text === 'opcion 4' || text === '4 internet via satelite' || text === 'internet via satelite') {
      return {
        primary_area: 'INTERNET_SOPORTE',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente seleccionó la Opción 4: Internet vía satélite (Soporte de Red Vía Satelital).'
      };
    }
    if (raw === 'PAGO' || text === '5' || text === 'opcion 5' || text === '5 pagos y facturacion' || text === 'pagos y facturacion') {
      return {
        primary_area: 'PAGO',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente seleccionó la Opción 5: Pagos y Facturación (Facturación y Administración).'
      };
    }
    if (raw === 'ENVIO_MERCADOLIBRE' || text === '6' || text === 'opcion 6' || text === '6 envios y mercado libre' || text === 'envios y mercado libre' || text === 'envios') {
      return {
        primary_area: 'ENVIO_MERCADOLIBRE',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente seleccionó la Opción 6: Envíos y Seguimiento (Operativa de Envíos).'
      };
    }
    if (raw === 'B2B' || text === '7' || text === 'opcion 7' || text === '7 empresas y flotas b2b' || text === 'empresas y flotas' || text === 'flotas') {
      return {
        primary_area: 'B2B',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente seleccionó la Opción 7: Empresas y Flotas - B2B (Gerencia Comercial).'
      };
    }
    if (raw === 'DISTRIBUIDORES' || text === '8' || text === 'opcion 8' ||
      text === '8 distribuidores' || text === 'distribuidores') {
      return {
        primary_area: 'DISTRIBUIDORES',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'El cliente seleccionó la Opción 8: Distribuidores y Distribuidoras.'
      };
    }

    // Context resolution: Si el usuario responde sobre tipo de instalación ("para auto", "movil", "fija") tras consultar por un protector
    const isInstallationTypeReply = text.includes('para auto') || text.includes('auto') || text.includes('camioneta') ||
      text.includes('vehiculo') || text.includes('movil') || text.includes('fija') || text.includes('para casa') || text.includes('inmueble');

    if (isInstallationTypeReply && (contextState.lastIntent === 'PRODUCTO_COMERCIAL' || contextState.secondary_areas?.includes('PROTECTOR_ADVICE'))) {
      const isMobile = text.includes('auto') || text.includes('camioneta') || text.includes('movil') || text.includes('vehiculo');
      return {
        primary_area: 'PRODUCTO_COMERCIAL',
        secondary_areas: isMobile ? ['PRO_ADVICE'] : ['STANDARD_ADVICE'],
        confidence: 0.98,
        reason: isMobile
          ? 'El cliente selecciona la Línea Aitue Pro (móvil/vehicular).'
          : 'El cliente selecciona la Línea Aitue Standard (fija).'
      };
    }

    // Context resolution: Detección de repreguntas / expansión a demanda ("y para qué sirve cada uno", "cómo funciona", "cuál es la diferencia", "cuál me conviene", "y cuál me conviene")
    const isFollowUpExpansionQuery = text.includes('para que sirve') || text.includes('para que sirven') ||
      text.includes('como funciona') || text.includes('como funcionan') || text.includes('explicame mas') ||
      text.includes('mas informacion') || text.includes('mas info') || text.includes('mas detalles') || text.includes('mas data') || text.includes('que diferencia') ||
      text.includes('cual es la diferencia') || text.includes('diferencia hay') || text.includes('para que es') ||
      text.includes('sirve cada uno') || text.includes('para que sirve cada uno') || text.includes('cada uno') ||
      text.includes('cual me conviene') || text.includes('y cual me conviene') || text.includes('cual me conviene mas') ||
      text.includes('cual me recomiendas') || text.includes('que cable me conviene') || text.includes('cual cable me conviene');

    if (isFollowUpExpansionQuery) {
      const userHistoryStr = (contextState.history || [])
        .filter(h => h.role === 'user')
        .map(h => h.text)
        .join(' ')
        .toLowerCase();
      const isMoreInformationRequest = text.includes('mas informacion') || text.includes('mas info') ||
        text.includes('mas detalles') || text.includes('mas data');
      const hasModelMentionInFollowUp = /\b(modelo|standard|pro|ultra|mini)\b/.test(text);
      const hasRecentModelContext = contextState.primary_area === 'PRODUCTO_INFO' ||
        contextState.secondary_areas?.some(area => ['PROTECTOR_ADVICE', 'STANDARD_ADVICE', 'PRO_ADVICE', 'ULTRA_ADVICE'].includes(area));
      const explicitlyAsksAboutAccessories = /\b(cable|cables|fuente|fuentes|accesorio|accesorios|220v|12v|30v|dbt)\b/.test(text);

      if (isMoreInformationRequest && (hasModelMentionInFollowUp || hasRecentModelContext) && !explicitlyAsksAboutAccessories) {
        const modelSources = [text, ...(contextState.history || [])
          .filter(entry => entry.role === 'user')
          .slice()
          .reverse()
          .map(entry => this.normalizeText(entry.text || ''))];
        const modelName = modelSources.map(source => {
          if (/\bmini\s*x\b/.test(source)) return 'Starlink Mini X';
          if (/\bultra\+?\b/.test(source)) return 'AITUE Ultra+';
          if (/\bstandard\b/.test(source)) return 'AITUE Standard';
          if (/\bpro\b/.test(source)) return 'AITUE Pro';
          if (/\bmini\b/.test(source)) return 'Starlink Mini';
          return null;
        }).find(Boolean) || 'AITUE';

        return {
          primary_area: 'PRODUCTO_INFO',
          secondary_areas: ['PRODUCT_CATALOG'],
          confidence: 0.99,
          modelName,
          reason: 'El cliente solicita más información sobre un modelo AITUE y debe recibir el enlace al catálogo oficial.'
        };
      }

      const isProductFunctionalityQuestion = text.includes('como funciona') || text.includes('como funcionan') ||
        text.includes('para que sirve') || text.includes('para que sirven') || text.includes('para que es');
      const hasModelReference = /(\bstandard\b|\bpro\b|\bultra\b|\bmini\b|\bmini x\b|\baitue\b)/.test(text) && !text.includes('productos');
      const isCableOrAccessoryContext = userHistoryStr.includes('cable') || userHistoryStr.includes('alimentacion') || userHistoryStr.includes('fuente') ||
        userHistoryStr.includes('220v') || userHistoryStr.includes('12v') || userHistoryStr.includes('30v') || userHistoryStr.includes('dbt') ||
        userHistoryStr.includes('conector') || userHistoryStr.includes('transformador') || userHistoryStr.includes('accesorio') ||
        contextState.primary_area === 'PRODUCTO_TECNICO' || contextState.secondary_areas?.includes('ACCESSORIES_ADVICE') ||
        contextState.secondary_areas?.includes('ACCESSORIES_EXPLANATION');

      if (isProductFunctionalityQuestion && (!isCableOrAccessoryContext || hasModelReference)) {
        return {
          primary_area: 'PRODUCTO_INFO',
          secondary_areas: [],
          confidence: 0.96,
          reason: 'El cliente consulta la finalidad o funcionamiento general de los productos AITUE.'
        };
      }

      if (isCableOrAccessoryContext) {
        return {
          primary_area: 'PRODUCTO_TECNICO',
          secondary_areas: ['ACCESSORIES_EXPLANATION'],
          confidence: 0.98,
          reason: 'El cliente repregunta sobre cuál cable de alimentación o accesorio le conviene.'
        };
      }

      if (contextState.secondary_areas?.includes('PROTECTOR_ADVICE') || contextState.secondary_areas?.includes('STANDARD_ADVICE') || contextState.secondary_areas?.includes('PRO_ADVICE') || contextState.secondary_areas?.includes('ULTRA_ADVICE')) {
        return {
          primary_area: 'PRODUCTO_COMERCIAL',
          secondary_areas: ['PROTECTOR_EXPLANATION'],
          confidence: 0.98,
          reason: 'El cliente repregunta pidiendo detalles de función de las líneas de soluciones AITUE.'
        };
      }

      // Por defecto si pregunta "cuál me conviene" sin contexto previo, derivar con explicación técnica de cables
      return {
        primary_area: 'PRODUCTO_TECNICO',
        secondary_areas: ['ACCESSORIES_EXPLANATION'],
        confidence: 0.95,
        reason: 'El cliente solicita recomendación sobre cuál opción de cable o producto le conviene.'
      };
    }

    const internationalKeywords = [
      'internacional', 'internacionales', 'exterior', 'extranjero', 'extranjera', 'fuera de argentina', 'fuera del pais',
      'afuera', 'exportacion', 'exportar', 'chile', 'uruguay', 'paraguay', 'brasil', 'brazil',
      'bolivia', 'peru', 'colombia', 'venezuela', 'ecuador', 'mexico', 'espana',
      'estados unidos', 'eeuu', 'ee uu', 'usa', 'canada', 'europa', 'dolares', 'usd',
      'euros', 'euro', 'paypal', 'wire transfer', 'transferencia internacional', 'zelle', 'usdt', 'crypto'
    ];
    const isInternationalMention = internationalKeywords.some(kw => {
      const escapedKeyword = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp(`\\b${escapedKeyword}\\b`).test(text);
    });

    // 0.2. Detección directa de Distribuidores o Asesoría Internacional
    const isDistributorsRequest = text.includes('distribuidor') || text.includes('distribuidores') || text.includes('distribuidora') || text.includes('distribuidoras') || text.includes('ser distribuidor');
    const hasClearShippingIssue = text.includes('no llego') || text.includes('seguimiento') ||
      text.includes('me llego') || text.includes('mercado libre') || text.includes('mercadolibre') ||
      text.includes('problemas con el despacho') || text.includes('problema con el despacho') ||
      text.includes('problema con el pedido') || text.includes('problema con el paquete');
    if (isDistributorsRequest && !hasClearShippingIssue) {
      const isExplicitlyNational = ['argentina', 'argentino', 'nacional', 'nacionales']
        .some(kw => text.includes(kw));
      return {
        primary_area: 'DISTRIBUIDORES',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente consulta por programa o atención a distribuidores o distribuidoras.',
        isInternationalDistributor: !isExplicitlyNational &&
          (Boolean(contextState.isInternationalNumber) || isInternationalMention)
      };
    }

    // 1. VISITA COMERCIAL / PRESENCIAL
    const isVisitRequest = text.includes('donde visitara') || text.includes('donde visitar') || text.includes('quiero visitar') ||
      text.includes('visitar') || text.includes('visita') || text.includes('ir a la oficina') ||
      text.includes('conocer la oficina') || text.includes('presencialmente') || text.includes('ir a ver') ||
      text.includes('ir fisicamente') || text.includes('ir personalmente') || text.includes('conocer los productos en persona') ||
      text.includes('ir a conocer los productos') || text.includes('coordinar visita') ||
      text.includes('pasar por ahi') || text.includes('pasar por la empresa') || text.includes('pasar por el local') ||
      (text.includes('puedo ir') && !text.includes('puedo ir a la web'));

    if (isVisitRequest) {
      return {
        primary_area: 'VISITA_COMERCIAL',
        secondary_areas: text.includes('comprar') || text.includes('cotizar') ? ['PRODUCTO_COMERCIAL'] : [],
        confidence: 0.96,
        reason: 'El cliente manifiesta la intención de visitar AITUE o ver productos presencialmente.'
      };
    }

    // 1.1. UBICACIÓN GENERAL / SEDES / DÓNDE ESTÁN UBICADOS (Sin solicitar visita presencial)
    const isLocationRequest = text.includes('donde estan ubicacion') || text.includes('donde estan ubicados') ||
      text.includes('donde estan') || text.includes('donde quedan') || text.includes('donde se encuentran') ||
      text.includes('donde stan') || text.includes('ubicacion') || text.includes('sedes') ||
      text.includes('donde tienen oficinas') || text.includes('donde tienen sedes') ||
      text.includes('donde estan las sedes') || text.includes('en que paises') || text.includes('donde operan') ||
      text.includes('donde esta aitue') || text.includes('donde queda aitue');

    if (isLocationRequest) {
      return {
        primary_area: 'UBICACION_GENERAL',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente consulta dónde se encuentra AITUE, sus sedes o ubicación.'
      };
    }

    // 2. ENVIO_MERCADOLIBRE (RECEPCIÓN DE PEDIDOS Y ENVIOS RECIBIDOS O CON PROBLEMAS)
    const isShippingIssue = text.includes('me llego') || text.includes('no llega') || text.includes('no me llega') || text.includes('llego mal') || text.includes('me llego mal') ||
      text.includes('me llego roto') || text.includes('llego roto') || text.includes('llego falla') ||
      (text.includes('reclamar') && text.includes('cable')) || text.includes('me vino roto') || text.includes('vino roto') ||
      text.includes('me vino mal') || text.includes('vino mal') || text.includes('me llego incompleto') ||
      text.includes('no llego mi pedido') || text.includes('no llego') || text.includes('no me llego') ||
      text.includes('donde esta mi pedido') || text.includes('seguimiento') || text.includes('despacho') ||
      text.includes('mercado libre') || text.includes('mercadolibre') || text.includes('envio') || text.includes('pedido') || text.includes('paquete') ||
      text.includes('recibi mal') || text.includes('recibi roto') || text.includes('recibi incompleto') ||
      text.includes('problema con el envio') || text.includes('problema con mi envio') ||
      text.includes('problema con el pedido') || text.includes('problema con mi pedido') ||
      text.includes('problema con el paquete') || text.includes('problema con mi paquete');

    const hasExistingShipmentStatus = text.includes('no llego') || text.includes('no me llego') ||
      text.includes('no llega') || text.includes('no me llega') || text.includes('seguimiento') || text.includes('donde esta mi pedido') ||
      text.includes('me llego') || text.includes('recibi') || text.includes('problema con el envio') ||
      text.includes('problema con el pedido') || text.includes('problema con el paquete') ||
      text.includes('mercado libre') || text.includes('mercadolibre');
    const hasAccessoryReferenceForPurchase = /\b(?:cable|cables|conector|conectores|fuente|fuentes|transformador|transformadores|soporte|soportes|repuesto|repuestos|adaptador|adaptadores|accesorio|accesorios|usb|usb-c|30v|12v|220v|dbt|starlink|antena|equipo|producto)\b/.test(text);
    const hasAccessoryPurchaseLanguage = /\b(?:comprar|compro|compra|cotizar|cotizacion|precio|presupuesto|pedir|pido|queria|quiero|busco|buscando|tienen|venden|disponible|transferencia|transferir|transfiero)\b/.test(text);
    const hasAccessoryQuantity = /\b(?:[2-9]|\d{2,})\b/.test(text) ||
      /\b(?:dos|tres|cuatro|varios|varias|cantidad|volumen|mayorista|mayoristas)\b/.test(text) ||
      text.includes('en cantidad') || text.includes('mas de uno') || text.includes('más de uno') || text.includes('un par');
    const isNewAccessoryPurchase = /\b(?:comprar|compro|compra|cotizar|cotizacion|precio|presupuesto)\b/.test(text) &&
      hasAccessoryReferenceForPurchase;
    const hasAccessoryFailureLanguage = /\b(?:problema|problemas|falla|fallas|roto|rompio|danado|dano|no funciona|no anda)\b/.test(text);
    const isAccessoryPurchaseRequest = (text.includes('cable') || text.includes('cables')) &&
      (hasAccessoryPurchaseLanguage || hasAccessoryQuantity) && !hasAccessoryFailureLanguage;

    if (isAccessoryPurchaseRequest && !hasExistingShipmentStatus) {
      return {
        primary_area: 'PRODUCTO_COMERCIAL',
        secondary_areas: [],
        commercialHandoff: true,
        confidence: 0.99,
        reason: 'El cliente solicita comprar un cable o accesorio, posiblemente en cantidad, y debe ser atendido por Gerencia Comercial.'
      };
    }

    if (isShippingIssue && !text.includes('cuanto cuesta el envio') && !text.includes('precio de envio') &&
      !(isNewAccessoryPurchase && !hasExistingShipmentStatus)) {
      const isDamagedItem = text.includes('roto') || text.includes('danado') || text.includes('dano') || text.includes('rompio') || text.includes('csble') || text.includes('falla');
      return {
        primary_area: 'ENVIO_MERCADOLIBRE',
        secondary_areas: isDamagedItem ? ['PRODUCTO_TECNICO'] : [],
        confidence: 0.98,
        reason: isDamagedItem
          ? 'El cliente reporta un pedido o envío recibido con un producto o cable roto/dañado.'
          : 'El cliente consulta por el estado, seguimiento de un envío, pedido o Mercado Libre.'
      };
    }

    const hasInternationalSalesIntent = /\b(?:comprar|compro|compra|compras|precio|cotizacion|cotizar|presupuesto|venta|ventas|venden|asesoria|asesoramiento|asesor|disponibilidad|cantidad|volumen|exportacion|exportar)\b/.test(text) ||
      /\b(?:quiero|busco|necesito|quisiera)\s+(?:un|una|el|la)\s+(?:equipo|antena|producto|cable|conector|fuente|soporte|starlink|aitue)\b/.test(text) ||
      /\b(?:flota|camionetas|vehiculos|unidades|empresa|mineria|proyecto corporativo|b2b)\b/.test(text);
    const isNetworkProblem = /\bno tengo internet\b|\bno funciona (?:el )?internet\b|\binternet (?:no funciona|no anda|se cayo|esta caido)\b|\bproblemas? (?:de|con) (?:internet|(?:la )?conectividad|(?:la )?conexion|red)\b|\bsin senal\b|\bproblemas? de conectividad\b|\binterrupcion de conectividad\b|\bconsumo de datos\b|\bservicio caido\b/.test(text);
    const hasNetworkSalesIntent = /\b(?:contratar|cotizar|cotizacion|precio|cuanto cuesta|planes)\b/.test(text) &&
      /\b(?:internet|satelital|satelite|servicio|plan|planes)\b/.test(text);

    if (isNetworkProblem) {
      const secondary_areas = isNewAccessoryPurchase
        ? ['PRODUCTO_COMERCIAL']
        : hasNetworkSalesIntent
          ? [(isInternationalMention || contextState.isInternationalNumber)
            ? 'COMERCIAL_INTERNACIONAL'
            : 'INTERNET_COMERCIAL']
          : [];
      return {
        primary_area: 'INTERNET_SOPORTE',
        secondary_areas,
        confidence: 0.98,
        reason: 'El cliente reporta un problema de conectividad o del servicio de Internet satelital.'
      };
    }

    const hasTechnicalProblem = /\b(?:problema|problemas|falla|fallas|roto|danado|no funciona|no anda|sin senal|conectividad|conexi|activar|desactivar|interrup|consumo|no tengo internet)\b/.test(text);

    if ((isInternationalMention || contextState.isInternationalNumber) &&
      hasInternationalSalesIntent && !hasTechnicalProblem) {
      return {
        primary_area: 'COMERCIAL_INTERNACIONAL',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente solicita una compra, venta o asesoría comercial internacional.'
      };
    }

    // 2b. PROBLEMAS DE CONECTIVIDAD, CONSUMO, ACTIVACIÓN O INTERRUPCIÓN DE SERVICIO -> INTERNET_SOPORTE
    const hasAccessoryReference = /\b(?:cable|conector|fuente|transformador|soporte|repuesto|adaptador|accesorio|usb|ethernet|gabinete|carcasa)\b/.test(text);
    const isCommercialInternet = !isNewAccessoryPurchase && (text.includes('contratar') ||
      ((text.includes('cuanto cuesta') || text.includes('precio') || text.includes('planes')) &&
        /\b(?:internet|satelital|satelite|servicio)\b/.test(text)) ||
      ((text.includes('quiero') || text.includes('deseo')) && text.includes('intern') &&
        !text.includes('problem') && !text.includes('falla') && !hasAccessoryReference));

    const isAntennaConnectionIssue = !isCommercialInternet && !hasAccessoryReference && (
      text.includes('intern') || text.includes('conectiv') || text.includes('conexi') || text.includes('consumo') ||
      text.includes('interrup') || text.includes('activac') || text.includes('activar') || text.includes('desactiv') ||
      (text.includes('antena') && (text.includes('problem') || text.includes('falla') || text.includes('no anda') || text.includes('no funciona'))) ||
      text.includes('sin senal') || text.includes('sin señal') || text.includes('servicio caido') || text.includes('servicio caído')
    );

    if (isAntennaConnectionIssue) {
      return {
        primary_area: 'INTERNET_SOPORTE',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente reporta una consulta de conectividad, internet, consumo de datos, activación o interrupción del servicio. Se deriva exclusivamente a Soporte de Red Vía Satelital.'
      };
    }

    // 3. DETECCIÓN MULTI-INTENCIÓN (ej. "Tengo un Pro que no funciona y quiero cotizar otro")
    const mentionsFailure = text.includes('no funciona') || text.includes('rompio') || text.includes('roto') || text.includes('falla') || text.includes('dano');
    const mentionsQuote = text.includes('cotizar') || text.includes('comprar') || text.includes('cuanto cuesta') || text.includes('precio');

    if (mentionsFailure && mentionsQuote) {
      return {
        primary_area: 'PRODUCTO_TECNICO',
        secondary_areas: ['PRODUCTO_COMERCIAL'],
        confidence: 0.96,
        reason: 'El cliente informa una falla en su equipo y consulta cotización para uno nuevo.'
      };
    }

    // 4. PRODUCTO_TECNICO: REGLA DE ORO — Si el cliente refiere a un PROBLEMA, FALLA, MAL FUNCIONAMIENTO O DAÑO con un producto, cable, conector o accesorio
    const hasProductProblem = text.includes('problema') || text.includes('problemas') || text.includes('problemaa') ||
      text.includes('no anda') || text.includes('no me anda') || text.includes('no funciona') ||
      text.includes('dejo de funcionar') || text.includes('dejó de funcionar') || text.includes('se me rompio') ||
      text.includes('se rompio') || text.includes('roto') || text.includes('danado') || text.includes('dano') ||
      text.includes('falla') || text.includes('fallando') || text.includes('no prende') || text.includes('no alimenta') ||
      text.includes('cable roto') || text.includes('conector roto') || text.includes('falla de conector') || text.includes('falla de cable');

    const isExplicitBuyIntent = (text.includes('comprar') || text.includes('cuanto cuesta') || text.includes('precio') || text.includes('cotizar')) &&
      !text.includes('problema') && !text.includes('no anda');

    if (hasProductProblem && !isExplicitBuyIntent) {
      return {
        primary_area: 'PRODUCTO_TECNICO',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente refiere a un problema, falla o mal funcionamiento con un producto, conector, cable o accesorio.'
      };
    }

    // 3.5. B2B: Soluciones corporativas, flotas, volumen y minería
    const hasMultipleVehicleQuantity = /\b(?:[2-9]|\d{2,}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|varias|muchas)\s+(?:camionetas|vehiculos|unidades)\b/.test(text);
    const isB2BRequest = text.includes('flota') ||
      hasMultipleVehicleQuantity ||
      (text.includes('camionetas') && (text.includes('tenemos') || text.includes('empresa'))) ||
      text.includes('vehiculos') || text.includes('unidades') ||
      text.includes('compra en volumen') || text.includes('mineria') || text.includes('proyecto corporativo') || text.includes('b2b');

    if (isB2BRequest) {
      return {
        primary_area: 'B2B',
        secondary_areas: ['PRODUCTO_COMERCIAL'],
        confidence: 0.95,
        reason: 'El cliente representa una empresa o flota con necesidades corporativas en volumen.'
      };
    }

    // 4. CONSULTA ESPECÍFICA POR PROTECTOR O SELECCIÓN DE LÍNEA (STANDARD, PRO, ULTRA)
    const isMiniTerminalQuestion = /\bmini(?:\s*x)?\b/.test(text) &&
      (text.includes('que es ') || text.includes('quiero saber') || text.includes('modelo')) &&
      !/\b(standard|pro|ultra)\b/.test(text) && !text.includes('accesorio');

    if (isMiniTerminalQuestion) {
      return {
        primary_area: 'PRODUCTO_INFO',
        secondary_areas: ['STARLINK_TERMINAL_INFO'],
        confidence: 0.99,
        reason: 'Starlink Mini y Mini X son terminales compatibles, no líneas propias de AITUE.'
      };
    }

    const isQuestionWhatIs = text.includes('que es ') || text.includes('qué es ');
    const isModelOverviewRequest = text.includes('quiero saber del modelo') ||
      text.includes('quiero saber sobre el modelo') || text.includes('quiero saber sobre') ||
      text.includes('quiero informacion sobre') || text.includes('quiero informacion de') ||
      text.includes('informacion sobre') || text.includes('informacion de') ||
      text.includes('que es aitue modelo') || text.includes('qué es aitue modelo') ||
      text.includes('que es modelo') || text.includes('qué es modelo');
    const hasExplicitCommercialIntent = /\b(comprar|compra|cotizacion|cotizar|presupuesto|disponibilidad|asesoramiento|asesoria)\b/.test(text);

    if (isModelOverviewRequest && !hasExplicitCommercialIntent) {
      return {
        primary_area: 'PRODUCTO_INFO',
        secondary_areas: [],
        confidence: 0.96,
        reason: 'El cliente consulta por el modelo AITUE y desea información general del producto.'
      };
    }

    if (!isQuestionWhatIs) {
      // Si está en contexto de selección de solución (se presentó el menú de 3 soluciones):
      if (contextState.currentTopic === 'PRODUCTO_COMERCIAL' || contextState.currentTopic === 'PRODUCTO_INFO' || contextState.secondary_areas?.includes('PROTECTOR_ADVICE')) {
        if (text === '1' || text === 'opcion 1' || text.includes('standard') || text.includes('aitue standard') || text.includes('fija') || text.includes('casa')) {
          return {
            primary_area: 'PRODUCTO_COMERCIAL',
            secondary_areas: ['STANDARD_ADVICE'],
            confidence: 1.0,
            reason: 'El cliente seleccionó la Opción 1: Aitue Standard.'
          };
        }
        if (text === '2' || text === 'opcion 2' || text.includes('pro') || text.includes('aitue pro') || text.includes('auto') || text.includes('camioneta') || text.includes('movil')) {
          return {
            primary_area: 'PRODUCTO_COMERCIAL',
            secondary_areas: ['PRO_ADVICE'],
            confidence: 1.0,
            reason: 'El cliente seleccionó la Opción 2: Aitue Pro.'
          };
        }
        if (text === '3' || text === 'opcion 3' || text.includes('ultra') || text.includes('linea ultra') || text.includes('ultra+')) {
          return {
            primary_area: 'PRODUCTO_COMERCIAL',
            secondary_areas: ['ULTRA_ADVICE'],
            confidence: 1.0,
            reason: 'El cliente seleccionó la Opción 3: Línea Ultra+.'
          };
        }
      }

      const isGenericProtector = (text.includes('protector') || text.includes('protectores') || text.includes('funda') || text.includes('proteccion') || text.includes('gabinete') || text.includes('solucion') || text.includes('soluciones')) && !text.includes('ultra');
      const isUltra = text.includes('ultra') || text.includes('ultra+') || text.includes('un ultra');
      const isPro = !isUltra && !isGenericProtector && (/\bpro\b/.test(text) || text.includes('aitue pro') || text.includes('auto') || text.includes('camioneta') || text.includes('movil'));
      const isStandard = !isUltra && !isGenericProtector && !isPro && (/\bstandard\b/.test(text) || text.includes('estandar') || text.includes('fija') || text.includes('casa'));

      if (isGenericProtector) {
        return {
          primary_area: 'PRODUCTO_COMERCIAL',
          secondary_areas: ['PROTECTOR_ADVICE'],
          commercialHandoff: hasExplicitCommercialIntent,
          confidence: 0.98,
          reason: 'El cliente solicita información sobre protectores o soluciones AITUE.'
        };
      }
      if (isUltra) {
        return {
          primary_area: 'PRODUCTO_COMERCIAL',
          secondary_areas: ['ULTRA_ADVICE'],
          commercialHandoff: hasExplicitCommercialIntent,
          confidence: 0.98,
          reason: 'El cliente selecciona la Línea Ultra+ de AITUE.'
        };
      }
      if (isPro) {
        return {
          primary_area: 'PRODUCTO_COMERCIAL',
          secondary_areas: ['PRO_ADVICE'],
          commercialHandoff: hasExplicitCommercialIntent,
          confidence: 0.98,
          reason: 'El cliente selecciona la Línea Aitue Pro (móvil/vehicular).'
        };
      }
      if (isStandard) {
        return {
          primary_area: 'PRODUCTO_COMERCIAL',
          secondary_areas: ['STANDARD_ADVICE'],
          commercialHandoff: hasExplicitCommercialIntent,
          confidence: 0.98,
          reason: 'El cliente selecciona la Línea Aitue Standard (fija).'
        };
      }
    }

    const isAccessoryInformationQuery = text.includes('que accesorios') || text.includes('accesorios existen') ||
      text.includes('que componentes') || text.includes('componentes disponibles');
    if (isAccessoryInformationQuery) {
      return {
        primary_area: 'PRODUCTO_INFO',
        secondary_areas: [],
        confidence: 0.96,
        reason: 'El cliente solicita información general sobre los accesorios disponibles.'
      };
    }

    // 5. CONSULTA POR CABLES, CONECTORES, ALIMENTACIÓN, TRANSFORMADORES, FUENTES, SOPORTES, REPUESTOS O ACCESORIOS DE TIENDA
    const isAccessoriesQuery = text.includes('cable') || text.includes('cables') ||
      text.includes('conector') || text.includes('conectores') ||
      text.includes('alimentacion') || text.includes('alimentación') ||
      text.includes('fuente') || text.includes('fuentes') ||
      text.includes('transformador') || text.includes('tranformador') || text.includes('trasformador') ||
      text.includes('transformadores') || text.includes('tranformadores') || text.includes('trasformadores') ||
      text.includes('220v') || text.includes('220 v') || text.includes('30v') || text.includes('12v') ||
      text.includes('repuesto') || text.includes('repuestos') || text.includes('adaptador') || text.includes('adaptadores') ||
      text.includes('soporte') || text.includes('soportes') || text.includes('mastil') || text.includes('mástil') ||
      text.includes('fijacion') || text.includes('fijaciones') || text.includes('accesorios') || text.includes('accesorio') ||
      text.includes('ethernet') || text.includes('imanes') || text.includes('iman') || text.includes('neodimio') ||
      text.includes('gabinete') || text.includes('carcasa') || text.includes('puente') || text.includes('dbt') || text.includes('direct battery') ||
      text.includes('pie de antena') || text.includes('elevador') || text.includes('encendedor') || text.includes('oring') || text.includes('o-ring');

    const isAccessoryPurchaseOrAdvice = text.includes('compra') || text.includes('precio') ||
      text.includes('cotizacion') || text.includes('cotizar') || text.includes('presupuesto') ||
      /\basesor\w*\b/.test(text);
    const hasCableReference = text.includes('cable') || text.includes('cables');
    const hasCablePurchaseSignal = /\b(tienen|quer[ií]a|quiero|busco|venden|disponible|hay)\b/.test(text) ||
      (/\b(necesito|quisiera)\b/.test(text) && (text.includes('cable para') || text.includes('cable de')));
    const hasQuantityPurchaseSignal = /\b(?:[2-9]|\d{2,})\b/.test(text) ||
      /\b(?:dos|tres|cuatro|varios|varias|cantidad|volumen|mayorista|mayoristas)\b/.test(text) ||
      text.includes('en cantidad') || text.includes('mas de uno') || text.includes('más de uno') || text.includes('un par');
    const hasAccessoryFailureSignal = text.includes('se rompio') || text.includes('roto') ||
      text.includes('falla') || text.includes('problema') || text.includes('no anda') ||
      text.includes('no funciona') || text.includes('danado') || text.includes('dano');

    if ((hasCableReference && (hasCablePurchaseSignal || hasQuantityPurchaseSignal) ||
      (isAccessoriesQuery && hasQuantityPurchaseSignal)) && !hasAccessoryFailureSignal) {
      return {
        primary_area: 'PRODUCTO_COMERCIAL',
        secondary_areas: [],
        commercialHandoff: true,
        confidence: 0.98,
        reason: 'El cliente desea comprar un cable o accesorio, posiblemente en cantidad, y debe ser atendido por Gerencia Comercial.'
      };
    }

    if (isAccessoriesQuery && !isAccessoryPurchaseOrAdvice && !hasAccessoryFailureSignal) {
      return {
        primary_area: 'PRODUCTO_TECNICO',
        secondary_areas: ['ACCESSORIES_ADVICE'],
        confidence: 0.98,
        reason: `El cliente consulta por un producto o accesorio del catálogo de tienda (${text}).`
      };
    }



    // 7. INTERNET_SOPORTE: Activaciones, desactivaciones, bajas y problemas de señal/red del servicio satelital
    const isInternetSupport = text.includes('activar') || text.includes('activacion') || text.includes('actibar') || text.includes('aktivar') || text.includes('actibacion') ||
      text.includes('desactivar') || text.includes('desactivacion') || text.includes('desactibar') || text.includes('desaktivar') ||
      text.includes('baja') || text.includes('basja') || text.includes('vaja') || text.includes('vasja') || text.includes('cancelar') || text.includes('cancelacion') || text.includes('pausar') || text.includes('suspender') ||
      text.includes('ayuda para activar') || text.includes('ayuda activar') || text.includes('activar mi antena') || text.includes('activar antena') ||
      text.includes('no tengo internet') || text.includes('no funciona internet') || text.includes('sin senal') ||
      text.includes('no tengo senal') || text.includes('problema de conexion') || text.includes('problema de red') || text.includes('servicio caido');

    if (isInternetSupport) {
      return {
        primary_area: 'INTERNET_SOPORTE',
        secondary_areas: [],
        confidence: 0.96,
        reason: 'El cliente requiere asistencia técnica de red o gestión del servicio satelital activo.'
      };
    }

    // 8. PAGO: Operaciones y problemas de pago o facturación
    const isPaymentIssue = text.includes('pago fue rechazado') || text.includes('pago rechazado') ||
      text.includes('pago no acreditado') || text.includes('error de pago') || text.includes('problema con pago') ||
      text.includes('inconveniente al pagar') || text.includes('transferencia fue rechazada') ||
      text.includes('transferencia rechazada') || text.includes('transferencia no acreditada');

    if (isPaymentIssue) {
      return {
        primary_area: 'PAGO',
        secondary_areas: [],
        confidence: 0.96,
        reason: 'El cliente reporta un inconveniente específico con una operación de pago.'
      };
    }


    // 10. INTERNET_COMERCIAL: Contratación, planes, precio del servicio satelital
    const isInternetCommercial = !isNewAccessoryPurchase &&
      (text.includes('internet') || text.includes('satelital') || text.includes('satelite')) &&
      (text.includes('quiero') || text.includes('contratar') || text.includes('precio') || text.includes('cuanto cuesta') || text.includes('planes') || text.includes('cotizar'));

    const isGenericAntennaHelp = (text.includes('antena') || text.includes('starlink')) &&
      (text.includes('ayuda') || text.includes('ayudame') || text.includes('necesito') || text.includes('consulta') || text.includes('problema')) &&
      !text.includes('precio') && !text.includes('comprar') && !text.includes('cotizar') && !text.includes('vender');

    if (isInternetCommercial || text === 'quiero internet') {
      return {
        primary_area: 'INTERNET_COMERCIAL',
        secondary_areas: [],
        confidence: 0.95,
        reason: 'El cliente manifiesta interés en la información o contratación del servicio de Internet vía satélite.'
      };
    }

    if (isGenericAntennaHelp) {
      return {
        primary_area: 'INTERNET_SOPORTE',
        secondary_areas: [],
        confidence: 0.94,
        reason: 'El cliente consulta ayuda o soporte técnico respecto a su antena o servicio satelital.'
      };
    }

    // 11. PRODUCTO_COMERCIAL: Compra, precio, cotización, disponibilidad, ventas en cantidad o asesoramiento
    const isProductCommercial = text.includes('cuanto cuesta el pro') ||
      text.includes('quiero comprar') || text.includes('comprar') || text.includes('compra') || text.includes('cuanto cuesta') || text.includes('precio') ||
      text.includes('cotizacion') || text.includes('cotizar') || text.includes('presupuesto') || text.includes('disponibilidad') ||
      text.includes('v2') || text.includes('starlink v2') || text.includes('tienen v2') || text.includes('saber si tienen') || text.includes('tienen el') || text.includes('tienen la') || text.includes('tienen disponible') || text.includes('tienen producto') || text.includes('venden') ||
      text.includes('ventas') || text.includes('asesoria') || text.includes('asesoramiento') || /\basesor\w*\b/.test(text) || text.includes('en cantidad') ||
      ((text.includes('quiero') || text.includes('busco') || text.includes('necesito') || text.includes('quisiera')) &&
       (text.includes('antena') || text.includes('starlink') || text.includes('stralink') || text.includes('estarlik') || text.includes('estarlink') || text.includes('equipo')));

    if (isProductCommercial) {
      return {
        primary_area: 'PRODUCTO_COMERCIAL',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'El cliente desea información de ventas, asesoramiento, disponibilidad, cotización o compras.'
      };
    }

    // 12. PRODUCTO_INFO: Información general de características de producto sin compra explícita ni falla
    const isProductInfo = text.includes('que es aitue pro') || text.includes('que es aitue standard') ||
      text.includes('que es aitue modelo') ||
      text.includes('quiero saber sobre el modelo') || text.includes('quiero saber sobre el standard') ||
      text.includes('quiero saber sobre el pro') || text.includes('quiero saber sobre el ultra') ||
      text.includes('que productos tienen') || text.includes('que modelos tienen') ||
      text.includes('modelos disponibles') || text.includes('modelos tienen') ||
      text.includes('que accesorios') || text.includes('ver productos') ||
      text.includes('tambien hacen accesorios') || text.includes('caracteristicas') ||
      text.includes('como funciona') || text.includes('como funcionan') ||
      text.includes('para que sirve');

    if (isProductInfo) {
      return {
        primary_area: 'PRODUCTO_INFO',
        secondary_areas: [],
        confidence: 0.95,
        reason: 'El cliente solicita información sobre modelos, funcionamiento o características de productos o accesorios.'
      };
    }

    // 13. EMPRESA_INFO: Consultas sobre la empresa AITUE, su sitio web y tecnologías
    const isEmpresaInfo = text.includes('que es aitue') || text.includes('quienes son') ||
      text.includes('que hace aitue') || text.includes('a que se dedican') || text.includes('sobre aitue') || text.includes('acerca de aitue') ||
      text.includes('saber mas de aitue') || text.includes('saber mas sobre aitue') || text.includes('conocer mas sobre aitue') || text.includes('conocer mas de aitue') ||
      text.includes('donde queda aitue') || text.includes('donde esta aitue') || text.includes('sedes') || text.includes('donde tienen oficinas') ||
      text.includes('tecnologia') || text.includes('tecnologias') || text.includes('tecnologia maneja') || text.includes('tecnologia usan') ||
      text.includes('pagina web') || text.includes('sitio web') || text.includes('cual es la pagina') || text.includes('cual es la web') ||
      text.includes('link de la pagina') || text.includes('link web') || text.includes('direccion web') || text.includes('web oficial') || text.includes('sitio oficial') || text.includes('pagina de aitue') || text.includes('web de aitue');

    if (isEmpresaInfo) {
      return {
        primary_area: 'EMPRESA_INFO',
        secondary_areas: [],
        confidence: 0.93,
        reason: 'El cliente consulta sobre la empresa AITUE, su trayectoria e información institucional.'
      };
    }

    // Default: Evaluado con confianza reducida para solicitar aclaración si no hay patrones claros
    return {
      primary_area: 'OPERATIVA',
      secondary_areas: [],
      confidence: 0.45,
      reason: 'El mensaje es vago o ambiguo y requiere una pregunta aclaratoria.'
    };
  }

  static checkPureGreeting(text) {
    const pureGreetings = ['hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'hola bot', 'hola aitue', 'hla', 'ola', 'hola buenas', 'hola como estas'];
    return pureGreetings.includes(text) || text === 'hola';
  }

  static checkFarewell(text) {
    const farewells = ['chau', 'adios', 'hasta luego', 'hasta pronto', 'gracias', 'muchas gracias', 'nos vemos', 'perfecto', 'listo', 'genial', 'buenisimo', 'excelente', 'ok gracias', 'listo gracias'];
    return farewells.some(f => text.includes(f));
  }

  static hasActionIntent(text) {
    const actionWords = [
      'comprar', 'precio', 'costo', 'cotizar', 'rompio', 'roto', 'falla', 'internet', 'envio', 'pago',
      'visita', 'donde', 'tienen', 'v2', 'protector', 'cable', 'conector', 'alimentacion', 'auto',
      'camioneta', 'movil', 'fija', 'problema', 'anda', 'ubicacion', 'sedes', 'direccion', 'oficina',
      'quienes', 'hace', 'dedican', 'distribuidor', 'mayorista', 'factura', 'comprobante', 'despacho', 'mercado'
    ];
    return actionWords.some(w => text.includes(w));
  }
}
