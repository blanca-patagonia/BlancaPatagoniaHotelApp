import type { Diccionario } from './es'

/**
 * Diccionario en inglés.
 *
 * Traducción del `es.ts`, con las mismas claves. Decisiones tomadas acá:
 *
 * - **Nombres propios sin traducir**: «Lago Argentino», «Bahía Redonda»,
 *   «Isla Solitaria», «Cerro Frías», «Estancia Cristina», «Charles Furh»,
 *   «Barrio Los Guías». Un «Argentine Lake» no lo encuentra nadie que busque el
 *   lugar, y es justamente lo que se quiere del buscador. Única excepción
 *   aceptada: «Parque Nacional Los Glaciares» → «Los Glaciares National Park»,
 *   que es la forma con la que el parque se publica en inglés, y «Glaciar
 *   Perito Moreno» → «Perito Moreno Glacier», donde el nombre propio se
 *   conserva y sólo se traduce el sustantivo común.
 * - **«Hostería» → «inn»**, no «hostel»: un hostel en inglés es un albergue
 *   con camas compartidas y bajarle la categoría al hotel en la traducción le
 *   costaría reservas. Se mantiene «boutique inn» para los cuatro estrellas.
 * - **Registro**: el español es rioplatense e informal (voseo). En inglés eso
 *   no tiene equivalente, así que se usa un tono cálido pero correcto, de hotel
 *   boutique: segunda persona directa, sin jerga y con pocas contracciones.
 * - **Ortografía**: inglés internacional, alineado con el `en-US` de
 *   `ETIQUETA_BCP47` cuando las dos variantes difieren («center»).
 * - **Plata, literal**: «con IVA» → «VAT included», «sin cargo» → «free of
 *   charge», «con cargo» → «at extra cost». No se agregan condiciones que el
 *   original no diga ni se suavizan las que sí dice (el no-show se cobra
 *   entero). La política de cancelación la arma la aplicación con los días; acá
 *   sólo va el texto que la introduce.
 * - **Marcadores de posición** (`{n}`, `{noches}`, `{monto}`, `{entrada}`,
 *   `{salida}`) tal cual y en la posición que el inglés les da naturalmente.
 */
export const en: Diccionario = {
  /* ─────────────────────────────── navegación ─────────────────────────────── */
  nav: {
    idioma: 'Language',
    volverArriba: 'Back to top',
    navegacion: 'Main navigation',
    inicio: 'Home',
    alojamientos: 'Accommodation',
    experiencias: 'Experiences',
    ubicacion: 'Location',
    reservar: 'Book now',
    conocerMas: 'Learn more',
    cambiarIdioma: 'Change language',
    irAlContenido: 'Skip to content',
  },

  /* ──────────────────────────────── portada ──────────────────────────────── */
  portada: {
    lugar: 'El Calafate · Argentine Patagonia',
    titulo: 'Overlooking Lago Argentino',
    bajada:
      'A boutique inn with 15 rooms, all with a view and a whirlpool bath, and cabins with wood-burning fireplaces. Steps from Los Glaciares National Park.',
    sinFechas: 'No dates yet — browse the accommodation',

    presentacionEtiqueta: 'A different kind of place in El Calafate',
    presentacionTitulo: 'Here, everything faces the same way',
    presentacionTexto:
      'Blanca Patagonia is a four-star boutique inn with cabins, set on high ground in El Calafate. The lobby has a large window looking out over Lago Argentino, Bahía Redonda and Isla Solitaria, and it is where the buffet breakfast is served every morning.',

    cifraHabitaciones: 'rooms',
    cifraHabitacionesPie: 'All with a lake view',
    cifraCategoria: 'stars',
    cifraCategoriaPie: 'Boutique inn',
    cifraPersonas: 'guests',
    cifraPersonasPie: 'In the largest cabin',
    cifraDistancia: 'to Perito Moreno',
    cifraDistanciaPie: 'About a two-hour drive',

    ventanalTitulo: 'The big window',
    ventanalTexto:
      'It is the heart of the hotel: a lounge with the fire lit and the whole lake on the other side of the glass. This is where you have breakfast, wait for the wind to ease and end the day.',

    dondeDormir: 'Where to stay',
    dosFormas: 'Two ways to stay',
    dosFormasTexto:
      'The inn, for those who want service and a view. The cabins, for those who want a place of their own.',

    hosteriaEtiqueta: 'Boutique inn',
    hosteriaTitulo: '15 rooms, every one with a view',
    hosteriaTexto:
      'Classic decor, a whirlpool bath in every room and windows onto Lago Argentino, Bahía Redonda and Isla Solitaria. Buffet breakfast included.',
    hosteriaEnlace: 'See rooms and rates',

    cabanasEtiqueta: 'Cabins',
    cabanasTitulo: 'A place of your own, for up to 7 guests',
    cabanasTexto:
      'One to three bedrooms, fully equipped, with a living room, kitchen, bed linen and a fireplace grill. For families and groups who prefer their independence.',
    cabanasEnlace: 'See cabins and rates',

    lavandaEtiqueta: 'Our field',
    lavandaTitulo: 'A lavender field on the steppe',
    lavandaTexto1:
      'The hotel has its own lavender field, with the lake behind it. It blooms in summer and you can walk through it: this is where almost all of our guests end up taking the photograph of their trip.',
    lavandaTexto2:
      'It grows in the middle of the Patagonian steppe, a place where almost nothing blooms. It is thirty steps from reception and there is no other like it in El Calafate.',
    lavandaFlorece: 'In bloom',
    lavandaFloreceValor: 'December to February',
    lavandaDistancia: 'From reception',
    lavandaDistanciaValor: '30 steps',

    gastronomiaEtiqueta: 'Table and fire',
    gastronomiaTitulo: 'Dining with the fire lit',
    gastronomiaTexto:
      'The buffet breakfast is served in front of the big window. In the evening, the seasonal restaurant and the bar open beside the fireplace: lamb, local platters and Argentine wines.',
    gastronomiaLista: [
      'Buffet breakfast included, every day',
      'Seasonal restaurant and bar',
      'Packed meals to take on excursions (at extra cost)',
      'Fireplace grill in every cabin',
    ],

    experienciasEtiqueta: 'What to do from here',
    experienciasTitulo: 'The National Park, just around the corner',
    experienciasTexto:
      'We arrange the excursion and the transfer from reception. These are the three we are asked for most; there are several dozen more.',
    experienciasPie:
      'Also: Big Ice, kayaking in front of the glacier, Estancia Cristina, Torres del Paine, horseback riding, Cerro Frías, fishing and ranch days with sheep shearing and asado.',

    incluyeTitulo: 'What the rate includes',
    incluyeTexto: 'No fine print: this is in the price and this is charged separately.',
    incluido: 'Included',
    conCargo: 'At extra cost',
    horarios:
      'Check-in {entrada} · Check-out {salida}. Ask us about transfers and special times.',

    comoLlegarEtiqueta: 'Getting here',
    comoLlegarTitulo: 'In the heart of Patagonia',
    direccion: 'Charles Furh 149, Barrio Los Guías, El Calafate, Santa Cruz.',
    distancias: 'Distances',
    distanciaCentro: 'El Calafate town center',
    distanciaAeropuerto: 'Airport (FTE)',
    distanciaGlaciar: 'Perito Moreno Glacier',
    distanciaChalten: 'El Chaltén',
    contacto: 'Contact',
    telefono: 'Phone',
    email: 'Email',
    horariosEtiqueta: 'Hours',
    abrirEnMapas: 'Open in Google Maps',

    antesDeReservar: 'Before you book',
    loQueConvieneSaber: 'What is worth knowing',
    siTenesQueCancelar: 'If you need to cancel',
    cancelarTexto:
      'No fine print. It is counted by how many days in advance you let us know:',
    noShow: 'Not showing up without notice is charged as the full stay.',

    cierreTitulo: 'See if there is room on your dates',
    cierreTexto:
      'Booking direct, you pay the same or less than on any other site, and you talk to us if you need anything.',
    cierreBoton: 'Check availability',
    cierreSecundario: 'See accommodation',

    pieDescripcion:
      'Boutique inn and cabins overlooking Lago Argentino. Charles Furh 149, B° Los Guías, El Calafate, Santa Cruz, Argentine Patagonia.',
    pieElHotel: 'The hotel',
    pieRedes: 'Social media',
    pieAccesoPersonal: 'Staff access',
  },

  /* ─────────────────────────── por qué reservar ─────────────────────────── */
  ventajas: {
    titulo: 'Book direct',
    precioTitulo: 'Best price guaranteed',
    precioTexto:
      'No intermediary commissions. The same price or better than on any other site.',
    confirmacionTitulo: 'Immediate confirmation',
    confirmacionTexto:
      'You receive your booking by email right away. No waiting, no phone calls.',
    atencionTitulo: 'Direct service',
    atencionTexto: 'You speak with us directly for any question or special request.',
  },

  /* ─────────────────────────────── buscador ──────────────────────────────── */
  buscador: {
    elegiFechas: 'Choose your dates',
    huesped: '1 guest',
    huespedesN: '{n} guests',
    llegada: 'Arrival',
    salida: 'Departure',
    huespedes: 'Guests',
    buscar: 'Search',
    tocaParaCambiar: 'Tap to change the search',
    tocaParaCerrar: 'Tap to close',
    noches: '{n} nights',
    unaNoche: '1 night',
    personas: '{n} guests',
    unaPersona: '1 guest',
  },

  /* ─────────────────────────────── catálogo ──────────────────────────────── */
  catalogo: {
    metaTitulo: 'Accommodation',
    metaDescripcion:
      'Inn rooms overlooking Lago Argentino and wood-fire cabins in El Calafate. Capacity, amenities and seasonal rates.',
    filtrar: 'Filter by accommodation type',
    sinCategoria: 'There is no accommodation in this category at the moment.',
    yaSabes: 'Already know when you are travelling?',
    yaSabesTexto: 'Check live availability for your dates and book online, with no middlemen.',
    titulo: 'Our accommodation',
    descripcion:
      'A boutique inn overlooking Lago Argentino and cabins steps from Los Glaciares National Park. Look through the options and then choose your dates.',
    todos: 'All',
    hosteria: 'Inn',
    cabanas: 'Cabins',
    desde: 'From',
    porNoche: 'per night, VAT included',
    precioAConfirmar: 'Price to be confirmed',
    verDetalle: 'See details',
    verDisponibilidad: 'See availability',
    queIncluye: 'What it includes',
    todosLosAlojamientos: 'All accommodation',
    sinResultados: 'There is no accommodation in that category',
  },

  /* ─────────────────────────────── reservar ──────────────────────────────── */
  reservar: {
    metaTitulo: 'Book',
    metaDescripcion:
      'Choose your dates and book direct at Blanca Patagonia, El Calafate. Rooms overlooking Lago Argentino and cabins with a wood fire.',
    unaOpcion: '1 option',
    variasOpciones: '{n} options',
    resumen: '{opciones} for {noches}. Prices already include VAT.',
    porUnaNoche: '{monto} for 1 night, VAT included',
    sinTarifasAviso:
      'We have availability on those dates, but rates for that period are not published yet. Write to us and we will send you the price the same day.',
    sinLugarAviso:
      'We have nothing free for {personas} on those dates. Try shifting by a day, or write to us: sometimes something opens up.',
    elQueMirabas: 'The one you were looking at',
    verDetalleDe: 'See details of {nombre}',
    consultar: 'Enquire',
    consultaAsunto: 'Availability enquiry · {nombre}',
    consultaCuerpo: 'Hello, I would like to ask about {nombre} from {desde} to {hasta} for {n} guest(s).',
    titulo: 'Book your stay',
    descripcion:
      'Choose your dates and how many of you there are. We show you what is available, with the final price.',
    verTodos: 'See all accommodation and rates',
    opciones: '{n} options for {noches} nights. Prices already include VAT.',
    sinOpciones: 'No availability for those dates',
    sinOpcionesTexto: 'Try other dates or fewer guests.',
    fechasInvalidas: 'Those dates are not valid. Arrival must be today or later, and departure after arrival.',
    verFotos: 'See photos and services',
    porNoches: '{monto} for {n} nights, VAT included',
    reservar: 'Book',
    quedaUno: '1 left',
    quedanPocos: '{n} left',
    completo: 'No availability',
  },

  /* ─────────────────────────────── asistente ─────────────────────────────── */
  asistente: {
    aviso: 'The assistant answers in Spanish. For anything else, write to us in English.',
    nombre: 'Blanca Patagonia assistant',
    subtitulo: 'We answer frequent questions right away.',
    saludo:
      'Hello! I can help you with check-in and check-out times, the cancellation policy, services at the inn and availability. What would you like to know?',
    sugerencia1: 'What time is check-in?',
    sugerencia2: 'What is the cancellation policy?',
    sugerencia3: 'Which services are included?',
    campo: 'Write your question…',
    campoEtiqueta: 'Your question for the assistant',
    enviar: 'Send',
    escribiendo: 'Typing…',
    abrir: 'Questions?',
    cerrar: 'Close',
    recepcionBoton: 'Talk to the front desk',
    recepcionTitulo: 'Front desk',
    recepcionIntro: 'Leave your name and email and we will reply here. If you close the page, the reply will also reach you by email.',
    recepcionNombre: 'Your name',
    recepcionEmail: 'Your email',
    recepcionMensaje: 'Your message',
    recepcionIniciar: 'Send to the front desk',
    recepcionEsperando: 'We got your message. Someone from the front desk will reply here.',
    recepcionVolver: 'Back to the assistant',
    recepcionError: 'We could not send your message. Please try again in a moment.',
    recepcionLimite: 'You sent many messages in a row. Please wait a few minutes.',
    recepcionTu: 'You',
    recepcionHotel: 'Front desk',
  },

  /* ──────────────────────────────── común ────────────────────────────────── */
  comun: {
    pausarMovimiento: 'Pause motion',
    reanudarMovimiento: 'Resume motion',
    volver: 'Back',
    cargando: 'Loading…',
    hosteriaYCabanas: 'Inn and cabins · El Calafate, Santa Cruz',
    checkInOut: 'Check-in {entrada} · Check-out {salida}',
  },

  /* ──────────────────────── contenido de la portada ──────────────────────── */
  contenido: {
    manifiestoDatos: ['Lago Argentino, in full view', 'Perito Moreno, 80 km away', 'Wood fire in the lobby'],
    manifiestoFoto: 'The lobby picture window, seen from the terrace',
    manifiestoSeguir: 'Keep scrolling',
    manifiestoEtiqueta: 'Blanca Patagonia',
    manifiesto:
      'A turquoise lake on the other side of the glass. The glacier, an hour away. And the fire lit when you get back.',
    habitaciones: [
      {
        nombre: 'Standard',
        capacidad: 'Single, double or triple',
        detalle: 'Twin or double beds. Charming, with delicate design touches.',
      },
      {
        nombre: 'Superior',
        capacidad: 'Single or double',
        detalle: 'More space and the same view of the lake, the bay and Isla Solitaria.',
      },
      {
        nombre: 'Main Suite',
        capacidad: 'Double',
        detalle: 'Double bed and the widest view in the inn.',
      },
    ],
    cabanas: [
      { nombre: '1 bedroom', capacidad: '2 or 3 people' },
      { nombre: '2 bedrooms', capacidad: 'Up to 5 people' },
      { nombre: '3 bedrooms', capacidad: 'Up to 7 people' },
    ],
    excursiones: [
      {
        nombre: 'Mini-trekking on Perito Moreno',
        detalle: 'A walk with crampons on the glacier ice.',
      },
      {
        nombre: 'All Glaciers: Upsala and Spegazzini',
        detalle: 'Sailing past the ice walls of the North Arm.',
      },
      {
        nombre: 'El Chaltén and Lago del Desierto',
        detalle: 'Trekking to Fitz Roy, rafting and the lagoon at the foot of the mountain.',
      },
    ],
    incluido: [
      'Buffet breakfast by the picture window',
      'Wi-Fi throughout the hotel',
      'Whirlpool bath (inn)',
      'Wood fireplace and grill (cabins)',
      'Covered parking',
      'Central heating',
      'Cable TV and safe',
      'Daily housekeeping',
      'Shared jacuzzi for 6 people',
      'Bar',
    ],
    conCargo: [
      'Airport transfers',
      'Packed lunches for excursions',
      'Laundry',
      'Mountain bikes',
    ],
    preguntas: [
      {
        p: 'How many nights should I stay?',
        r: 'Three at least. Perito Moreno takes a full day, the boat trips another, and that leaves a third for El Chaltén or for doing nothing. With two nights you travel in a rush.',
      },
      {
        p: 'When is the best time to come?',
        r: 'From October to April everything is open and the days are longer; in January the sun sets after ten. In winter there are fewer people and the glacier is still there. The wind is part of the place all year round.',
      },
      {
        p: 'Do you offer airport transfers?',
        r: 'Yes, at an extra cost and booked in advance. El Calafate airport (FTE) is 23 km away, about 20 minutes.',
      },
      { p: 'Is there parking?', r: 'Yes, covered and free for guests.' },
      {
        p: 'Is breakfast included?',
        r: 'Always, in the inn and in the cabins. It is a buffet served by the lobby picture window.',
      },
      {
        p: 'Can I pay in Argentine pesos?',
        r: 'Yes. Rates are published in US dollars and charged in pesos at the day’s exchange rate, or by international card.',
      },
    ],
    alt: {
      ventanal: 'Inn lobby with a picture window onto Lago Argentino at sunset and a lit wood fire',
      hosteria: 'Inn suite with whirlpool bath, wood fireplace and stone wall',
      cabana: 'Cabin living room with a stone wood fireplace and a window onto Lago Argentino',
      galeria: [
        'Superior room with a picture window onto the lake',
        'Bed detail against a stone wall',
        'Cabin kitchen and dining area',
        'Cabin bedroom',
      ],
      lavandaCampo: 'The hotel’s lavender field with Lago Argentino in the background',
      lavandaCanasto: 'Basket of freshly cut lavender',
      lavandaDetalle: 'Close-up of lavender flowers',
      cena: 'Table set beside the wood fire',
      picada: 'Cheese and charcuterie board with wine by the fire',
      entorno: 'The hotel and its surroundings, above El Calafate',
    },
  },

  /* ─────────────────────────── ficha de alojamiento ───────────────────────── */
  ficha: {
    temporadas: { baja: 'Low season', media: 'Mid season', alta: 'High season' },
    vigenteHasta: '{temporada} · until {fecha}',
    proximaDesde: '{temporada} · from {fecha}',
    impuestos: 'Including taxes',
    porNocheCorto: '/ night',
    verTarifas: 'View rates & availability',
    verDetalles: 'View accommodation details',
    fotoAnterior: 'Previous photo',
    fotoSiguiente: 'Next photo',
    fotoN: 'Photo {n} of {total}',
    galeriaNota: 'The first photo shows this accommodation; the others, similar ones in the same category.',
    comodidades: 'Amenities',
    precioSegunFechas: 'The final price depends on the dates you choose.',
    noEncontrado: 'Accommodation not found',
    metaDescripcion: '{categoria} for {capacidad} in El Calafate.',
    sinTarifas: 'We have not published the rates for this accommodation yet.',
    porNocheIvaIncluido: 'per night, VAT included',
    preciosTitulo: 'Rates by season',
    preciosDescripcion:
      'Price per night in US dollars, VAT included. The season is set by the date of each night.',
    preciosLeyenda: 'Price per night of {nombre} in each season, with the dates it covers',
    temporada: 'Season',
    fechas: 'Dates',
    porNoche: 'Per night',
    aConfirmar: 'to be confirmed',
    rango: '{desde} to {hasta}',
    horarios: 'Times',
    horariosValor: 'Check-in from {entrada} · Check-out until {salida}',
    mascotas: 'Pets',
    conMascotas: 'Pets are welcome.',
    sinMascotas: 'Pets are not allowed.',
    cancelacion: 'Cancellation',
    cancelacionTexto:
      'Free of charge if you cancel more than 14 days ahead. Between 14 and 7 days the first night is charged, and within 7 days the full stay.',
    otrasOpciones: 'Other options: {categoria}',
  },

  /* ──────────────────────── categorías y capacidad ───────────────────────── */
  categorias: {
    hosteria: 'Boutique inn',
    cabana: 'Cabin',
    capacidadUna: '1 person',
    capacidadVarias: 'up to {n} people',
    ultimaLibre: 'Last one left for these dates',
  },

  /* ──────────────────────────────── checkout ──────────────────────────────── */
  checkout: {
    campoObligatorio: 'This field is required',
    tarjetasAceptadas: 'Cards accepted',
    resumenTitulo: 'Stay summary',
    nocheDel: 'Night of {fecha}',
    subtotal: 'Subtotal',
    iva: 'VAT',
    seniaAhora: 'Deposit due now',
    saldoRestante: 'Remaining balance',
    pagoTitulo: 'Payment',
    pagoTexto:
      'Choose how to pay the deposit. We take you to the payment provider’s secure page to enter your card: we never see or store its details.',
    pagarDespues: 'Book now, pay later',
    pagarDespuesDetalle:
      'We will email you a link to pay the deposit. The booking is held for {dias} days.',
    alCambio: '{usd} at {tasa} per US dollar',
    medioStripe: 'International card',
    medioStripeDetalle: 'For guests from abroad. Charged in US dollars, no conversion.',
    medioMercadoPago: 'MercadoPago and local methods',
    medioMercadoPagoDetalle: 'To pay in Argentine pesos, with or without instalments.',
    formasMercadoPago: ['Credit card', 'Debit card', 'MercadoPago balance', 'Cash (Rapipago and Pago Fácil)'],
    medioSimulado: 'Simulated payment (demo)',
    medioSimuladoDetalle: 'Moves no money. Used to test the full payment flow.',
    sinMedios: 'Online payment is not available right now. Book and we will write to arrange the deposit.',
    pedidoEspecial: 'Special request',
    pedidoAyuda: 'Optional: arrival time, a cot, a celebration… Reception reads it before you arrive.',
    promociones:
      'I would like to receive news and offers from the hotel by email. I can unsubscribe at any time.',
    condiciones: 'I accept the booking conditions and the cancellation policy.',
    errorCondiciones: 'To book you need to accept the conditions.',
    errorMedio: 'Choose a payment method.',
    confirmarYPagar: 'Confirm and pay deposit',
    redirigiendo: 'Opening secure payment…',
    pagoSeguro: 'Secure payment. We never store your card details.',
    titulo: 'Almost done',
    descripcion: 'Check that everything is right and tell us how to reach you.',
    volverOpciones: 'Back to the options',
    desdeLas: 'from {hora}',
    hastaLas: 'until {hora}',
    total: 'Total',
    ivaIncluido: 'VAT included',
    senia: 'Deposit to hold the booking',
    seniaNota: '(equal to the first night)',
    tusDatos: 'Your details',
    apellido: 'Last name',
    nombre: 'First name',
    email: 'Email',
    emailAyuda: 'We will send the confirmation with your booking code here.',
    telefono: 'Phone',
    telefonoAyuda: 'Optional. Useful if something comes up with your arrival.',
    confirmar: 'Confirm booking',
    reservando: 'Booking…',
    nadaAhora:
      'Nothing is charged now. The booking is held and we will write to you to arrange the deposit, which equals the first night.',
    requerido: 'required',
    errorIncompleto: 'The booking details are incomplete.',
    errorApellidoEmail: 'Please enter your last name and your email.',
    errorEmail: 'Please enter a valid email.',
    errorNombre: 'Please check your name: no links or symbols, up to 80 letters.',
    errorTelefono: 'Please check your phone number: digits and + ( ) - only.',
    errorFechas: 'Those dates are not valid: arrival must be today or later, and before departure.',
    errorMaxNoches: 'A stay cannot be longer than {n} nights.',
    errorCapacidad: 'This accommodation takes up to {n} people.',
    errorNoExiste: 'That accommodation does not exist.',
    errorNoDisponible: 'That unit is no longer available for those dates.',
    errorLimite:
      'We received several submissions from your connection. Try again in a few minutes, or write to us and we will sort it out by phone.',
    errorGenerico:
      'We could not complete the booking. Try again in a moment, or write to us and we will close it by email.',
  },

  /* ───────────────────────── política de cancelación ──────────────────────── */
  cancelacion: {
    primera: '{n} days or more in advance: {cargo}.',
    entre: 'Between {desde} and {hasta} days before: {cargo}.',
    menos: 'Less than {n} days before: {cargo}.',
    ninguno: 'free of charge',
    primera_noche: 'the first night is charged',
    total: '100% of the stay is charged',
  },

  /* ────────────────── comodidades reconocidas del catálogo ───────────────── */
  comodidades: {
    vista: 'Lago Argentino view',
    hidromasaje: 'Whirlpool bath',
    desayuno: 'Buffet breakfast included',
    wifi: 'Wi-Fi',
    hogar: 'Wood fireplace and grill',
    cocina: 'Equipped kitchen',
    calefaccion: 'Central heating',
    tv: 'Cable TV',
    estacionamiento: 'Covered parking',
    caja: 'In-room safe',
  },

  /* ─────────────────────────── pasos de la reserva ────────────────────────── */
  confirmacion: {
    titulo: 'We look forward to welcoming you',
    meta: 'Your booking',
    listo: 'All set.',
    listoConNombre: 'All set, {nombre}.',
    guardaCodigo: 'Keep this code: you will be asked for it at check-in.',
    alojamiento: 'Accommodation',
    llegada: 'Arrival',
    salida: 'Departure',
    noches: 'Nights',
    total: 'Total',
    pagado: 'Paid',
    saldo: 'Balance',
    saldoAAbonar: 'Balance due',
    seniaAAbonar: 'Deposit due',
    desdeLas: '{fecha} · from {hora}',
    hastaLas: '{fecha} · until {hora}',
    pagoFallo: 'Your booking is held, but we could not open the payment. You can pay the deposit from here, with the same or another method.',
    verFactura: 'View my invoice',
    volverInicio: 'Back to home',
    reservarOtra: 'Book another stay',
    favoritos: 'Bookmark this page: you can open it again anytime with the same link.',
    sinCalculo: 'We could not calculate the balance right now. Write to us and we will check it with you.',
    todoPagoTitulo: 'Everything is paid.',
    todoPagoTexto: 'There is nothing else to do; we will see you on your arrival day.',
    saldoPendienteTitulo: 'A balance is still due.',
    saldoPendienteTexto: 'You can pay it now or on arrival at the hotel.',
    sinConfirmarTitulo: 'Your booking is not confirmed yet.',
    sinConfirmarTexto: 'It is held for {dias} days; pay the deposit to secure it.',
    pagarSaldo: 'Pay the balance',
    pagarSenia: 'Pay the deposit',
    errorLecturaTitulo: 'We could not load your booking',
    errorLecturaTexto: 'Your booking is registered. It was a temporary problem displaying it: please try again in a few seconds.',
    reintentar: 'Try again',
  },
  pago: {
    meta: 'Pay my booking',
    tituloSenia: 'Pay the deposit',
    tituloSaldo: 'Pay the balance',
    descripcion: 'Booking {codigo}. Choose how you want to pay.',
    miReserva: 'My booking',
    verMiReserva: 'View my booking',
    totalEstadia: 'Total for the stay',
    yaPagaste: 'Already paid',
    seniaAhora: 'Deposit to pay now',
    saldoAhora: 'Balance to pay now',
    noDisponibleTitulo: 'Online payment is not available.',
    noDisponibleTexto: 'Write to us and we will arrange a bank transfer or payment on arrival.',
    nota: 'Payment is processed by the payment provider, not by the hotel. Blanca Patagonia never stores your card number.',
    sinCalculoTitulo: 'We could not calculate your balance',
    sinCalculoTexto: 'The problem is on our side. Please try again in a minute, or write to us and we will sort it out by phone.',
    todoPagoTitulo: 'Everything is paid',
    nadaQuePagarTitulo: 'There is nothing to pay here',
    cancelada: 'This booking is cancelled.',
    sinSaldo: 'This booking has no balance due.',
    errorNoEncontrada: 'We could not find that booking. Please check the link we sent you.',
    errorLimite: 'We received several payment attempts in a row. Please wait a few minutes and try again, or write to us.',
    errorSinDatos: 'We could not calculate the balance right now. Please try again in a minute.',
    errorNoCobrable: 'This booking has no balance that can be paid online.',
    errorPasarela: 'We could not open the payment method. Try another one, or write to us and we will sort it out by phone.',
    errorGenerico: 'We could not complete the operation. Please try again.',
  },
  pasos: {
    fechas: 'Dates',
    alojamiento: 'Accommodation',
    datos: 'Your details',
    confirmacion: 'Confirmation',
    paso: 'Step {n} of {total}',
    progreso: 'Booking progress',
  },
}
