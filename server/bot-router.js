// ----------------------------------------------------
// AITUE COMUNICA S.A. - ROUTER CENTRAL DE DERIVACIONES POR ÁREA
// ----------------------------------------------------

import { PROTOCOLS } from './protocols.js';
import { CONTACTS, LINKS } from './contacts.js';

const HANDOFF_NOTIFICATION_EXCLUDED_CONTACT_IDS = new Set(['envios', 'operativa']);

export default class BotRouter {
  static isEmailOnlyHandoff(routeResult) {
    if (!routeResult || routeResult.isFallback) return false;
    return routeResult.action === 'DERIVE_TO_SHIPPING' ||
      routeResult.action === 'DERIVE_TO_OPERATIVA';
  }

  static isCustomerHandoff(routeResult) {
    if (!routeResult || routeResult.isFallback) return false;
    if (this.isEmailOnlyHandoff(routeResult)) return false;
    if (routeResult.primary_area === 'PRODUCTO_INFO' && routeResult.action !== 'SEND_COMMERCIAL_HANDOFF') return false;

    // Any commercial request must be sent to the responsible area, including
    // product-specific purchase/advice requests such as “quiero comprar un Ultra”.
    const commercialAreas = new Set([
      'PRODUCTO_COMERCIAL',
      'COMERCIAL_INTERNACIONAL',
      'INTERNET_COMERCIAL',
      'B2B',
      'DISTRIBUIDORES',
      'VISITA_COMERCIAL'
    ]);
    const isProtectorAdvice = (routeResult.secondary_areas || []).some(areaId =>
      areaId === 'PROTECTOR_ADVICE' || areaId === 'PROTECTOR_EXPLANATION'
    );
    return (routeResult.commercialHandoff && !isProtectorAdvice && routeResult.action !== 'SEND_PRODUCT_ADVICE') ||
      (commercialAreas.has(routeResult.primary_area) && routeResult.action !== 'SEND_PRODUCT_ADVICE') ||
      routeResult.action === 'DERIVE_TO_CUSTOMER_CARE' ||
      routeResult.action === 'SEND_COMMERCIAL_HANDOFF' ||
      routeResult.action?.startsWith('DERIVE_TO_');
  }

  static getAreaResponsible(areaId) {
    const contactByArea = {
      PRODUCTO_INFO: CONTACTS.comercial,
      PRODUCTO_COMERCIAL: CONTACTS.comercial,
      COMERCIAL_INTERNACIONAL: CONTACTS.comercial_internacional,
      PRODUCTO_TECNICO: CONTACTS.soporte_tecnico,
      INTERNET_COMERCIAL: CONTACTS.comercial,
      INTERNET_SOPORTE: CONTACTS.soporte_tecnico,
      DISTRIBUIDORES: CONTACTS.comercial,
      PAGO: CONTACTS.administracion,
      ENVIO_MERCADOLIBRE: CONTACTS.envios,
      OPERATIVA: CONTACTS.operativa,
      B2B: CONTACTS.comercial,
      VISITA_COMERCIAL: CONTACTS.comercial
    };
    return contactByArea[areaId] ? [contactByArea[areaId]] : [];
  }

  static getHandoffAction(areaId) {
    const actionByArea = {
      PRODUCTO_COMERCIAL: 'DERIVE_TO_COMMERCIAL',
      COMERCIAL_INTERNACIONAL: 'DERIVE_TO_INTERNATIONAL',
      PRODUCTO_TECNICO: 'DERIVE_TO_TECH_SUPPORT',
      INTERNET_COMERCIAL: 'DERIVE_TO_INTERNET_COMMERCIAL',
      INTERNET_SOPORTE: 'DERIVE_TO_INTERNET_SUPPORT',
      DISTRIBUIDORES: 'DERIVE_TO_DISTRIBUTORS',
      ENVIO_MERCADOLIBRE: 'DERIVE_TO_SHIPPING',
      OPERATIVA: 'DERIVE_TO_OPERATIVA',
      B2B: 'DERIVE_TO_COMMERCIAL',
      VISITA_COMERCIAL: 'DERIVE_TO_COMMERCIAL'
    };
    return actionByArea[areaId] || `DERIVE_TO_${areaId}`;
  }

  static getHandoffContacts(routeResult) {
    const contacts = [
      ...(routeResult.responsible || []),
      ...(routeResult.secondary_areas || []).flatMap(areaId => this.getAreaResponsible(areaId))
    ];
    return [...new Map(contacts.filter(Boolean).map(contact => [contact.id, contact])).values()];
  }

  static getHandoffNotificationContacts(routeResult) {
    return this.getHandoffContacts(routeResult).filter(contact =>
      contact.notifyOnHandoff !== false &&
      !HANDOFF_NOTIFICATION_EXCLUDED_CONTACT_IDS.has(contact.id)
    );
  }

  static formatCustomerHandoffResponse(routeResult) {
    const operationalAreas = new Set(['ENVIO_MERCADOLIBRE', 'OPERATIVA']);
    const areaDescriptions = {
      ATENCION_CLIENTE: 'Atención al Cliente revisará tu consulta y se pondrá en contacto con vos.',
      PRODUCTO_INFO: 'Gerencia Comercial revisará tu consulta sobre productos y se pondrá en contacto con vos.',
      PRODUCTO_COMERCIAL: 'Gerencia Comercial revisará tu consulta comercial y se pondrá en contacto con vos.',
      COMERCIAL_INTERNACIONAL: 'Atención Comercial Internacional revisará tu consulta y se pondrá en contacto con vos.',
      PRODUCTO_TECNICO: 'Atención al Cliente revisará tu consulta técnica y se pondrá en contacto con vos.',
      INTERNET_COMERCIAL: 'Gerencia Comercial revisará tu consulta sobre Internet satelital y se pondrá en contacto con vos.',
      INTERNET_SOPORTE: 'Atención al Cliente revisará tu consulta de conectividad y se pondrá en contacto con vos.',
      DISTRIBUIDORES: 'Atención a Distribuidores revisará tu consulta y se pondrá en contacto con vos.',
      PAGO: 'Facturación y Administración revisará tu consulta y se pondrá en contacto con vos.',
      ENVIO_MERCADOLIBRE: 'Para consultas sobre paquetes y envíos, escribí a clientes@aitue.net.',
      B2B: 'Para proyectos corporativos, soluciones integrales para flotas vehiculares o compras institucionales en volumen, nuestra Gerencia Comercial brindará atención personalizada y se pondrá en contacto con vos.',
      VISITA_COMERCIAL: 'Gerencia Comercial revisará tu solicitud de visita y se pondrá en contacto con vos.',
      OPERATIVA: 'Para realizar tu consulta a Operativa, escribí a clientes@aitue.net.'
    };
    const handoffDescription = areaDescriptions[routeResult.primary_area] ||
      `${routeResult.area || 'El área correspondiente'} revisará tu consulta y se pondrá en contacto con vos.`;
    const availability = operationalAreas.has(routeResult.primary_area)
      ? '🕒 Horario de atención de Operativa: lunes a viernes, de 09:00 a 18:00 hs (Argentina).'
      : '🕒 Horario de atención del área: 24/7.';
    return `Gracias por comentarnos tu situación. ${handoffDescription}\n\n${availability}\n¡Gracias!`;
  }

  static route(classification, contextState = {}) {
    const { primary_area, secondary_areas = [], confidence = 1.0, reason = '' } = classification;

    // 0. Mensaje incoherente -> derivar a Operativa para seguimiento humano.
    if (primary_area === 'OPERATIVA_INCOHERENT') {
      return {
        intent: 'OPERATIVA_INCOHERENT',
        primary_area: 'OPERATIVA',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'Mensaje incoherente o incomprensible',
        area: 'Operativa — Canal General',
        areaId: 'OPERATIVA',
        responsible: [CONTACTS.operativa],
        action: 'DERIVE_TO_OPERATIVA',
        response: '',
        isFallback: false
      };
    }

    if (primary_area === 'ATENCION_CLIENTE') {
      return {
        intent: 'ATENCION_CLIENTE',
        primary_area: 'ATENCION_CLIENTE',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'Solicitud de Atención al Cliente',
        area: 'Atención al Cliente',
        areaId: 'ATENCION_CLIENTE',
        responsible: [CONTACTS.soporte_tecnico],
        action: 'DERIVE_TO_CUSTOMER_CARE',
        response: 'Atención al Cliente revisará tu consulta y se pondrá en contacto con vos.',
        isFallback: false
      };
    }

    // 0b. Solicitud de Atención Humana / Operador -> Pausa de Bot y notificación
    if (primary_area === 'HUMAN_HANDOVER') {
      return {
        intent: 'HUMAN_HANDOVER',
        primary_area: 'HUMAN_HANDOVER',
        secondary_areas: [],
        confidence: 1.0,
        reason: 'Solicitud de atención por operador humano',
        area: 'Atención Humana',
        areaId: 'HUMAN_HANDOVER',
        responsible: [],
        action: 'PAUSE_BOT',
        response: 'Un representante de nuestro equipo continuará la atención de tu consulta a la brevedad. El bot ha quedado en pausa para este chat.',
        isFallback: false,
        pauseBot: true
      };
    }

    // 1. Saludo cuando ya se saludó previamente en la conversación -> Segundo Saludo Protocolar
    if (primary_area === 'GREETING_ONLY' && contextState.hasGreeted) {
      return {
        intent: 'GREETING_ONLY',
        primary_area: 'GREETING_ONLY',
        secondary_areas: [],
        confidence: 1.0,
        reason: reason || 'Segundo saludo durante la conversación',
        area: null,
        responsible: [],
        action: 'SEND_SECOND_GREETING_PROTOCOL',
        response: PROTOCOLS.SECOND_GREETING,
        isFallback: false
      };
    }

    // 2. Saludo puro inicial -> Protocolo de Bienvenida
    if (primary_area === 'GREETING_ONLY') {
      return {
        intent: 'GREETING_ONLY',
        primary_area: 'GREETING_ONLY',
        secondary_areas: [],
        confidence: 1.0,
        reason: reason || 'Saludo inicial',
        area: null,
        responsible: [],
        action: 'SEND_WELCOME_PROTOCOL',
        response: PROTOCOLS.WELCOME,
        isFallback: false
      };
    }

    // 3. Despedida -> Protocolo de Despedida
    if (primary_area === 'FAREWELL') {
      return {
        intent: 'FAREWELL',
        primary_area: 'FAREWELL',
        secondary_areas: [],
        confidence: 1.0,
        reason: reason || 'Despedida del usuario',
        area: null,
        responsible: [],
        action: 'SEND_FAREWELL_PROTOCOL',
        response: PROTOCOLS.FAREWELL,
        isFallback: false
      };
    }

    // 4. Consulta de Redes Sociales
    if (primary_area === 'REDES_INFO') {
      return {
        intent: 'REDES_INFO',
        primary_area: 'REDES_INFO',
        secondary_areas: [],
        confidence: 1.0,
        reason: reason || 'Consulta de redes sociales',
        area: null,
        responsible: [],
        action: 'SEND_REDES_INFO',
        response: `Podés seguirnos y estar al tanto de todas nuestras novedades, lanzamientos e innovaciones en nuestras redes sociales oficiales:\n\n🌐 Web: ${LINKS.web}\n🛒 Tienda: ${LINKS.shop}\n🔵 Facebook: ${LINKS.facebook}\n📸 Instagram: ${LINKS.instagram}\n💼 LinkedIn: ${LINKS.linkedin}`,
        isFallback: false
      };
    }

    // 4.1 FAQ / RAG — Respuestas Frecuentes Rápidas
    if (primary_area === 'FAQ_PAGOS') {
      return {
        intent: 'FAQ_PAGOS',
        primary_area: 'PAGO',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'Consulta de métodos y formas de pago disponibles',
        area: 'Facturación y Administración',
        responsible: [],
        action: 'PAUSE_BOT',
        response: 'Gracias por tu mensaje. Por favor, aguardá un momento; una persona de nuestro equipo continuará la atención por este chat.\n\n🕒 Horario de atención de Facturación y Administración: 24/7.',
        isFallback: false,
        pauseBot: true
      };
    }

    if (primary_area === 'PAGO') {
      return {
        intent: 'PAGO',
        primary_area: 'PAGO',
        secondary_areas: [],
        confidence,
        reason,
        area: 'Facturación y Administración',
        areaId: 'PAGO',
        responsible: [],
        action: 'PAUSE_BOT',
        response: 'Gracias por tu mensaje. Por favor, aguardá un momento; una persona de nuestro equipo continuará la atención por este chat.\n\n🕒 Horario de atención de Facturación y Administración: 24/7.',
        isFallback: false,
        pauseBot: true
      };
    }

    if (primary_area === 'FAQ_ENVIOS') {
      return {
        intent: 'FAQ_ENVIOS',
        primary_area: 'ENVIO_MERCADOLIBRE',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'Consulta sobre modalidades y tiempos de despacho',
        area: 'Operativa de Envíos y Despachos',
        responsible: [CONTACTS.envios],
        action: 'SEND_FAQ_ENVIOS',
        response: `📦 Modalidades de Envío y Tiempos de Entrega — AITUE COMUNICA S.A.:\n\n• 🚚 Envíos a todo el país (Argentina e Internacional).\n• ⏱️ Despacho rápido en 24 a 48 hs hábiles tras la compra.\n• 🛒 Mercado Envíos, correo prioritario o expreso a elección.\n\n🛒 Calculá el costo de envío ingresando tu código postal en la tienda oficial:\n${LINKS.shop}\n\nPara consultas sobre paquetes, pedidos o seguimiento de envíos:\n📧 ${CONTACTS.envios.email}`,
        isFallback: false
      };
    }

    if (primary_area === 'FAQ_GARANTIA') {
      return {
        intent: 'FAQ_GARANTIA',
        primary_area: 'PRODUCTO_TECNICO',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'Consulta sobre garantía y respaldo oficial',
        area: 'Atención al Cliente',
        responsible: [CONTACTS.soporte_tecnico],
        action: 'SEND_FAQ_GARANTIA',
        response: `🛡️ Garantía Oficial y Respaldo — AITUE COMUNICA S.A.:\n\n• 🛡️ Todos los productos y soluciones cuentan con garantía oficial de fábrica.\n• 🛠️ Servicio de soporte técnico 24/7 y repuestos originales.\n\nPara consultas de garantía o servicio técnico:\n🛠️ Atención al Cliente\n📞 WhatsApp / Mensajes: ${CONTACTS.soporte_tecnico.phone}`,
        isFallback: false
      };
    }

    if (primary_area === 'FAQ_COMPATIBILIDAD') {
      return {
        intent: 'FAQ_COMPATIBILIDAD',
        primary_area: 'PRODUCTO_TECNICO',
        secondary_areas: [],
        confidence: 0.98,
        reason: 'Consulta sobre compatibilidad y tensiones eléctricas',
        area: 'Atención al Cliente',
        responsible: [CONTACTS.soporte_tecnico],
        action: 'SEND_FAQ_COMPATIBILIDAD',
        response: `⚡ Compatibilidad y Alimentación Eléctrica — AITUE COMUNICA S.A.:\n\n• 🛰️ Compatibilidad total con Starlink Mini y Mini X.\n• 🚗 Operación en movimiento a 12V / 24V (vía USB-C, encendedor o elevador de tensión a 30V constantes).\n• 🏠 Operación fija residencial a 220V mediante fuentes blindadas de alimentación.\n\n🛒 Podés ver accesorios y kits en la tienda oficial:\n${LINKS.shop}\n\nPara asistencia o asesoramiento técnico:\n🛠️ Atención al Cliente\n📞 WhatsApp / Mensajes: ${CONTACTS.soporte_tecnico.phone}`,
        isFallback: false
      };
    }

    if (primary_area === 'DISTRIBUIDORES') {
      const isInternationalDistributor = classification.isInternationalDistributor ??
        Boolean(contextState.isInternationalNumber);
      const responsible = isInternationalDistributor
        ? CONTACTS.comercial_internacional
        : CONTACTS.comercial;
      return {
        intent: 'DISTRIBUIDORES',
        primary_area: 'DISTRIBUIDORES',
        secondary_areas: [],
        confidence,
        reason,
        area: isInternationalDistributor
          ? 'Atención a Distribuidores Internacionales'
          : 'Atención a Distribuidores Nacionales',
        areaId: 'DISTRIBUIDORES',
        responsible: [responsible],
        action: 'DERIVE_TO_DISTRIBUTORS',
        response: 'Atención a Distribuidores y Distribuidoras revisará tu consulta y se pondrá en contacto con vos.',
        isFallback: false
      };
    }

    // 5. EVALUACIÓN DE CONFIANZA DE CLASIFICACIÓN (Umbral >= 0.70)
    if (confidence >= 0.70) {
      const suppressProductAdvice = false;
      let finalResponseText = '';

      if (!suppressProductAdvice) {
      if (secondary_areas.includes('STARLINK_TERMINAL_INFO') && !suppressProductAdvice) {
        finalResponseText = `Starlink Mini y Mini X son terminales de Starlink, no modelos propios de AITUE.\n\nLas líneas de integración propias de AITUE son Standard, Pro y Ultra+, compatibles con esos terminales. También ofrecemos accesorios y adaptaciones adicionales.\n\n🛒 Catálogo oficial: ${LINKS.shop}`;
      } else if (secondary_areas.includes('PRODUCT_DETAIL_CLARIFICATION')) {
        finalResponseText = '¿Preferís que te derive al Sector Comercial o querés más información sobre el modelo? Respondé “Sector Comercial” o “Más información”.';
      } else if (secondary_areas.includes('COMMERCIAL_HANDOFF')) {
        finalResponseText = this.formatCustomerHandoffResponse({
          primary_area,
          area: primary_area
        });
      } else if (primary_area === 'PRODUCTO_INFO') {
        finalResponseText = `AITUE ofrece soluciones Standard, Pro y Ultra+ compatibles con Starlink Mini y Mini X.

Si querés asesoramiento comercial, respondé "sí" y te derivamos al Sector Comercial.`;
      } else if (secondary_areas.includes('PRODUCT_CATALOG')) {
        const modelName = classification.modelName || 'AITUE';
        const productLinks = {
          'AITUE Pro': `${LINKS.shop}producto/aitue-pro/`,
          'AITUE Standard': `${LINKS.shop}producto/aitue-standard/`
        };
        const productLink = productLinks[modelName] || LINKS.shop;
        finalResponseText = `Para obtener más información del modelo ${modelName}, te sugerimos buscar acá: ${productLink}\n\nSi querés asesoramiento, respondé "sí" y te derivamos a Gerencia Comercial.`;
      } else if (secondary_areas.includes('PROTECTOR_ADVICE')) {
        finalResponseText = `AITUE ofrece soluciones 360° desarrolladas para proteger, integrar y adaptar equipos Starlink Mini y Mini X.

Contamos con 3 líneas principales de soluciones:

1. 🏠 Aitue Standard — Diseñado para instalaciones fijas en hogar, inmuebles y estructuras permanentes.
2. 🚗 Aitue Pro — Desarrollado para uso vehicular y en movimiento (autos, camionetas, flotas), con máxima aerodinámica y resistencia en ruta.
3. ⚡ Línea Ultra+ — Diseñada para la integración de tecnologías avanzadas (sistemas de alimentación de tensión en movimiento, router integrado y componentes personalizados).

¿Cuál de estas 3 soluciones se adapta mejor a tu necesidad?

Si querés asesoramiento comercial, respondé "sí" y te derivamos a Gerencia Comercial.`;
      } else if (secondary_areas.includes('STANDARD_ADVICE')) {
        finalResponseText = `La línea Aitue Standard es 100% compatible con equipos Starlink Mini y Mini X para instalaciones fijas, inmuebles e intemperie continua.

🛒 Podés adquirir tu kit y ver el catálogo en nuestra tienda oficial:
${LINKS.shop}

Si querés asesoramiento comercial, respondé "sí" y te derivamos a Gerencia Comercial:
💼 Gerencia Comercial
📧 ${CONTACTS.comercial.email} | 📞 ${CONTACTS.comercial.phone} (Atención 24/7)`;
      } else if (secondary_areas.includes('PRO_ADVICE')) {
        finalResponseText = `La línea Aitue Pro es 100% compatible con equipos Starlink Mini y Mini X para vehículos en movimiento, flotas y alta exigencia aerodinámica en ruta.

🛒 Podés adquirir tu kit y ver el catálogo en nuestra tienda oficial:
${LINKS.shop}

Si querés asesoramiento comercial, respondé "sí" y te derivamos a Gerencia Comercial:
💼 Gerencia Comercial
📧 ${CONTACTS.comercial.email} | 📞 ${CONTACTS.comercial.phone} (Atención 24/7)`;
      } else if (secondary_areas.includes('ULTRA_ADVICE')) {
        finalResponseText = `La Línea Ultra+ es 100% compatible con equipos Starlink Mini y Mini X e integra fuentes de alimentación en movimiento, router embebido y componentes a medida.

🛒 Podés adquirir tu kit y ver el catálogo en nuestra tienda oficial:
${LINKS.shop}

Si querés asesoramiento comercial, respondé "sí" y te derivamos a Gerencia Comercial:
💼 Gerencia Comercial
📧 ${CONTACTS.comercial.email} | 📞 ${CONTACTS.comercial.phone} (Atención 24/7)`;
      } else if (secondary_areas.includes('ACCESSORIES_ADVICE')) {
        const queryText = (reason || '').toLowerCase();
        let productDetails = '';

        if (queryText.includes('transformador') || queryText.includes('tranformador') || queryText.includes('trasformador') || queryText.includes('220v') || queryText.includes('220 v') || queryText.includes('fuente')) {
          productDetails = 'Contamos con repuestos de fuentes de alimentación a 220V para Starlink Mini (disponibles en versión original Starlink o fabricadas por AITUE).';
        } else if (queryText.includes('cable') || queryText.includes('cables') || queryText.includes('usb') || queryText.includes('12v') || queryText.includes('30v') || queryText.includes('dbt') || queryText.includes('puente') || queryText.includes('encendedor') || queryText.includes('elevador')) {
          productDetails = 'Disponemos de cables de alimentación para Starlink Mini: USB-C (20V), 12V con encendedor, 30V con elevador de tensión, kits DBT a batería y puentes de conexión interna.';
        } else if (queryText.includes('soporte') || queryText.includes('soportes') || queryText.includes('mastil') || queryText.includes('mástil') || queryText.includes('pie') || queryText.includes('ethernet')) {
          productDetails = 'Ofrecemos soportes de pared, mástiles móviles regulables para instalaciones fijas (residenciales, industriales, agropecuarias), adaptadores ethernet y pies de antena a 20° originales.';
        } else if (queryText.includes('iman') || queryText.includes('imanes') || queryText.includes('gabinete') || queryText.includes('carcasa') || queryText.includes('protector') || queryText.includes('oring') || queryText.includes('o-ring')) {
          productDetails = 'Disponemos de gabinetes MIAITUE para Starlink Mini, packs de 4 imanes de neodimio de alta adherencia y nuevos protectores aerodinámicos con O-ring de goma.';
        } else {
          productDetails = 'En nuestra tienda oficial disponemos de toda la línea de componentes y accesorios: cables de alimentación (12V, 30V, USB-C, DBT), fuentes 220V, soportes de pared, gabinetes e imanes de neodimio.';
        }

        const isBulkQuantity = queryText.includes('mas de 5') || queryText.includes('más de 5') || queryText.includes('5 o mas') || queryText.includes('5 o más') || queryText.includes('volumen') || queryText.includes('cantidad') || /\b([6-9]|\d{2,})\b/.test(queryText) || /\b5\s*(unidades|accesorios|cables|dbt|elevadores|soportes|fuentes|imanes|gabinetes)\b/.test(queryText);

        const isCommercialBulk = isBulkQuantity;

        const accessoryContactHeader = isCommercialBulk
          ? 'Para asesoramiento comercial directo o compras en cantidad:'
          : 'Para asistencia, consultas sobre productos o soporte técnico:';

        const accessoryContactBlock = isCommercialBulk
          ? `💼 Gerencia Comercial\n📧 ${CONTACTS.comercial.email} | 📞 WhatsApp / Mensajes: +54 9 11 4164-0955 (Atención 24/7)`
          : `🛠️ Atención al Cliente — Técnico y Productos\n📧 ${CONTACTS.soporte_tecnico.email} | 📞 WhatsApp / Mensajes: +54 9 3872 12-7974 (Atención 24/7)`;

        finalResponseText = `${productDetails}

Podés consultar el catálogo y adquirir tu producto en nuestra tienda oficial:
🛒 Tienda oficial:
${LINKS.shop}

${accessoryContactHeader}
${accessoryContactBlock}`;
      } else if (secondary_areas.includes('ACCESSORIES_EXPLANATION')) {
        const queryText = (reason || '').toLowerCase();
        const isBulkQuantity = queryText.includes('mas de 5') || queryText.includes('más de 5') || queryText.includes('5 o mas') || queryText.includes('5 o más') || queryText.includes('volumen') || queryText.includes('cantidad') || /\b([6-9]|\d{2,})\b/.test(queryText) || /\b5\s*(unidades|accesorios|cables|dbt|elevadores|soportes|fuentes|imanes|gabinetes)\b/.test(queryText);

        const isCommercialBulk = isBulkQuantity;

        const accessoryContactHeader = isCommercialBulk
          ? 'Para asesoramiento comercial directo o compras en cantidad:'
          : 'Para asistencia, consultas sobre productos o soporte técnico:';

        const accessoryContactBlock = isCommercialBulk
          ? `💼 Gerencia Comercial\n📧 ${CONTACTS.comercial.email} | 📞 WhatsApp / Mensajes: +54 9 11 4164-0955 (Atención 24/7)`
          : `🛠️ Atención al Cliente — Técnico y Productos\n📧 ${CONTACTS.soporte_tecnico.email} | 📞 WhatsApp / Mensajes: +54 9 3872 12-7974 (Atención 24/7)`;

        finalResponseText = `A continuación te detallamos la función y uso recomendado de cada tipo de cable y accesorio para Starlink Mini:

1. 🔌 Cable USB-C (20V): Para alimentar el equipo directamente desde cargadores USB-C Power Delivery (PD) de alta potencia o powerbanks portátiles en operaciones de campo.
2. 🚗 Cable 12V con conector encendedor: Para conectar y alimentar el Starlink Mini desde la toma auxiliar de 12V de cualquier auto, camioneta o embarcación.
3. ⚡ Cable 30V con elevador de tensión: Eleva y estabiliza la tensión de 12V a 30V constantes, evitando reinicios o caídas del equipo ante variaciones eléctricas en ruta.
4. 🔋 Kits DBT a batería (Direct Battery Technology): Cableado de conexión directa a batería de vehículo o banco de baterías para instalaciones vehiculares o fijas continuas.
5. 🏠 Fuentes de alimentación 220V: Para conectar el Starlink Mini a la red eléctrica residencial o industrial tradicional de 220V.

🛒 Podés ver especificaciones y adquirir tu producto en nuestra tienda oficial:
${LINKS.shop}

${accessoryContactHeader}
${accessoryContactBlock}`;
      } else if (secondary_areas.includes('PROTECTOR_EXPLANATION')) {
        finalResponseText = `A continuación te detallamos las diferencias y función de cada una de nuestras 3 líneas de soluciones para Starlink Mini y Mini X:

1. 🏠 Aitue Standard (Fija): Desarrollado en gabinete IK10 para fijar de manera continua en inmuebles, techos, torres y estructuras fijas expuestas a la intemperie.
2. 🚗 Aitue Pro (Vehicular): Diseñado con perfil súper bajo y aerodinámico para montar en el techo de autos, camionetas y flotas operativas en ruta a alta velocidad.
3. ⚡ Línea Ultra+ (Integrada): Solución avanzada que incluye gabinetes blindados con fuente de alimentación en movimiento de 12V a 30V integrada, router embebido y cableado personalizado.

🛒 Catálogo y kits en tienda oficial:
${LINKS.shop}

Si querés asesoramiento comercial, respondé "sí" y te derivamos a Gerencia Comercial:
💼 Gerencia Comercial
📧 ${CONTACTS.comercial.email} | 📞 WhatsApp / Mensajes: ${CONTACTS.comercial.phone} (Atención 24/7)`;
      } else if (primary_area === 'ENVIO_MERCADOLIBRE' && secondary_areas.includes('PRODUCTO_TECNICO')) {
        finalResponseText = `📦 Operativa de Envíos y Despachos\n📧 ${CONTACTS.envios.email} (Lunes a viernes, de 09:00 a 18:00 hs AR)\n\n🛠️ Atención al Cliente\n📧 ${CONTACTS.soporte_tecnico.email}`;
      }

      }

      if (!finalResponseText && ['PRODUCTO_COMERCIAL', 'COMERCIAL_INTERNACIONAL', 'INTERNET_COMERCIAL', 'DISTRIBUIDORES', 'B2B', 'VISITA_COMERCIAL', 'OPERATIVA'].includes(primary_area)) {
        finalResponseText = this.formatCustomerHandoffResponse({
          primary_area,
          area: primary_area
        });
      } else if (!finalResponseText && primary_area === 'UBICACION_GENERAL') {
        finalResponseText = PROTOCOLS.UBICACION_GENERAL;
      } else if (!finalResponseText && primary_area === 'EMPRESA_INFO') {
        finalResponseText = PROTOCOLS.EMPRESA_INFO;
      }

      return {
        intent: primary_area,
        primary_area,
        secondary_areas,
        confidence,
        reason,
        selectedClarificationOption: classification.selectedClarificationOption || null,
        commercialHandoff: classification.commercialHandoff === true,
        area: primary_area,
        areaId: primary_area,
        responsible: this.getAreaResponsible(primary_area),
        action: suppressProductAdvice
          ? 'SEND_COMMERCIAL_HANDOFF'
          : classification.commercialHandoff === true && !secondary_areas.some(areaId =>
            areaId === 'PROTECTOR_ADVICE' || areaId === 'PROTECTOR_EXPLANATION'
          )
          ? 'SEND_COMMERCIAL_HANDOFF'
          : primary_area === 'PRODUCTO_INFO' && secondary_areas.length === 0
          ? 'SEND_PRODUCT_ADVICE'
          : secondary_areas.includes('STARLINK_TERMINAL_INFO')
          ? 'SEND_STARLINK_TERMINAL_INFO'
          : secondary_areas.includes('PRODUCT_DETAIL_CLARIFICATION') ? 'SEND_PRODUCT_DETAIL_CLARIFICATION'
          : secondary_areas.includes('COMMERCIAL_HANDOFF') ? 'SEND_COMMERCIAL_HANDOFF'
          : secondary_areas.includes('PRODUCT_CATALOG') ? 'SEND_PRODUCT_CATALOG'
          : secondary_areas.some(areaId => [
            'ACCESSORIES_ADVICE', 'ACCESSORIES_EXPLANATION', 'PROTECTOR_ADVICE',
            'PROTECTOR_EXPLANATION', 'STANDARD_ADVICE', 'PRO_ADVICE', 'ULTRA_ADVICE'
          ].includes(areaId)) ? 'SEND_PRODUCT_ADVICE'
          : primary_area === 'UBICACION_GENERAL' ? 'SEND_LOCATION_INFO'
          : primary_area === 'EMPRESA_INFO' ? 'SEND_COMPANY_INFO'
          : this.getHandoffAction(primary_area),
        response: finalResponseText,
        isFallback: false
      };
    }

    // 6. Baja confianza: pedir aclaración sin crear una derivación a Atención al Cliente.
    return {
      intent: 'CLIENTES_FALLBACK',
      primary_area: 'OPERATIVA',
      secondary_areas: secondary_areas,
      confidence: confidence,
      reason: reason || 'Confianza menor a 0.70. Se solicita aclaración al cliente.',
      area: null,
      areaId: null,
      responsible: [],
      action: 'ASK_CLARIFICATION',
      response: `Disculpas, no logramos interpretar tu consulta con claridad. Para brindarte una rápida asistencia, podés seleccionar la opción deseada o comunicarte directamente con Atención al Cliente:

1. 🛠️ Falla técnica o problema con un producto / cable
2. 📡 Conectividad, señal de antena o activación de servicio
3. 📦 Seguimiento de pedido, despacho o Mercado Libre

🛠️ Atención al Cliente — Soporte y Conectividad
📧 clientes@aitue.net`,
      isFallback: true,
      requiresClarification: true
    };
  }
}
