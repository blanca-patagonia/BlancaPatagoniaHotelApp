/**
 * Diccionario base: español rioplatense.
 *
 * Es la **fuente**: el contenido se escribe acá primero y los otros cuatro
 * idiomas lo traducen. Su tipo (`Diccionario`) obliga a que los demás tengan
 * exactamente las mismas claves, así que olvidarse de traducir algo es un error
 * de compilación y no un hueco que aparece en producción.
 *
 * ⚠️ **Lo que NO va acá:**
 *
 * - **Nombres propios**: «Blanca Patagonia», «El Calafate», «Lago Argentino»,
 *   «Perito Moreno», «Bahía Redonda». No se traducen en ningún idioma; un
 *   «Argentine Lake» no lo encuentra nadie que busque el lugar.
 * - **El catálogo** (nombres de habitaciones, descripciones, comodidades): vive
 *   en la base y se traduce desde el panel, porque el hotel lo edita.
 * - **Los importes**: los formatea `lib/domain/moneda.ts`.
 */

export const es = {
  /* ─────────────────────────────── navegación ─────────────────────────────── */
  nav: {
    idioma: 'Idioma',
    volverArriba: 'Volver arriba',
    navegacion: 'Navegación principal',
    inicio: 'Inicio',
    alojamientos: 'Alojamientos',
    experiencias: 'Experiencias',
    ubicacion: 'Ubicación',
    reservar: 'Reservar',
    conocerMas: 'Conocer más',
    cambiarIdioma: 'Cambiar idioma',
    irAlContenido: 'Ir al contenido',
  },

  /* ──────────────────────────────── portada ──────────────────────────────── */
  portada: {
    lugar: 'El Calafate · Patagonia Argentina',
    titulo: 'Frente al Lago Argentino',
    bajada:
      'Hostería boutique de 15 habitaciones con vista e hidromasaje, y cabañas con hogar a leña. A pasos del Parque Nacional Los Glaciares.',
    sinFechas: 'Todavía no tengo fechas — ver los alojamientos',

    presentacionEtiqueta: 'Un lugar diferente en El Calafate',
    presentacionTitulo: 'Acá todo mira al mismo lugar',
    presentacionTexto:
      'Blanca Patagonia es una hostería boutique de cuatro estrellas con cabañas, en una zona alta de El Calafate. El lobby tiene un ventanal que mira al Lago Argentino, la Bahía Redonda y la Isla Solitaria, y es donde cada mañana se sirve el desayuno buffet.',

    cifraHabitaciones: 'habitaciones',
    cifraHabitacionesPie: 'Todas con vista al lago',
    cifraCategoria: 'categoría',
    cifraCategoriaPie: 'Hostería boutique',
    cifraPersonas: 'personas',
    cifraPersonasPie: 'En la cabaña más grande',
    cifraDistancia: 'al Perito Moreno',
    cifraDistanciaPie: 'Unas dos horas de viaje',

    ventanalTitulo: 'El ventanal',
    ventanalTexto:
      'Es el corazón del hotel: un living con el fuego encendido y el lago entero del otro lado del vidrio. Acá se desayuna, se espera a que afloje el viento y se termina el día.',

    dondeDormir: 'Dónde dormir',
    dosFormas: 'Dos formas de alojarse',
    dosFormasTexto:
      'La hostería, para quien quiere servicio y vista. Las cabañas, para quien quiere su propia casa.',

    hosteriaEtiqueta: 'Hostería boutique',
    hosteriaTitulo: '15 habitaciones, todas con vista',
    hosteriaTexto:
      'Decoración clásica, bañera de hidromasaje en todas y ventanas al Lago Argentino, la Bahía Redonda y la Isla Solitaria. Desayuno buffet incluido.',
    hosteriaEnlace: 'Ver habitaciones y precios',

    cabanasEtiqueta: 'Cabañas',
    cabanasTitulo: 'Casa propia, hasta 7 personas',
    cabanasTexto:
      'De uno a tres dormitorios, totalmente equipadas, con living, cocina, ropa de cama y hogar parrilla. Para familias y grupos que prefieren la independencia.',
    cabanasEnlace: 'Ver cabañas y precios',

    lavandaEtiqueta: 'Nuestro campo',
    lavandaTitulo: 'Un lavandín en la estepa',
    lavandaTexto1:
      'El hotel tiene su propio campo de lavanda, con el lago de fondo. Florece en verano y se puede recorrer a pie: es el lugar donde casi todos nuestros huéspedes terminan sacando la foto del viaje.',
    lavandaTexto2:
      'Crece en plena estepa patagónica, un lugar donde casi nada florece. Está a treinta pasos de la recepción y no hay otro igual en El Calafate.',
    lavandaFlorece: 'Florece',
    lavandaFloreceValor: 'Diciembre a febrero',
    lavandaDistancia: 'De la recepción',
    lavandaDistanciaValor: '30 pasos',

    gastronomiaEtiqueta: 'Mesa y fuego',
    gastronomiaTitulo: 'Comer con el fuego prendido',
    gastronomiaTexto:
      'El desayuno buffet se sirve frente al ventanal. A la noche, el restaurante de temporada y el bar funcionan junto al hogar: cordero, tablas de la zona y vinos argentinos.',
    gastronomiaLista: [
      'Desayuno buffet incluido, todos los días',
      'Restaurante de temporada y bar',
      'Viandas para llevar a las excursiones (con cargo)',
      'Hogar parrilla en cada cabaña',
    ],

    experienciasEtiqueta: 'Qué hacer desde acá',
    experienciasTitulo: 'El Parque Nacional, a la vuelta',
    experienciasTexto:
      'Coordinamos la excursión y el traslado desde la recepción. Estas son las tres que más nos piden; hay varias decenas más.',
    experienciasPie:
      'También: Big Ice, kayak frente al glaciar, Estancia Cristina, Torres del Paine, cabalgatas, Cerro Frías, pesca y estancias con esquila y asado.',

    incluyeTitulo: 'Qué incluye la tarifa',
    incluyeTexto: 'Sin letra chica: esto entra en el precio y esto se cobra aparte.',
    incluido: 'Incluido',
    conCargo: 'Con cargo',
    horarios: 'Check-in {entrada} · Check-out {salida}. Consultanos por traslados y horarios especiales.',

    comoLlegarEtiqueta: 'Cómo llegar',
    comoLlegarTitulo: 'En el corazón de la Patagonia',
    direccion: 'Charles Furh 149, Barrio Los Guías, El Calafate, Santa Cruz.',
    distancias: 'Distancias',
    distanciaCentro: 'Centro de El Calafate',
    distanciaAeropuerto: 'Aeropuerto (FTE)',
    distanciaGlaciar: 'Glaciar Perito Moreno',
    distanciaChalten: 'El Chaltén',
    contacto: 'Contacto',
    telefono: 'Teléfono',
    email: 'Email',
    horariosEtiqueta: 'Horarios',
    abrirEnMapas: 'Abrir en Google Maps',

    antesDeReservar: 'Antes de reservar',
    loQueConvieneSaber: 'Lo que conviene saber',
    siTenesQueCancelar: 'Si tenés que cancelar',
    cancelarTexto: 'Sin letra chica. Se cuenta según los días de anticipación con los que avises:',
    noShow: 'No presentarse sin avisar se cobra como la estadía completa.',

    cierreTitulo: 'Mirá si hay lugar en tus fechas',
    cierreTexto:
      'Reservando directo pagás lo mismo o menos que en cualquier otro sitio, y hablás con nosotros si necesitás algo.',
    cierreBoton: 'Buscar disponibilidad',
    cierreSecundario: 'Ver alojamientos',

    pieDescripcion:
      'Hostería boutique y cabañas frente al Lago Argentino. Charles Furh 149, B° Los Guías, El Calafate, Santa Cruz, Patagonia Argentina.',
    pieElHotel: 'El hotel',
    pieRedes: 'Redes sociales',
    pieAccesoPersonal: 'Acceso del personal',
  },

  /* ─────────────────────────── por qué reservar ─────────────────────────── */
  ventajas: {
    titulo: 'Reservá directo',
    precioTitulo: 'Mejor precio garantizado',
    precioTexto:
      'Sin comisiones de intermediarios. Mismo precio o mejor que en cualquier otro sitio.',
    confirmacionTitulo: 'Confirmación inmediata',
    confirmacionTexto: 'Recibís tu reserva al instante por email. Sin esperas, sin llamadas.',
    atencionTitulo: 'Atención directa',
    atencionTexto: 'Hablás directo con nosotros para cualquier consulta o pedido especial.',
  },

  /* ─────────────────────────────── buscador ──────────────────────────────── */
  buscador: {
    elegiFechas: 'Elegí las fechas',
    huesped: '1 huésped',
    huespedesN: '{n} huéspedes',
    llegada: 'Llegada',
    salida: 'Salida',
    huespedes: 'Huéspedes',
    buscar: 'Buscar',
    tocaParaCambiar: 'Tocá para cambiar la búsqueda',
    tocaParaCerrar: 'Tocá para cerrar',
    noches: '{n} noches',
    unaNoche: '1 noche',
    personas: '{n} personas',
    unaPersona: '1 persona',
  },

  /* ─────────────────────────────── catálogo ──────────────────────────────── */
  catalogo: {
    metaTitulo: 'Alojamientos',
    metaDescripcion:
      'Habitaciones de hostería con vista al Lago Argentino y cabañas con hogar a leña en El Calafate. Capacidad, comodidades y precios por temporada.',
    filtrar: 'Filtrar por tipo de alojamiento',
    sinCategoria: 'No hay alojamientos de esta categoría por el momento.',
    yaSabes: '¿Ya sabés cuándo viajás?',
    yaSabesTexto:
      'Consultá la disponibilidad real de esas fechas y reservá en línea, sin intermediarios.',
    titulo: 'Nuestros alojamientos',
    descripcion:
      'Hostería boutique frente al Lago Argentino y cabañas a pasos del Parque Nacional Los Glaciares. Mirá las opciones y después elegí las fechas.',
    todos: 'Todos',
    hosteria: 'Hostería',
    cabanas: 'Cabañas',
    desde: 'Desde',
    porNoche: 'por noche, con IVA',
    precioAConfirmar: 'Precio a confirmar',
    verDetalle: 'Ver detalle',
    verDisponibilidad: 'Ver disponibilidad',
    queIncluye: 'Qué incluye',
    todosLosAlojamientos: 'Todos los alojamientos',
    sinResultados: 'No hay alojamientos en esa categoría',
  },

  /* ─────────────────────────────── reservar ──────────────────────────────── */
  reservar: {
    metaTitulo: 'Reservar',
    metaDescripcion:
      'Elegí tus fechas y reservá directo en Blanca Patagonia, El Calafate. Habitaciones con vista al Lago Argentino y cabañas con hogar a leña.',
    unaOpcion: '1 opción',
    variasOpciones: '{n} opciones',
    resumen: '{opciones} para {noches}. Los precios ya incluyen IVA.',
    porUnaNoche: '{monto} por 1 noche, con IVA',
    sinTarifasAviso:
      'Tenemos lugar en esas fechas, pero todavía no publicamos las tarifas del período. Escribinos y te pasamos el precio en el día.',
    sinLugarAviso:
      'No tenemos nada libre para {personas} en esas fechas. Probá corriendo un día, o escribinos: a veces se libera algo.',
    elQueMirabas: 'El que estabas mirando',
    verDetalleDe: 'Ver el detalle de {nombre}',
    consultar: 'Consultar',
    consultaAsunto: 'Consulta de disponibilidad · {nombre}',
    consultaCuerpo: 'Hola, quisiera consultar por {nombre} del {desde} al {hasta} para {n} huésped(es).',
    titulo: 'Reservá tu estadía',
    descripcion:
      'Elegí las fechas y cuántos son. Te mostramos lo que está libre, con el precio final.',
    verTodos: 'Ver todos los alojamientos y sus precios',
    opciones: '{n} opciones para {noches} noches. Los precios ya incluyen IVA.',
    sinOpciones: 'No hay disponibilidad para esas fechas',
    sinOpcionesTexto: 'Probá con otras fechas o con menos huéspedes.',
    fechasInvalidas: 'Esas fechas no son válidas. La llegada tiene que ser hoy o más adelante, y la salida, después de la llegada.',
    verFotos: 'Ver fotos y servicios',
    porNoches: '{monto} por {n} noches, con IVA',
    reservar: 'Reservar',
    quedaUno: 'Queda 1',
    quedanPocos: 'Quedan {n}',
    completo: 'Sin disponibilidad',
  },

  /* ─────────────────────────────── asistente ─────────────────────────────── */
  asistente: {
    aviso: '',
    nombre: 'Asistente de Blanca Patagonia',
    subtitulo: 'Respondemos al instante las consultas frecuentes.',
    saludo:
      '¡Hola! Puedo ayudarte con horarios de check-in y check-out, política de cancelación, servicios de la hostería y disponibilidad. ¿Qué necesitás saber?',
    sugerencia1: '¿A qué hora es el check-in?',
    sugerencia2: '¿Cómo es la política de cancelación?',
    sugerencia3: '¿Qué servicios incluye?',
    campo: 'Escribí tu consulta…',
    campoEtiqueta: 'Tu consulta para el asistente',
    enviar: 'Enviar',
    escribiendo: 'Escribiendo…',
    abrir: '¿Consultas?',
    cerrar: 'Cerrar',
  },

  /* ──────────────────────────────── común ────────────────────────────────── */
  comun: {
    pausarMovimiento: 'Pausar movimiento',
    reanudarMovimiento: 'Reanudar movimiento',
    volver: 'Volver',
    cargando: 'Cargando…',
    hosteriaYCabanas: 'Hostería y cabañas · El Calafate, Santa Cruz',
    checkInOut: 'Check-in {entrada} · Check-out {salida}',
  },

  /* ──────────────────────── contenido de la portada ──────────────────────── */
  contenido: {
    manifiestoDatos: ['Lago Argentino, a la vista', 'Perito Moreno, a 80 km', 'Hogar a leña en el lobby'],
    manifiestoFoto: 'El ventanal del lobby, visto desde la terraza',
    manifiestoSeguir: 'Seguí bajando',
    manifiestoEtiqueta: 'Blanca Patagonia',
    manifiesto:
      'Un lago turquesa del otro lado del vidrio. El glaciar, a una hora de camino. Y el fuego prendido cuando volvés.',
    habitaciones: [
      {
        nombre: 'Standard',
        capacidad: 'Single, doble o triple',
        detalle: 'Camas individuales o matrimonial. Encantadora, con delicados detalles de diseño.',
      },
      {
        nombre: 'Superior',
        capacidad: 'Single o doble',
        detalle: 'Más espacio y la misma vista al lago, la bahía y la Isla Solitaria.',
      },
      {
        nombre: 'Suite Principal',
        capacidad: 'Doble',
        detalle: 'Cama matrimonial, la vista más abierta de la hostería.',
      },
    ],
    cabanas: [
      { nombre: '1 dormitorio', capacidad: '2 o 3 personas' },
      { nombre: '2 dormitorios', capacidad: 'Hasta 5 personas' },
      { nombre: '3 dormitorios', capacidad: 'Hasta 7 personas' },
    ],
    excursiones: [
      {
        nombre: 'Minitrekking sobre el Perito Moreno',
        detalle: 'Caminata con crampones sobre el hielo del glaciar.',
      },
      {
        nombre: 'Todo Glaciares: Upsala y Spegazzini',
        detalle: 'Navegación frente a las paredes de hielo del Brazo Norte.',
      },
      {
        nombre: 'El Chaltén y Lago del Desierto',
        detalle: 'Trekking al Fitz Roy, rafting y la laguna al pie del cerro.',
      },
    ],
    incluido: [
      'Desayuno buffet frente al ventanal',
      'Wi-Fi en todo el hotel',
      'Bañera de hidromasaje (hostería)',
      'Hogar a leña y parrilla (cabañas)',
      'Estacionamiento cubierto',
      'Calefacción central',
      'TV por cable y caja de seguridad',
      'Servicio de mucama diario',
      'Jacuzzi común para 6 personas',
      'Bar',
    ],
    conCargo: [
      'Traslado desde y hacia el aeropuerto',
      'Viandas para excursiones',
      'Lavandería',
      'Bicicletas de montaña',
    ],
    preguntas: [
      {
        p: '¿Cuántas noches conviene quedarse?',
        r: 'Tres como mínimo. El Perito Moreno lleva un día entero, las navegaciones otro, y queda un tercero para El Chaltén o para no hacer nada. Con dos noches se viaja apurado.',
      },
      {
        p: '¿Cuándo es la mejor época?',
        r: 'De octubre a abril está todo abierto y hay más horas de luz; en enero el sol se pone pasadas las diez. En invierno hay menos gente y el glaciar sigue ahí. El viento es parte del lugar todo el año.',
      },
      {
        p: '¿Tienen traslado desde el aeropuerto?',
        r: 'Sí, con cargo y hay que avisarlo antes. El aeropuerto de El Calafate (FTE) está a 23 km, unos 20 minutos.',
      },
      { p: '¿Hay estacionamiento?', r: 'Sí, cubierto y sin cargo para los huéspedes.' },
      {
        p: '¿El desayuno está incluido?',
        r: 'Siempre, en la hostería y en las cabañas. Es buffet y se sirve frente al ventanal del lobby.',
      },
      {
        p: '¿Se puede pagar en pesos?',
        r: 'Sí. Las tarifas se publican en dólares y se cobran en pesos a la cotización del día, o con tarjeta internacional.',
      },
    ],
    alt: {
      ventanal:
        'Lobby de la hostería con ventanal al Lago Argentino al atardecer y hogar a leña encendido',
      hosteria: 'Suite de la hostería con bañera de hidromasaje, hogar a leña y pared de piedra',
      cabana: 'Living de cabaña con hogar de piedra a leña y ventana al Lago Argentino',
      galeria: [
        'Habitación superior con ventanal al lago',
        'Detalle de cama con pared de piedra',
        'Cocina y comedor de cabaña',
        'Dormitorio de cabaña',
      ],
      lavandaCampo: 'Campo de lavanda del hotel con el Lago Argentino de fondo',
      lavandaCanasto: 'Canasto con lavanda recién cortada',
      lavandaDetalle: 'Detalle de las flores de lavanda',
      cena: 'Mesa servida junto al hogar a leña',
      picada: 'Tabla de quesos y fiambres con vino frente al fuego',
      entorno: 'El hotel y su entorno, sobre El Calafate',
    },
  },

  /* ─────────────────────────── ficha de alojamiento ───────────────────────── */
  ficha: {
    temporadas: { baja: 'Temporada baja', media: 'Temporada media', alta: 'Temporada alta' },
    vigenteHasta: '{temporada} · hasta el {fecha}',
    proximaDesde: '{temporada} · a partir del {fecha}',
    impuestos: 'Impuestos incluidos',
    porNocheCorto: '/ noche',
    verTarifas: 'Ver tarifas y disponibilidad',
    verDetalles: 'Ver detalles del alojamiento',
    fotoAnterior: 'Foto anterior',
    fotoSiguiente: 'Foto siguiente',
    fotoN: 'Foto {n} de {total}',
    galeriaNota: 'La primera foto es de este alojamiento; las demás, de otros de la misma categoría.',
    comodidades: 'Comodidades',
    precioSegunFechas: 'El precio final depende de las fechas que elijas.',
    noEncontrado: 'Alojamiento no encontrado',
    metaDescripcion: '{categoria} para {capacidad} en El Calafate.',
    sinTarifas: 'Todavía no publicamos las tarifas de este alojamiento.',
    porNocheIvaIncluido: 'por noche, con IVA incluido',
    preciosTitulo: 'Precios por temporada',
    preciosDescripcion:
      'Valor por noche en dólares con IVA incluido. La temporada la define la fecha de cada noche.',
    preciosLeyenda: 'Precio por noche de {nombre} en cada temporada, con las fechas que abarca',
    temporada: 'Temporada',
    fechas: 'Fechas',
    porNoche: 'Por noche',
    aConfirmar: 'a confirmar',
    rango: '{desde} al {hasta}',
    horarios: 'Horarios',
    horariosValor: 'Check-in desde las {entrada} · Check-out hasta las {salida}',
    mascotas: 'Mascotas',
    conMascotas: 'Se admiten mascotas.',
    sinMascotas: 'No se admiten mascotas.',
    cancelacion: 'Cancelación',
    cancelacionTexto:
      'Sin cargo cancelando con más de 14 días de anticipación. Entre 14 y 7 días se cobra la primera noche, y dentro de los 7 días el total de la estadía.',
    otrasOpciones: 'Otras opciones: {categoria}',
  },

  /* ──────────────────────── categorías y capacidad ───────────────────────── */
  categorias: {
    hosteria: 'Hostería boutique',
    cabana: 'Cabaña',
    capacidadUna: '1 persona',
    capacidadVarias: 'hasta {n} personas',
    ultimaLibre: 'Última libre en estas fechas',
  },

  /* ──────────────────────────────── checkout ──────────────────────────────── */
  checkout: {
    campoObligatorio: 'Este dato es obligatorio',
    tarjetasAceptadas: 'Tarjetas aceptadas',
    resumenTitulo: 'Resumen de tu estadía',
    nocheDel: 'Noche del {fecha}',
    subtotal: 'Subtotal',
    iva: 'IVA',
    seniaAhora: 'Seña a pagar ahora',
    saldoRestante: 'Saldo restante',
    pagoTitulo: 'Forma de pago',
    pagoTexto:
      'Elegí cómo pagar la seña. Te llevamos a la página segura de la pasarela para cargar la tarjeta: nosotros nunca vemos ni guardamos sus datos.',
    pagarDespues: 'Reservar ahora y pagar después',
    pagarDespuesDetalle:
      'Te mandamos por correo el enlace para pagar la seña. La reserva se mantiene {dias} días.',
    alCambio: '{usd} al cambio de {tasa} por dólar',
    medioStripe: 'Tarjeta internacional',
    medioStripeDetalle: 'Para huéspedes del exterior. Se cobra en dólares, sin conversión.',
    medioMercadoPago: 'MercadoPago y medios locales',
    medioMercadoPagoDetalle: 'Para pagar en pesos argentinos, con o sin cuotas.',
    formasMercadoPago: ['Tarjeta de crédito', 'Tarjeta de débito', 'Dinero en MercadoPago', 'Efectivo (Rapipago y Pago Fácil)'],
    medioSimulado: 'Pago simulado (demostración)',
    medioSimuladoDetalle: 'No mueve dinero. Sirve para probar el circuito completo de cobro.',
    sinMedios: 'El pago en línea no está disponible en este momento. Reservá y te escribimos para coordinar la seña.',
    pedidoEspecial: 'Pedido especial',
    pedidoAyuda: 'Opcional: hora de llegada, una cuna, una celebración… Lo lee recepción antes de que llegues.',
    promociones:
      'Quiero recibir novedades y promociones del hotel por correo. Me puedo dar de baja cuando quiera.',
    condiciones: 'Acepto las condiciones de la reserva y la política de cancelación.',
    errorCondiciones: 'Para reservar tenés que aceptar las condiciones.',
    errorMedio: 'Elegí una forma de pago.',
    confirmarYPagar: 'Confirmar y pagar la seña',
    redirigiendo: 'Abriendo el pago seguro…',
    pagoSeguro: 'Pago seguro. Nunca guardamos los datos de tu tarjeta.',
    titulo: 'Casi listo',
    descripcion: 'Revisá que esté todo bien y dejanos cómo contactarte.',
    volverOpciones: 'Volver a las opciones',
    desdeLas: 'desde las {hora}',
    hastaLas: 'hasta las {hora}',
    total: 'Total',
    ivaIncluido: 'IVA incluido',
    senia: 'Seña para tomar la reserva',
    seniaNota: '(equivale a la primera noche)',
    tusDatos: 'Tus datos',
    apellido: 'Apellido',
    nombre: 'Nombre',
    email: 'Email',
    emailAyuda: 'Acá te mandamos la confirmación con el código de tu reserva.',
    telefono: 'Teléfono',
    telefonoAyuda: 'Opcional. Sirve para avisarte si surge algo con tu llegada.',
    confirmar: 'Confirmar la reserva',
    reservando: 'Reservando…',
    nadaAhora:
      'No se te cobra nada ahora. La reserva queda tomada y te escribimos para coordinar la seña, que equivale a la primera noche.',
    requerido: 'obligatorio',
    errorIncompleto: 'Datos de la reserva incompletos.',
    errorApellidoEmail: 'Ingresá tu apellido y tu email.',
    errorEmail: 'Ingresá un email válido.',
    errorNombre: 'Revisá el nombre y el apellido: sin enlaces ni símbolos, hasta 80 letras.',
    errorTelefono: 'Revisá el teléfono: sólo números y los signos + ( ) -.',
    errorFechas: 'Las fechas no son válidas: la llegada tiene que ser hoy o más adelante, y antes de la salida.',
    errorMaxNoches: 'La estadía no puede superar las {n} noches.',
    errorCapacidad: 'Este alojamiento admite hasta {n} personas.',
    errorNoExiste: 'Ese alojamiento no existe.',
    errorNoDisponible: 'La unidad ya no está disponible para esas fechas.',
    errorLimite:
      'Recibimos varios envíos desde tu conexión. Probá de nuevo en unos minutos, o escribinos y lo resolvemos por teléfono.',
    errorGenerico:
      'No pudimos completar la reserva. Volvé a intentar en un momento o escribinos y la cerramos por correo.',
  },

  /* ───────────────────────── política de cancelación ──────────────────────── */
  cancelacion: {
    primera: 'Con {n} días o más de anticipación: {cargo}.',
    entre: 'Entre {desde} y {hasta} días antes: {cargo}.',
    menos: 'Con menos de {n} días: {cargo}.',
    ninguno: 'sin cargo',
    primera_noche: 'se cobra la primera noche',
    total: 'se cobra el 100 % de la estadía',
  },

  /* ────────────────── comodidades reconocidas del catálogo ───────────────── */
  comodidades: {
    vista: 'Vista al Lago Argentino',
    hidromasaje: 'Bañera de hidromasaje',
    desayuno: 'Desayuno buffet incluido',
    wifi: 'Wi-Fi',
    hogar: 'Hogar a leña y parrilla',
    cocina: 'Cocina equipada',
    calefaccion: 'Calefacción central',
    tv: 'TV por cable',
    estacionamiento: 'Estacionamiento cubierto',
    caja: 'Caja de seguridad',
  },

  /* ─────────────────────────── pasos de la reserva ────────────────────────── */
  confirmacion: {
    titulo: 'Te esperamos',
    meta: 'Tu reserva',
    listo: 'Listo.',
    listoConNombre: 'Listo, {nombre}.',
    guardaCodigo: 'Guardá este código, es el que te van a pedir al llegar.',
    alojamiento: 'Alojamiento',
    llegada: 'Llegada',
    salida: 'Salida',
    noches: 'Noches',
    total: 'Total',
    pagado: 'Pagado',
    saldo: 'Saldo',
    saldoAAbonar: 'Saldo a abonar',
    seniaAAbonar: 'Seña a abonar',
    desdeLas: '{fecha} · desde las {hora}',
    hastaLas: '{fecha} · hasta las {hora}',
    pagoFallo: 'Tu reserva quedó tomada, pero no pudimos abrir el pago. Podés pagar la seña desde acá, con el mismo u otro medio.',
    verFactura: 'Ver mi factura',
    volverInicio: 'Volver al inicio',
    reservarOtra: 'Reservar otra estadía',
    favoritos: 'Guardá esta página en favoritos: podés volver a abrirla cuando quieras con el mismo enlace.',
    sinCalculo: 'No pudimos calcular el saldo en este momento. Escribinos y lo revisamos con vos.',
    todoPagoTitulo: 'Está todo pago.',
    todoPagoTexto: 'No tenés que hacer nada más; te esperamos el día de la llegada.',
    saldoPendienteTitulo: 'Queda un saldo pendiente.',
    saldoPendienteTexto: 'Podés abonarlo ahora o al llegar al hotel.',
    sinConfirmarTitulo: 'La reserva todavía no está confirmada.',
    sinConfirmarTexto: 'Queda tomada por {dias} días; para asegurarla hay que abonar la seña.',
    pagarSaldo: 'Pagar el saldo',
    pagarSenia: 'Pagar la seña',
    errorLecturaTitulo: 'No pudimos cargar tu reserva',
    errorLecturaTexto: 'Tu reserva está registrada. Fue un problema momentáneo al mostrarla: probá de nuevo en unos segundos.',
    reintentar: 'Volver a intentar',
  },
  pago: {
    meta: 'Pagar mi reserva',
    tituloSenia: 'Pagá la seña',
    tituloSaldo: 'Pagá el saldo',
    descripcion: 'Reserva {codigo}. Elegí cómo querés pagar.',
    miReserva: 'Mi reserva',
    verMiReserva: 'Ver mi reserva',
    totalEstadia: 'Total de la estadía',
    yaPagaste: 'Ya pagaste',
    seniaAhora: 'Seña a pagar ahora',
    saldoAhora: 'Saldo a pagar ahora',
    noDisponibleTitulo: 'El pago en línea no está disponible.',
    noDisponibleTexto: 'Escribinos y coordinamos la transferencia o el pago al llegar.',
    nota: 'El pago lo procesa la pasarela, no el hotel. Blanca Patagonia nunca guarda el número de tu tarjeta.',
    sinCalculoTitulo: 'No pudimos calcular tu saldo',
    sinCalculoTexto: 'Es un problema nuestro, no tuyo. Probá de nuevo en un minuto o escribinos y lo resolvemos por teléfono.',
    todoPagoTitulo: 'Ya está todo pago',
    nadaQuePagarTitulo: 'No hay nada para pagar acá',
    cancelada: 'La reserva está cancelada.',
    sinSaldo: 'La reserva no tiene saldo pendiente.',
    errorNoEncontrada: 'No encontramos esa reserva. Revisá el enlace que te enviamos.',
    errorLimite: 'Recibimos varios intentos de pago seguidos. Esperá unos minutos y probá de nuevo, o escribinos.',
    errorSinDatos: 'No pudimos calcular el saldo en este momento. Probá de nuevo en un minuto.',
    errorNoCobrable: 'Esta reserva no tiene un saldo que se pueda pagar en línea.',
    errorPasarela: 'No pudimos abrir el medio de pago. Probá con otro, o escribinos y lo resolvemos por teléfono.',
    errorGenerico: 'No pudimos completar la operación. Probá de nuevo.',
  },
  pasos: {
    fechas: 'Fechas',
    alojamiento: 'Alojamiento',
    datos: 'Tus datos',
    confirmacion: 'Confirmación',
    paso: 'Paso {n} de {total}',
    progreso: 'Progreso de la reserva',
  },
}

/**
 * La forma que tienen que cumplir los otros idiomas.
 *
 * ⚠️ **Sin `as const`**, y es deliberado. Con `as const` cada valor queda
 * tipado como su literal —`'Inicio'` en vez de `string`—, así que el tipo
 * exigiría que el diccionario inglés también dijera `'Inicio'`: ninguna
 * traducción compilaría. Sin él, TypeScript infiere `string` para los valores
 * y conserva las **claves** exactas, que es justamente el control que se
 * busca: olvidarse de traducir algo no compila.
 */
export type Diccionario = typeof es
