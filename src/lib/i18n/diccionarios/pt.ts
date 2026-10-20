import type { Diccionario } from './es'

/**
 * Diccionario portugués (Brasil).
 *
 * `pt-BR` y no `pt-PT` por decisión ya tomada en `lib/i18n/idiomas.ts`: el grueso
 * del turismo lusoparlante en El Calafate es brasileño. Eso define el léxico:
 * «café da manhã» (no «pequeno-almoço»), «banheiro» (no «quarto de banho»),
 * «você» (no «tu»), «sala» (no «sala de estar» portuguesa), «tirar a foto» y
 * «traslado», que es la palabra que usa la industria turística en Brasil.
 *
 * ── Decisiones de traducción ────────────────────────────────────────────────
 *
 * - **«hostería» → «pousada»**: es el término que un brasileño entiende como
 *   alojamiento chico y atendido por sus dueños. «Hospedaria» suena a pensión
 *   barata y «estalagem» es portugués europeo y arcaico. Se usa igual en los
 *   nueve lugares donde aparece, incluido el filtro del catálogo, para que la
 *   palabra del menú coincida con la del texto.
 * - **«habitación» → «quarto»**; el baño con hidromasaje es «banheira de
 *   hidromassagem», que es la bañera, no el ambiente.
 * - **«hogar a leña» / «hogar parrilla» → «lareira a lenha» / «lareira com
 *   churrasqueira»**: en la cabaña el artefacto hace las dos cosas y el
 *   brasileño las nombra separadas.
 * - **Plata, textual y sin adornar** (regla del proyecto): «con IVA» sale como
 *   «com impostos incluídos» —en Brasil no existe un «IVA» que el huésped
 *   reconozca, y «imposto incluído» es la fórmula con la que se publican los
 *   precios—; «con cargo» es «com custo adicional» y «sin letra chica», «sem
 *   letras miúdas». No se agrega ninguna condición que el español no diga: el
 *   texto de cancelación sigue remitiendo a los días de anticipación, sin
 *   numerarlos, porque los plazos los arma la pantalla.
 * - **Nombres propios sin tocar**: «Blanca Patagonia», «El Calafate», «Lago
 *   Argentino», «Bahía Redonda», «Isla Solitaria», «Perito Moreno», «El
 *   Chaltén», «Charles Furh», «Santa Cruz», «Torres del Paine», «Estancia
 *   Cristina», «Cerro Frías» y «Big Ice». «Parque Nacional Los Glaciares» se
 *   escribe igual en portugués. Sí se traduce «Patagonia» → «Patagônia», que es
 *   la región y no el nombre del hotel, y el sustantivo común «glaciar» →
 *   «geleira», que en Brasil es la palabra corriente.
 * - **Marcadores de posición** (`{n}`, `{noches}`, `{monto}`, `{entrada}`,
 *   `{salida}`) quedan tal cual, con el nombre en español: los lee el código,
 *   no el huésped.
 */
export const pt: Diccionario = {
  /* ─────────────────────────────── navegación ─────────────────────────────── */
  nav: {
    idioma: 'Idioma',
    volverArriba: 'Voltar ao topo',
    navegacion: 'Navegação principal',
    inicio: 'Início',
    alojamientos: 'Acomodações',
    experiencias: 'Experiências',
    ubicacion: 'Localização',
    reservar: 'Reservar',
    conocerMas: 'Saiba mais',
    cambiarIdioma: 'Mudar idioma',
    irAlContenido: 'Ir para o conteúdo',
  },

  /* ──────────────────────────────── portada ──────────────────────────────── */
  portada: {
    lugar: 'El Calafate · Patagônia Argentina',
    titulo: 'De frente para o Lago Argentino',
    bajada:
      'Pousada boutique de 15 quartos com vista e hidromassagem, e cabanas com lareira a lenha. A poucos passos do Parque Nacional Los Glaciares.',
    sinFechas: 'Ainda não tenho datas — ver as acomodações',

    presentacionEtiqueta: 'Um lugar diferente em El Calafate',
    presentacionTitulo: 'Aqui tudo olha para o mesmo lugar',
    presentacionTexto:
      'A Blanca Patagonia é uma pousada boutique quatro estrelas com cabanas, numa parte alta de El Calafate. O lobby tem um janelão que dá para o Lago Argentino, a Bahía Redonda e a Isla Solitaria, e é onde todas as manhãs se serve o café da manhã em buffet.',

    cifraHabitaciones: 'quartos',
    cifraHabitacionesPie: 'Todos com vista para o lago',
    cifraCategoria: 'categoria',
    cifraCategoriaPie: 'Pousada boutique',
    cifraPersonas: 'pessoas',
    cifraPersonasPie: 'Na cabana maior',
    cifraDistancia: 'até o Perito Moreno',
    cifraDistanciaPie: 'Cerca de duas horas de viagem',

    ventanalTitulo: 'O janelão',
    ventanalTexto:
      'É o coração do hotel: uma sala com a lareira acesa e o lago inteiro do outro lado do vidro. Aqui se toma o café da manhã, se espera o vento diminuir e se termina o dia.',

    dondeDormir: 'Onde dormir',
    dosFormas: 'Duas formas de se hospedar',
    dosFormasTexto:
      'A pousada, para quem quer serviço e vista. As cabanas, para quem quer a sua própria casa.',

    hosteriaEtiqueta: 'Pousada boutique',
    hosteriaTitulo: '15 quartos, todos com vista',
    hosteriaTexto:
      'Decoração clássica, banheira de hidromassagem em todos e janelas para o Lago Argentino, a Bahía Redonda e a Isla Solitaria. Café da manhã em buffet incluído.',
    hosteriaEnlace: 'Ver quartos e preços',

    cabanasEtiqueta: 'Cabanas',
    cabanasTitulo: 'Casa própria, até 7 pessoas',
    cabanasTexto:
      'De um a três dormitórios, totalmente equipadas, com sala, cozinha, roupa de cama e lareira com churrasqueira. Para famílias e grupos que preferem a independência.',
    cabanasEnlace: 'Ver cabanas e preços',

    lavandaEtiqueta: 'Nosso campo',
    lavandaTitulo: 'Um campo de lavanda na estepe',
    lavandaTexto1:
      'O hotel tem o seu próprio campo de lavanda, com o lago ao fundo. Floresce no verão e pode ser percorrido a pé: é o lugar onde quase todos os nossos hóspedes acabam tirando a foto da viagem.',
    lavandaTexto2:
      'Cresce em plena estepe patagônica, um lugar onde quase nada floresce. Fica a trinta passos da recepção e não há outro igual em El Calafate.',
    lavandaFlorece: 'Floresce',
    lavandaFloreceValor: 'De dezembro a fevereiro',
    lavandaDistancia: 'Da recepção',
    lavandaDistanciaValor: '30 passos',

    gastronomiaEtiqueta: 'Mesa e fogo',
    gastronomiaTitulo: 'Comer com a lareira acesa',
    gastronomiaTexto:
      'O café da manhã em buffet é servido em frente ao janelão. À noite, o restaurante de temporada e o bar funcionam ao lado da lareira: cordeiro, tábuas de frios da região e vinhos argentinos.',
    gastronomiaLista: [
      'Café da manhã em buffet incluído, todos os dias',
      'Restaurante de temporada e bar',
      'Lancheiras para levar nas excursões (com custo adicional)',
      'Lareira com churrasqueira em cada cabana',
    ],

    experienciasEtiqueta: 'O que fazer a partir daqui',
    experienciasTitulo: 'O Parque Nacional, logo ali',
    experienciasTexto:
      'Coordenamos a excursão e o traslado desde a recepção. Estas são as três mais pedidas; há várias dezenas a mais.',
    experienciasPie:
      'Também: Big Ice, caiaque em frente à geleira, Estancia Cristina, Torres del Paine, cavalgadas, Cerro Frías, pesca e estâncias com tosquia e churrasco.',

    incluyeTitulo: 'O que a tarifa inclui',
    incluyeTexto: 'Sem letras miúdas: isto entra no preço e isto se cobra à parte.',
    incluido: 'Incluído',
    conCargo: 'Com custo adicional',
    horarios:
      'Check-in {entrada} · Check-out {salida}. Consulte-nos sobre traslados e horários especiais.',

    comoLlegarEtiqueta: 'Como chegar',
    comoLlegarTitulo: 'No coração da Patagônia',
    direccion: 'Charles Furh 149, Barrio Los Guías, El Calafate, Santa Cruz.',
    distancias: 'Distâncias',
    distanciaCentro: 'Centro de El Calafate',
    distanciaAeropuerto: 'Aeroporto (FTE)',
    distanciaGlaciar: 'Geleira Perito Moreno',
    distanciaChalten: 'El Chaltén',
    contacto: 'Contato',
    telefono: 'Telefone',
    email: 'E-mail',
    horariosEtiqueta: 'Horários',
    abrirEnMapas: 'Abrir no Google Maps',

    antesDeReservar: 'Antes de reservar',
    loQueConvieneSaber: 'O que é bom saber',
    siTenesQueCancelar: 'Se você precisar cancelar',
    cancelarTexto:
      'Sem letras miúdas. Conta-se conforme os dias de antecedência com que você avisar:',
    noShow: 'Não se apresentar sem avisar é cobrado como a estadia completa.',

    cierreTitulo: 'Veja se há vaga nas suas datas',
    cierreTexto:
      'Reservando direto você paga o mesmo ou menos do que em qualquer outro site, e fala com a gente se precisar de algo.',
    cierreBoton: 'Buscar disponibilidade',
    cierreSecundario: 'Ver acomodações',

    pieDescripcion:
      'Pousada boutique e cabanas de frente para o Lago Argentino. Charles Furh 149, B° Los Guías, El Calafate, Santa Cruz, Patagônia Argentina.',
    pieElHotel: 'O hotel',
    pieRedes: 'Redes sociais',
    pieAccesoPersonal: 'Acesso da equipe',
  },

  /* ─────────────────────────── por qué reservar ─────────────────────────── */
  ventajas: {
    titulo: 'Reserve direto',
    precioTitulo: 'Melhor preço garantido',
    precioTexto:
      'Sem comissões de intermediários. Mesmo preço ou melhor do que em qualquer outro site.',
    confirmacionTitulo: 'Confirmação imediata',
    confirmacionTexto: 'Você recebe a sua reserva na hora por e-mail. Sem esperas, sem ligações.',
    atencionTitulo: 'Atendimento direto',
    atencionTexto: 'Você fala direto com a gente para qualquer dúvida ou pedido especial.',
  },

  /* ─────────────────────────────── buscador ──────────────────────────────── */
  buscador: {
    elegiFechas: 'Escolha as datas',
    huesped: '1 hóspede',
    huespedesN: '{n} hóspedes',
    llegada: 'Chegada',
    salida: 'Saída',
    huespedes: 'Hóspedes',
    buscar: 'Buscar',
    tocaParaCambiar: 'Toque para mudar a busca',
    tocaParaCerrar: 'Toque para fechar',
    noches: '{n} noites',
    unaNoche: '1 noite',
    personas: '{n} pessoas',
    unaPersona: '1 pessoa',
  },

  /* ─────────────────────────────── catálogo ──────────────────────────────── */
  catalogo: {
    metaTitulo: 'Acomodações',
    metaDescripcion:
      'Quartos da pousada com vista para o Lago Argentino e chalés com lareira em El Calafate. Capacidade, comodidades e preços por temporada.',
    filtrar: 'Filtrar por tipo de acomodação',
    sinCategoria: 'No momento não há acomodações nesta categoria.',
    yaSabes: 'Já sabe quando vai viajar?',
    yaSabesTexto: 'Consulte a disponibilidade real dessas datas e reserve on-line, sem intermediários.',
    titulo: 'Nossas acomodações',
    descripcion:
      'Pousada boutique de frente para o Lago Argentino e cabanas a poucos passos do Parque Nacional Los Glaciares. Veja as opções e depois escolha as datas.',
    todos: 'Todas',
    hosteria: 'Pousada',
    cabanas: 'Cabanas',
    desde: 'A partir de',
    porNoche: 'por noite, com impostos incluídos',
    precioAConfirmar: 'Preço a confirmar',
    verDetalle: 'Ver detalhes',
    verDisponibilidad: 'Ver disponibilidade',
    queIncluye: 'O que inclui',
    todosLosAlojamientos: 'Todas as acomodações',
    sinResultados: 'Não há acomodações nessa categoria',
  },

  /* ─────────────────────────────── reservar ──────────────────────────────── */
  reservar: {
    metaTitulo: 'Reservar',
    metaDescripcion:
      'Escolha suas datas e reserve direto no Blanca Patagonia, El Calafate. Quartos com vista para o Lago Argentino e chalés com lareira.',
    unaOpcion: '1 opção',
    variasOpciones: '{n} opções',
    resumen: '{opciones} para {noches}. Os preços já incluem impostos.',
    porUnaNoche: '{monto} por 1 noite, com impostos',
    sinTarifasAviso:
      'Temos vaga nessas datas, mas ainda não publicamos as tarifas do período. Escreva para nós e passamos o preço no mesmo dia.',
    sinLugarAviso:
      'Não temos nada livre para {personas} nessas datas. Tente mudar um dia, ou escreva para nós: às vezes algo se libera.',
    elQueMirabas: 'O que você estava vendo',
    verDetalleDe: 'Ver os detalhes de {nombre}',
    consultar: 'Consultar',
    consultaAsunto: 'Consulta de disponibilidade · {nombre}',
    consultaCuerpo: 'Olá, gostaria de consultar sobre {nombre} de {desde} a {hasta} para {n} hóspede(s).',
    titulo: 'Reserve a sua estadia',
    descripcion:
      'Escolha as datas e quantas pessoas são. Mostramos o que está livre, com o preço final.',
    verTodos: 'Ver todas as acomodações e seus preços',
    opciones: '{n} opções para {noches} noites. Os preços já incluem impostos.',
    sinOpciones: 'Não há disponibilidade para essas datas',
    sinOpcionesTexto: 'Tente outras datas ou com menos hóspedes.',
    fechasInvalidas: 'Essas datas não são válidas. A chegada deve ser hoje ou depois, e a saída, depois da chegada.',
    verFotos: 'Ver fotos e serviços',
    porNoches: '{monto} por {n} noites, com impostos incluídos',
    reservar: 'Reservar',
    quedaUno: 'Resta 1',
    quedanPocos: 'Restam {n}',
    completo: 'Sem disponibilidade',
  },

  /* ─────────────────────────────── asistente ─────────────────────────────── */
  asistente: {
    aviso: 'O assistente responde em espanhol. Para qualquer outra coisa, escreva para nós em português.',
    nombre: 'Assistente da Blanca Patagonia',
    subtitulo: 'Respondemos na hora as dúvidas mais frequentes.',
    saludo:
      'Olá! Posso ajudar você com horários de check-in e check-out, política de cancelamento, serviços da pousada e disponibilidade. O que você precisa saber?',
    sugerencia1: 'A que horas é o check-in?',
    sugerencia2: 'Como é a política de cancelamento?',
    sugerencia3: 'Quais serviços estão incluídos?',
    campo: 'Escreva a sua dúvida…',
    campoEtiqueta: 'Sua dúvida para o assistente',
    enviar: 'Enviar',
    escribiendo: 'Escrevendo…',
    abrir: 'Dúvidas?',
    cerrar: 'Fechar',
  },

  /* ──────────────────────────────── común ────────────────────────────────── */
  comun: {
    pausarMovimiento: 'Pausar movimento',
    reanudarMovimiento: 'Retomar movimento',
    volver: 'Voltar',
    cargando: 'Carregando…',
    hosteriaYCabanas: 'Pousada e cabanas · El Calafate, Santa Cruz',
    checkInOut: 'Check-in {entrada} · Check-out {salida}',
  },

  /* ──────────────────────── contenido de la portada ──────────────────────── */
  contenido: {
    manifiestoDatos: ['Lago Argentino, à vista', 'Perito Moreno, a 80 km', 'Lareira a lenha no lobby'],
    manifiestoFoto: 'O janelão do lobby, visto do terraço',
    manifiestoSeguir: 'Continue descendo',
    manifiestoEtiqueta: 'Blanca Patagonia',
    manifiesto:
      'Um lago turquesa do outro lado do vidro. A geleira, a uma hora de estrada. E a lareira acesa quando você volta.',
    habitaciones: [
      {
        nombre: 'Standard',
        capacidad: 'Single, duplo ou triplo',
        detalle: 'Camas de solteiro ou de casal. Encantador, com delicados detalhes de design.',
      },
      {
        nombre: 'Superior',
        capacidad: 'Single ou duplo',
        detalle: 'Mais espaço e a mesma vista para o lago, a baía e a Isla Solitaria.',
      },
      {
        nombre: 'Suíte Principal',
        capacidad: 'Duplo',
        detalle: 'Cama de casal e a vista mais aberta da pousada.',
      },
    ],
    cabanas: [
      { nombre: '1 quarto', capacidad: '2 ou 3 pessoas' },
      { nombre: '2 quartos', capacidad: 'Até 5 pessoas' },
      { nombre: '3 quartos', capacidad: 'Até 7 pessoas' },
    ],
    excursiones: [
      {
        nombre: 'Minitrekking no Perito Moreno',
        detalle: 'Caminhada com grampos sobre o gelo da geleira.',
      },
      {
        nombre: 'Todo Glaciares: Upsala e Spegazzini',
        detalle: 'Navegação diante das paredes de gelo do Braço Norte.',
      },
      {
        nombre: 'El Chaltén e Lago del Desierto',
        detalle: 'Trekking ao Fitz Roy, rafting e a lagoa ao pé da montanha.',
      },
    ],
    incluido: [
      'Café da manhã buffet diante do janelão',
      'Wi-Fi em todo o hotel',
      'Banheira de hidromassagem (pousada)',
      'Lareira e churrasqueira (chalés)',
      'Estacionamento coberto',
      'Aquecimento central',
      'TV a cabo e cofre',
      'Arrumação diária',
      'Jacuzzi comum para 6 pessoas',
      'Bar',
    ],
    conCargo: [
      'Traslado de e para o aeroporto',
      'Lanches para as excursões',
      'Lavanderia',
      'Bicicletas de montanha',
    ],
    preguntas: [
      {
        p: 'Quantas noites vale a pena ficar?',
        r: 'Três, no mínimo. O Perito Moreno leva um dia inteiro, as navegações outro, e sobra um terceiro para El Chaltén ou para não fazer nada. Com duas noites se viaja com pressa.',
      },
      {
        p: 'Qual é a melhor época?',
        r: 'De outubro a abril tudo está aberto e há mais horas de luz; em janeiro o sol se põe depois das dez. No inverno há menos gente e a geleira continua lá. O vento faz parte do lugar o ano todo.',
      },
      {
        p: 'Vocês têm traslado do aeroporto?',
        r: 'Sim, cobrado à parte e com aviso prévio. O aeroporto de El Calafate (FTE) fica a 23 km, uns 20 minutos.',
      },
      { p: 'Tem estacionamento?', r: 'Sim, coberto e gratuito para os hóspedes.' },
      {
        p: 'O café da manhã está incluído?',
        r: 'Sempre, na pousada e nos chalés. É buffet e é servido diante do janelão do lobby.',
      },
      {
        p: 'Posso pagar em pesos?',
        r: 'Sim. As tarifas são publicadas em dólares e cobradas em pesos pela cotação do dia, ou com cartão internacional.',
      },
    ],
    alt: {
      ventanal: 'Lobby da pousada com janelão para o Lago Argentino ao entardecer e lareira acesa',
      hosteria: 'Suíte da pousada com banheira de hidromassagem, lareira e parede de pedra',
      cabana: 'Sala do chalé com lareira de pedra e janela para o Lago Argentino',
      galeria: [
        'Quarto superior com janelão para o lago',
        'Detalhe da cama com parede de pedra',
        'Cozinha e sala de jantar do chalé',
        'Quarto do chalé',
      ],
      lavandaCampo: 'Campo de lavanda do hotel com o Lago Argentino ao fundo',
      lavandaCanasto: 'Cesto com lavanda recém-colhida',
      lavandaDetalle: 'Detalhe das flores de lavanda',
      cena: 'Mesa posta junto à lareira',
      picada: 'Tábua de queijos e frios com vinho diante do fogo',
      entorno: 'O hotel e seus arredores, sobre El Calafate',
    },
  },

  /* ─────────────────────────── ficha de alojamiento ───────────────────────── */
  ficha: {
    temporadas: { baja: 'Baixa temporada', media: 'Média temporada', alta: 'Alta temporada' },
    vigenteHasta: '{temporada} · até {fecha}',
    proximaDesde: '{temporada} · a partir de {fecha}',
    impuestos: 'Impostos incluídos',
    porNocheCorto: '/ noite',
    verTarifas: 'Ver tarifas e disponibilidade',
    verDetalles: 'Ver detalhes da acomodação',
    fotoAnterior: 'Foto anterior',
    fotoSiguiente: 'Próxima foto',
    fotoN: 'Foto {n} de {total}',
    galeriaNota: 'A primeira foto é desta acomodação; as demais, de outras da mesma categoria.',
    comodidades: 'Comodidades',
    precioSegunFechas: 'O preço final depende das datas que você escolher.',
    noEncontrado: 'Acomodação não encontrada',
    metaDescripcion: '{categoria} para {capacidad} em El Calafate.',
    sinTarifas: 'Ainda não publicamos as tarifas desta acomodação.',
    porNocheIvaIncluido: 'por noite, com impostos incluídos',
    preciosTitulo: 'Preços por temporada',
    preciosDescripcion:
      'Valor por noite em dólares com impostos incluídos. A temporada é definida pela data de cada noite.',
    preciosLeyenda: 'Preço por noite de {nombre} em cada temporada, com as datas que abrange',
    temporada: 'Temporada',
    fechas: 'Datas',
    porNoche: 'Por noite',
    aConfirmar: 'a confirmar',
    rango: '{desde} a {hasta}',
    horarios: 'Horários',
    horariosValor: 'Check-in a partir das {entrada} · Check-out até as {salida}',
    mascotas: 'Animais de estimação',
    conMascotas: 'Aceitamos animais de estimação.',
    sinMascotas: 'Não aceitamos animais de estimação.',
    cancelacion: 'Cancelamento',
    cancelacionTexto:
      'Sem custo cancelando com mais de 14 dias de antecedência. Entre 14 e 7 dias cobra-se a primeira noite, e dentro dos 7 dias o total da estadia.',
    otrasOpciones: 'Outras opções: {categoria}',
  },

  /* ──────────────────────── categorías y capacidad ───────────────────────── */
  categorias: {
    hosteria: 'Pousada boutique',
    cabana: 'Chalé',
    capacidadUna: '1 pessoa',
    capacidadVarias: 'até {n} pessoas',
    ultimaLibre: 'Última disponível nessas datas',
  },

  /* ──────────────────────────────── checkout ──────────────────────────────── */
  checkout: {
    campoObligatorio: 'Este dado é obrigatório',
    tarjetasAceptadas: 'Cartões aceitos',
    resumenTitulo: 'Resumo da sua estadia',
    nocheDel: 'Noite de {fecha}',
    subtotal: 'Subtotal',
    iva: 'Impostos',
    seniaAhora: 'Sinal a pagar agora',
    saldoRestante: 'Saldo restante',
    pagoTitulo: 'Forma de pagamento',
    pagoTexto:
      'Escolha como pagar o sinal. Levamos você à página segura do provedor para informar o cartão: nós nunca vemos nem guardamos os dados.',
    pagarDespues: 'Reservar agora e pagar depois',
    pagarDespuesDetalle:
      'Enviamos por e-mail o link para pagar o sinal. A reserva fica garantida por {dias} dias.',
    alCambio: '{usd} ao câmbio de {tasa} por dólar',
    medioStripe: 'Cartão internacional',
    medioStripeDetalle: 'Para hóspedes do exterior. Cobrado em dólares, sem conversão.',
    medioMercadoPago: 'MercadoPago e meios locais',
    medioMercadoPagoDetalle: 'Para pagar em pesos argentinos, com ou sem parcelas.',
    formasMercadoPago: ['Cartão de crédito', 'Cartão de débito', 'Saldo no MercadoPago', 'Dinheiro (Rapipago e Pago Fácil)'],
    medioSimulado: 'Pagamento simulado (demonstração)',
    medioSimuladoDetalle: 'Não movimenta dinheiro. Serve para testar o circuito completo de cobrança.',
    sinMedios: 'O pagamento on-line não está disponível agora. Reserve e escrevemos para combinar o sinal.',
    pedidoEspecial: 'Pedido especial',
    pedidoAyuda: 'Opcional: horário de chegada, um berço, uma comemoração… A recepção lê antes de você chegar.',
    promociones:
      'Quero receber novidades e promoções do hotel por e-mail. Posso cancelar quando quiser.',
    condiciones: 'Aceito as condições da reserva e a política de cancelamento.',
    errorCondiciones: 'Para reservar você precisa aceitar as condições.',
    errorMedio: 'Escolha uma forma de pagamento.',
    confirmarYPagar: 'Confirmar e pagar o sinal',
    redirigiendo: 'Abrindo o pagamento seguro…',
    pagoSeguro: 'Pagamento seguro. Nunca guardamos os dados do seu cartão.',
    titulo: 'Quase pronto',
    descripcion: 'Confira se está tudo certo e diga como podemos contatar você.',
    volverOpciones: 'Voltar às opções',
    desdeLas: 'a partir das {hora}',
    hastaLas: 'até as {hora}',
    total: 'Total',
    ivaIncluido: 'Impostos incluídos',
    senia: 'Sinal para garantir a reserva',
    seniaNota: '(equivale à primeira noite)',
    tusDatos: 'Seus dados',
    apellido: 'Sobrenome',
    nombre: 'Nome',
    email: 'E-mail',
    emailAyuda: 'Enviamos aqui a confirmação com o código da sua reserva.',
    telefono: 'Telefone',
    telefonoAyuda: 'Opcional. Serve para avisar você se surgir algo com a sua chegada.',
    confirmar: 'Confirmar a reserva',
    reservando: 'Reservando…',
    nadaAhora:
      'Nada é cobrado agora. A reserva fica garantida e escrevemos para combinar o sinal, que equivale à primeira noite.',
    requerido: 'obrigatório',
    errorIncompleto: 'Os dados da reserva estão incompletos.',
    errorApellidoEmail: 'Informe seu sobrenome e seu e-mail.',
    errorEmail: 'Informe um e-mail válido.',
    errorNombre: 'Confira o nome e o sobrenome: sem links nem símbolos, até 80 letras.',
    errorTelefono: 'Confira o telefone: apenas números e os sinais + ( ) -.',
    errorFechas: 'As datas não são válidas: a chegada deve ser hoje ou depois, e antes da saída.',
    errorMaxNoches: 'A estadia não pode passar de {n} noites.',
    errorCapacidad: 'Esta acomodação comporta até {n} pessoas.',
    errorNoExiste: 'Essa acomodação não existe.',
    errorNoDisponible: 'A unidade não está mais disponível nessas datas.',
    errorLimite:
      'Recebemos vários envios da sua conexão. Tente de novo em alguns minutos, ou escreva para nós e resolvemos por telefone.',
    errorGenerico:
      'Não conseguimos concluir a reserva. Tente de novo em instantes, ou escreva para nós e fechamos por e-mail.',
  },

  /* ───────────────────────── política de cancelación ──────────────────────── */
  cancelacion: {
    primera: 'Com {n} dias ou mais de antecedência: {cargo}.',
    entre: 'Entre {desde} e {hasta} dias antes: {cargo}.',
    menos: 'Com menos de {n} dias: {cargo}.',
    ninguno: 'sem custo',
    primera_noche: 'cobra-se a primeira noite',
    total: 'cobra-se 100% da estadia',
  },

  /* ────────────────── comodidades reconocidas del catálogo ───────────────── */
  comodidades: {
    vista: 'Vista para o Lago Argentino',
    hidromasaje: 'Banheira de hidromassagem',
    desayuno: 'Café da manhã buffet incluído',
    wifi: 'Wi-Fi',
    hogar: 'Lareira e churrasqueira',
    cocina: 'Cozinha equipada',
    calefaccion: 'Aquecimento central',
    tv: 'TV a cabo',
    estacionamiento: 'Estacionamento coberto',
    caja: 'Cofre',
  },

  /* ─────────────────────────── pasos de la reserva ────────────────────────── */
  confirmacion: {
    titulo: 'Esperamos por você',
    meta: 'Sua reserva',
    listo: 'Pronto.',
    listoConNombre: 'Pronto, {nombre}.',
    guardaCodigo: 'Guarde este código: ele será pedido na chegada.',
    alojamiento: 'Acomodação',
    llegada: 'Chegada',
    salida: 'Saída',
    noches: 'Noites',
    total: 'Total',
    pagado: 'Pago',
    saldo: 'Saldo',
    saldoAAbonar: 'Saldo a pagar',
    seniaAAbonar: 'Sinal a pagar',
    desdeLas: '{fecha} · a partir das {hora}',
    hastaLas: '{fecha} · até as {hora}',
    pagoFallo: 'Sua reserva está garantida, mas não conseguimos abrir o pagamento. Você pode pagar o sinal daqui, com o mesmo ou outro meio.',
    verFactura: 'Ver minha fatura',
    volverInicio: 'Voltar ao início',
    reservarOtra: 'Reservar outra estadia',
    favoritos: 'Salve esta página nos favoritos: você pode abri-la quando quiser com o mesmo link.',
    sinCalculo: 'Não conseguimos calcular o saldo agora. Escreva para nós e verificamos com você.',
    todoPagoTitulo: 'Está tudo pago.',
    todoPagoTexto: 'Você não precisa fazer mais nada; esperamos você no dia da chegada.',
    saldoPendienteTitulo: 'Há um saldo pendente.',
    saldoPendienteTexto: 'Você pode pagá-lo agora ou na chegada ao hotel.',
    sinConfirmarTitulo: 'A reserva ainda não está confirmada.',
    sinConfirmarTexto: 'Ela fica reservada por {dias} dias; para garanti-la, pague o sinal.',
    pagarSaldo: 'Pagar o saldo',
    pagarSenia: 'Pagar o sinal',
    errorLecturaTitulo: 'Não conseguimos carregar sua reserva',
    errorLecturaTexto: 'Sua reserva está registrada. Foi um problema momentâneo ao exibi-la: tente novamente em alguns segundos.',
    reintentar: 'Tentar novamente',
  },
  pago: {
    meta: 'Pagar minha reserva',
    tituloSenia: 'Pague o sinal',
    tituloSaldo: 'Pague o saldo',
    descripcion: 'Reserva {codigo}. Escolha como quer pagar.',
    miReserva: 'Minha reserva',
    verMiReserva: 'Ver minha reserva',
    totalEstadia: 'Total da estadia',
    yaPagaste: 'Você já pagou',
    seniaAhora: 'Sinal a pagar agora',
    saldoAhora: 'Saldo a pagar agora',
    noDisponibleTitulo: 'O pagamento online não está disponível.',
    noDisponibleTexto: 'Escreva para nós e combinamos a transferência ou o pagamento na chegada.',
    nota: 'O pagamento é processado pela plataforma de pagamento, não pelo hotel. A Blanca Patagonia nunca guarda o número do seu cartão.',
    sinCalculoTitulo: 'Não conseguimos calcular seu saldo',
    sinCalculoTexto: 'O problema é nosso, não seu. Tente novamente em um minuto ou escreva para nós e resolvemos por telefone.',
    todoPagoTitulo: 'Já está tudo pago',
    nadaQuePagarTitulo: 'Não há nada para pagar aqui',
    cancelada: 'A reserva está cancelada.',
    sinSaldo: 'A reserva não tem saldo pendente.',
    errorNoEncontrada: 'Não encontramos essa reserva. Confira o link que enviamos.',
    errorLimite: 'Recebemos várias tentativas de pagamento seguidas. Aguarde alguns minutos e tente novamente, ou escreva para nós.',
    errorSinDatos: 'Não conseguimos calcular o saldo agora. Tente novamente em um minuto.',
    errorNoCobrable: 'Esta reserva não tem saldo que possa ser pago online.',
    errorPasarela: 'Não conseguimos abrir o meio de pagamento. Tente outro, ou escreva para nós e resolvemos por telefone.',
    errorGenerico: 'Não conseguimos concluir a operação. Tente novamente.',
  },
  pasos: {
    fechas: 'Datas',
    alojamiento: 'Acomodação',
    datos: 'Seus dados',
    confirmacion: 'Confirmação',
    paso: 'Etapa {n} de {total}',
    progreso: 'Progresso da reserva',
  },
}
