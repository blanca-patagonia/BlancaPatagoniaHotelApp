import type { Diccionario } from './es'

/**
 * Diccionario en chino simplificado (zh-CN), para turismo de China continental.
 *
 * ── Decisiones de traducción ────────────────────────────────────────────────
 *
 * - **Registro:** hotelería de lujo, formal pero cálido. El huésped es `您`, no
 *   `你`. Nada de imperativos secos: donde el rioplatense dice «probá con otras
 *   fechas», acá va `请尝试其他日期`.
 * - **Nombres propios:** transcripción establecida en chino —埃尔卡拉法特
 *   (El Calafate), 阿根廷湖 (Lago Argentino), 佩里托莫雷诺冰川 (Perito Moreno),
 *   巴塔哥尼亚 (Patagonia), 埃尔查尔腾 (El Chaltén), 托雷斯德尔潘恩 (Torres del
 *   Paine), 洛斯格拉西亚雷斯国家公园 (Parque Nacional Los Glaciares)— con el
 *   original entre paréntesis la **primera vez** que aparece en un texto largo:
 *   el huésped lo necesita para buscarlo en un mapa o decírselo a un taxista,
 *   que no lee chino. En etiquetas cortas no se repite, porque no entra.
 *   **«Blanca Patagonia» no se traduce**: es la marca y es lo que figura en la
 *   reserva, en el cartel de la puerta y en la factura.
 * - **Sin plurales, con clasificador:** el chino no marca número, así que
 *   `{n} noches` es `{n} 晚` y `{n} personas` es `{n} 位客人` (位 es el
 *   clasificador cortés para personas). Por eso `unaNoche` y `unaPersona`
 *   dicen exactamente lo mismo que la forma «plural» con un 1 adelante: no
 *   existe la distinción que el español obliga a hacer.
 * - **Plata, traducida literal y sin adornos:** `con IVA` → `含增值税`,
 *   `sin cargo` → `免费`, `con cargo` → `另行收费`. Nada de «todo incluido» ni
 *   «sin sorpresas» donde el original no lo dice: una condición agregada acá es
 *   un reclamo en el mostrador. `Sin letra chica` se traduce por lo que
 *   significa —que no hay cláusulas en letra pequeña—, no por la imagen.
 * - **Espacio fino alrededor de los números latinos** (`15 间客房`): es la
 *   convención tipográfica de zh-CN y lo que hace legible un precio o una
 *   cantidad embutida en texto chino.
 */
export const zh: Diccionario = {
  /* ─────────────────────────────── navegación ─────────────────────────────── */
  nav: {
    idioma: '语言',
    volverArriba: '返回顶部',
    navegacion: '主导航',
    inicio: '首页',
    alojamientos: '住宿',
    experiencias: '体验活动',
    ubicacion: '位置',
    reservar: '预订',
    conocerMas: '了解更多',
    cambiarIdioma: '切换语言',
    irAlContenido: '跳至主要内容',
  },

  /* ──────────────────────────────── portada ──────────────────────────────── */
  portada: {
    lugar: '埃尔卡拉法特 · 阿根廷巴塔哥尼亚',
    titulo: '阿根廷湖畔',
    bajada:
      '精品旅舍共 15 间客房，均配观景窗与按摩浴缸；独立木屋设有燃木壁炉。紧邻洛斯格拉西亚雷斯国家公园（Parque Nacional Los Glaciares）。',
    sinFechas: '还没确定日期 —— 先浏览住宿',

    presentacionEtiqueta: '埃尔卡拉法特与众不同的住处',
    presentacionTitulo: '这里的一切，都朝向同一片风景',
    presentacionTexto:
      'Blanca Patagonia 是一家四星级精品旅舍，附设独立木屋，坐落于埃尔卡拉法特（El Calafate）的高地。大堂的落地观景窗正对阿根廷湖（Lago Argentino）、雷东达湾（Bahía Redonda）与索利塔里亚岛（Isla Solitaria），每天清晨的自助早餐就设在这里。',

    cifraHabitaciones: '间客房',
    cifraHabitacionesPie: '全部享有湖景',
    cifraCategoria: '星级',
    cifraCategoriaPie: '精品旅舍',
    cifraPersonas: '位客人',
    cifraPersonasPie: '最大木屋的容纳人数',
    cifraDistancia: '到佩里托莫雷诺冰川',
    cifraDistanciaPie: '车程约两小时',

    ventanalTitulo: '落地观景窗',
    ventanalTexto:
      '这里是酒店的心脏：壁炉里燃着火，玻璃的另一侧是整片湖面。客人在这里吃早餐，等风势转小，也在这里结束一天。',

    dondeDormir: '住在哪里',
    dosFormas: '两种入住方式',
    dosFormasTexto: '旅舍，适合想要服务与风景的客人；木屋，适合想拥有一整栋房子的客人。',

    hosteriaEtiqueta: '精品旅舍',
    hosteriaTitulo: '15 间客房，全部享有景观',
    hosteriaTexto:
      '古典风格装饰，每间客房均设按摩浴缸，窗外是阿根廷湖、雷东达湾与索利塔里亚岛。含自助早餐。',
    hosteriaEnlace: '查看客房与价格',

    cabanasEtiqueta: '独立木屋',
    cabanasTitulo: '独门独院，最多可住 7 位客人',
    cabanasTexto:
      '一至三间卧室，设施齐备，配客厅、厨房、床上用品与壁炉烤架。适合偏好独立空间的家庭与团队。',
    cabanasEnlace: '查看木屋与价格',

    lavandaEtiqueta: '我们的田园',
    lavandaTitulo: '草原上的薰衣草田',
    lavandaTexto1:
      '酒店拥有自己的薰衣草田，远处就是湖。花期在夏季，可以步行其间：几乎每位客人此行最满意的照片，都是在这里拍下的。',
    lavandaTexto2:
      '它生长在巴塔哥尼亚（Patagonia）草原腹地，一个几乎没有花能开的地方。从前台步行三十步即到，在埃尔卡拉法特再无第二处。',
    lavandaFlorece: '花期',
    lavandaFloreceValor: '12 月至次年 2 月',
    lavandaDistancia: '距前台',
    lavandaDistanciaValor: '30 步',

    gastronomiaEtiqueta: '餐桌与炉火',
    gastronomiaTitulo: '在炉火旁用餐',
    gastronomiaTexto:
      '自助早餐在落地观景窗前供应。入夜后，季节性餐厅与酒吧在壁炉旁营业：羊肉、本地风味拼盘与阿根廷葡萄酒。',
    gastronomiaLista: [
      '每日自助早餐，已含在房价内',
      '季节性餐厅与酒吧',
      '外出游览的便携餐盒（另行收费）',
      '每栋木屋均配壁炉烤架',
    ],

    experienciasEtiqueta: '从这里出发可以做什么',
    experienciasTitulo: '国家公园，就在转角',
    experienciasTexto:
      '游览行程与接送均可在前台安排。以下三项是客人问得最多的，另有数十种可选。',
    experienciasPie:
      '此外还有：Big Ice 冰川深度徒步、冰川前皮划艇、克里斯蒂娜庄园（Estancia Cristina）、托雷斯德尔潘恩（Torres del Paine）、骑马、弗里亚斯山（Cerro Frías）、垂钓，以及可观看剪羊毛与烤肉的牧场。',

    incluyeTitulo: '房价包含哪些内容',
    incluyeTexto: '没有小字条款：以下项目已含在房价内，以下项目另行收费。',
    incluido: '已包含',
    conCargo: '另行收费',
    horarios: '入住 {entrada} · 退房 {salida}。接送与特殊时间安排请向我们咨询。',

    comoLlegarEtiqueta: '如何到达',
    comoLlegarTitulo: '在巴塔哥尼亚的中心',
    direccion: 'Charles Furh 149, Barrio Los Guías, 埃尔卡拉法特（El Calafate），圣克鲁斯省。',
    distancias: '距离',
    distanciaCentro: '埃尔卡拉法特市中心',
    distanciaAeropuerto: '机场（FTE）',
    distanciaGlaciar: '佩里托莫雷诺冰川',
    distanciaChalten: '埃尔查尔腾',
    contacto: '联系方式',
    telefono: '电话',
    email: '电子邮箱',
    horariosEtiqueta: '时间',
    abrirEnMapas: '在 Google 地图中打开',

    antesDeReservar: '预订之前',
    loQueConvieneSaber: '需要了解的事项',
    siTenesQueCancelar: '如果您需要取消',
    cancelarTexto: '没有小字条款。按您提前通知的天数计算：',
    noShow: '未提前通知且未入住，按全部住宿费用收取。',

    cierreTitulo: '查看您的日期是否还有空房',
    cierreTexto:
      '直接预订，您支付的价格与其他任何渠道相同或更低；有任何需要，都可以直接与我们沟通。',
    cierreBoton: '查询空房',
    cierreSecundario: '浏览住宿',

    pieDescripcion:
      '阿根廷湖畔的精品旅舍与独立木屋。Charles Furh 149, B° Los Guías, 埃尔卡拉法特，圣克鲁斯省，阿根廷巴塔哥尼亚。',
    pieElHotel: '关于酒店',
    pieRedes: '社交媒体',
    pieAccesoPersonal: '员工登录',
  },

  /* ─────────────────────────── por qué reservar ─────────────────────────── */
  ventajas: {
    titulo: '直接预订',
    precioTitulo: '最优价格保证',
    precioTexto: '没有中间商佣金。价格与其他任何渠道相同或更优。',
    confirmacionTitulo: '即时确认',
    confirmacionTexto: '预订确认即刻发送至您的邮箱。无需等待，无需电话。',
    atencionTitulo: '直接服务',
    atencionTexto: '任何咨询或特殊需求，都可以直接与我们沟通。',
  },

  /* ─────────────────────────────── buscador ──────────────────────────────── */
  buscador: {
    elegiFechas: '选择日期',
    huesped: '1 位客人',
    huespedesN: '{n} 位客人',
    llegada: '入住日期',
    salida: '退房日期',
    huespedes: '入住人数',
    buscar: '查询',
    tocaParaCambiar: '点击可修改查询条件',
    tocaParaCerrar: '点击关闭',
    noches: '{n} 晚',
    unaNoche: '1 晚',
    personas: '{n} 位客人',
    unaPersona: '1 位客人',
  },

  /* ─────────────────────────────── catálogo ──────────────────────────────── */
  catalogo: {
    metaTitulo: '住宿',
    metaDescripcion: '埃尔卡拉法特的旅馆客房可眺望阿根廷湖，小屋配有壁炉。容纳人数、设施及各季节价格。',
    filtrar: '按住宿类型筛选',
    sinCategoria: '该类别目前暂无住宿。',
    yaSabes: '已经确定出行日期了吗？',
    yaSabesTexto: '查看这些日期的实时空房情况，并直接在线预订，无中间商。',
    titulo: '我们的住宿',
    descripcion:
      '阿根廷湖畔的精品旅舍，以及紧邻洛斯格拉西亚雷斯国家公园的独立木屋。先看看有哪些选择，再挑选日期。',
    todos: '全部',
    hosteria: '旅舍',
    cabanas: '木屋',
    desde: '低至',
    porNoche: '每晚，含增值税',
    precioAConfirmar: '价格待确认',
    verDetalle: '查看详情',
    verDisponibilidad: '查看空房',
    queIncluye: '包含内容',
    todosLosAlojamientos: '全部住宿',
    sinResultados: '该类别暂无住宿',
  },

  /* ─────────────────────────────── reservar ──────────────────────────────── */
  reservar: {
    metaTitulo: '预订',
    metaDescripcion: '选择日期，直接预订埃尔卡拉法特的 Blanca Patagonia。可眺望阿根廷湖的客房与配有壁炉的小屋。',
    unaOpcion: '1 个选项',
    variasOpciones: '{n} 个选项',
    resumen: '{opciones}，共 {noches}。价格已含增值税。',
    porUnaNoche: '1 晚共 {monto}，含增值税',
    sinTarifasAviso: '这些日期有空房，但该时段的价格尚未公布。请给我们写信，我们当天告知价格。',
    sinLugarAviso: '这些日期没有适合 {personas} 的空房。可尝试前后调整一天，或给我们写信：有时会有空出的房间。',
    elQueMirabas: '您刚才查看的房型',
    verDetalleDe: '查看 {nombre} 详情',
    consultar: '咨询',
    consultaAsunto: '空房咨询 · {nombre}',
    consultaCuerpo: '您好，我想咨询 {nombre}，入住 {desde} 至 {hasta}，共 {n} 位客人。',
    titulo: '预订您的住宿',
    descripcion: '请选择日期与入住人数，我们会显示可预订的房型及最终价格。',
    verTodos: '查看全部住宿及价格',
    opciones: '{noches} 晚共有 {n} 个选择。价格均已含增值税。',
    sinOpciones: '所选日期暂无空房',
    sinOpcionesTexto: '请尝试其他日期，或减少入住人数。',
    verFotos: '查看照片与设施服务',
    porNoches: '{n} 晚 {monto}，含增值税',
    reservar: '预订',
    quedaUno: '仅剩 1 间',
    quedanPocos: '仅剩 {n} 间',
    completo: '已订满',
  },

  /* ─────────────────────────────── asistente ─────────────────────────────── */
  asistente: {
    aviso: '助手以西班牙语回答。其他问题请用英语给我们写信。',
    nombre: 'Blanca Patagonia 客服助手',
    subtitulo: '常见问题即时解答。',
    saludo:
      '您好！我可以为您解答入住与退房时间、取消政策、旅舍的设施服务以及空房情况。请问您想了解什么？',
    sugerencia1: '入住时间是几点？',
    sugerencia2: '取消政策是怎样的？',
    sugerencia3: '包含哪些设施服务？',
    campo: '请输入您的问题…',
    campoEtiqueta: '您向助手提出的问题',
    enviar: '发送',
    escribiendo: '正在输入…',
    abrir: '有问题吗？',
    cerrar: '关闭',
  },

  /* ──────────────────────────────── común ────────────────────────────────── */
  comun: {
    volver: '返回',
    cargando: '加载中…',
    hosteriaYCabanas: '精品旅舍与独立木屋 · 埃尔卡拉法特，圣克鲁斯省',
    checkInOut: '入住 {entrada} · 退房 {salida}',
  },

  /* ──────────────────────── contenido de la portada ──────────────────────── */
  contenido: {
    manifiestoDatos: ['阿根廷湖，尽收眼底', '佩里托莫雷诺冰川，80 公里', '大堂里的柴火壁炉'],
    manifiestoFoto: '从露台望向大堂的落地窗',
    manifiestoSeguir: '继续向下滑动',
    manifiestoEtiqueta: 'Blanca Patagonia',
    manifiesto: '玻璃窗外是一汪碧蓝的湖水。冰川，一小时车程。归来时，炉火已经点燃。',
    habitaciones: [
      { nombre: '标准间', capacidad: '单人、双人或三人', detalle: '单人床或双人床。温馨雅致，设计细节精巧。' },
      { nombre: '高级间', capacidad: '单人或双人', detalle: '空间更大，同样可眺望湖泊、海湾和孤独岛。' },
      { nombre: '主套房', capacidad: '双人', detalle: '双人床，旅馆中视野最开阔的房间。' },
    ],
    cabanas: [
      { nombre: '1 间卧室', capacidad: '2 至 3 人' },
      { nombre: '2 间卧室', capacidad: '最多 5 人' },
      { nombre: '3 间卧室', capacidad: '最多 7 人' },
    ],
    excursiones: [
      { nombre: '佩里托莫雷诺冰川迷你徒步', detalle: '穿上冰爪在冰川上行走。' },
      { nombre: '冰川全览：乌普萨拉与斯佩加齐尼', detalle: '乘船游览北湾的冰墙。' },
      { nombre: '埃尔查尔滕与沙漠湖', detalle: '徒步菲茨罗伊峰、漂流，以及山脚下的湖泊。' },
    ],
    incluido: [
      '落地窗前的自助早餐',
      '全酒店 Wi-Fi',
      '按摩浴缸（旅馆）',
      '壁炉与烧烤炉（小屋）',
      '室内停车场',
      '中央供暖',
      '有线电视与保险箱',
      '每日客房清洁',
      '可容纳 6 人的公共按摩池',
      '酒吧',
    ],
    conCargo: ['机场接送', '远足便当', '洗衣服务', '山地自行车'],
    preguntas: [
      {
        p: '建议住几晚？',
        r: '至少三晚。佩里托莫雷诺冰川需要一整天，乘船游览需要一天，第三天可以去埃尔查尔滕，或者什么都不做。只住两晚会很匆忙。',
      },
      {
        p: '什么季节最好？',
        r: '十月到四月所有景点开放，白天更长；一月份太阳要到晚上十点后才落山。冬季游客更少，冰川依然在那里。风全年都是这里的一部分。',
      },
      {
        p: '提供机场接送吗？',
        r: '提供，需额外付费并提前预约。埃尔卡拉法特机场（FTE）距离 23 公里，约 20 分钟。',
      },
      { p: '有停车场吗？', r: '有，室内停车，住客免费。' },
      { p: '含早餐吗？', r: '始终包含，旅馆和小屋都有。自助早餐在大堂落地窗前供应。' },
      {
        p: '可以用比索付款吗？',
        r: '可以。价格以美元公布，可按当日汇率以比索支付，或使用国际信用卡。',
      },
    ],
    alt: {
      ventanal: '旅馆大堂，日落时分落地窗外是阿根廷湖，壁炉燃着柴火',
      hosteria: '旅馆套房，配有按摩浴缸、壁炉和石墙',
      cabana: '小屋客厅，石砌壁炉，窗外是阿根廷湖',
      galeria: ['可眺望湖景的高级客房', '石墙前的床铺细节', '小屋的厨房与餐厅', '小屋卧室'],
      lavandaCampo: '酒店的薰衣草田，背景是阿根廷湖',
      lavandaCanasto: '一篮刚采摘的薰衣草',
      lavandaDetalle: '薰衣草花特写',
      cena: '壁炉旁摆好的餐桌',
      picada: '炉火前的奶酪冷肉拼盘与葡萄酒',
      entorno: '俯瞰埃尔卡拉法特的酒店及其周边',
    },
  },

  /* ─────────────────────────── ficha de alojamiento ───────────────────────── */
  ficha: {
    temporadas: { baja: '淡季', media: '平季', alta: '旺季' },
    vigenteHasta: '{temporada} · 至 {fecha}',
    proximaDesde: '{temporada} · {fecha} 起',
    impuestos: '含税费',
    porNocheCorto: '/ 晚',
    verTarifas: '查看价格与空房',
    verDetalles: '查看住宿详情',
    fotoAnterior: '上一张',
    fotoSiguiente: '下一张',
    fotoN: '第 {n} 张，共 {total} 张',
    galeriaNota: '第一张照片为本住宿；其余为同类别其他住宿。',
    comodidades: '设施',
    precioSegunFechas: '最终价格取决于您选择的日期。',
    noEncontrado: '未找到该住宿',
    metaDescripcion: '埃尔卡拉法特的{categoria}，可住{capacidad}。',
    sinTarifas: '该住宿的价格尚未公布。',
    porNocheIvaIncluido: '每晚，含增值税',
    preciosTitulo: '各季节价格',
    preciosDescripcion: '每晚价格（美元，含增值税）。季节按每晚的日期确定。',
    preciosLeyenda: '{nombre} 各季节每晚价格及适用日期',
    temporada: '季节',
    fechas: '日期',
    porNoche: '每晚',
    aConfirmar: '待确认',
    rango: '{desde} 至 {hasta}',
    horarios: '时间',
    horariosValor: '{entrada} 起入住 · {salida} 前退房',
    mascotas: '宠物',
    conMascotas: '可携带宠物。',
    sinMascotas: '不可携带宠物。',
    cancelacion: '取消政策',
    cancelacionTexto: '提前 14 天以上取消免费。提前 14 至 7 天取消收取首晚费用，7 天内取消收取全部住宿费用。',
    otrasOpciones: '其他选择：{categoria}',
  },

  /* ──────────────────────── categorías y capacidad ───────────────────────── */
  categorias: {
    hosteria: '精品旅馆',
    cabana: '小屋',
    capacidadUna: '1 人',
    capacidadVarias: '最多 {n} 人',
    ultimaLibre: '这些日期仅剩最后一间',
  },

  /* ──────────────────────────────── checkout ──────────────────────────────── */
  checkout: {
    campoObligatorio: '此项为必填',
    tarjetasAceptadas: '可用银行卡',
    resumenTitulo: '住宿摘要',
    nocheDel: '{fecha} 晚',
    subtotal: '小计',
    iva: '增值税',
    seniaAhora: '现需支付定金',
    saldoRestante: '剩余余额',
    pagoTitulo: '付款方式',
    pagoTexto: '请选择定金的支付方式。我们会将您转到支付服务商的安全页面填写银行卡：我们从不查看或保存卡信息。',
    pagarDespues: '现在预订，稍后付款',
    pagarDespuesDetalle: '我们会通过邮件发送定金付款链接。预订将保留 {dias} 天。',
    alCambio: '{usd}，汇率 {tasa} / 美元',
    medioStripe: '国际信用卡',
    medioStripeDetalle: '适用于境外客人。以美元收取，无需换汇。',
    medioMercadoPago: 'MercadoPago 及本地支付',
    medioMercadoPagoDetalle: '以阿根廷比索支付，可分期或一次付清。',
    formasMercadoPago: ['信用卡', '借记卡', 'MercadoPago 余额', '现金（Rapipago 和 Pago Fácil）'],
    medioSimulado: '模拟支付（演示）',
    medioSimuladoDetalle: '不会产生任何扣款。用于测试完整的支付流程。',
    sinMedios: '目前无法在线支付。请先预订，我们会写信与您商定定金。',
    pedidoEspecial: '特殊要求',
    pedidoAyuda: '选填：抵达时间、婴儿床、庆祝活动……前台会在您抵达前查看。',
    promociones: '我希望通过邮件接收酒店的最新消息和优惠。可随时退订。',
    condiciones: '我接受预订条款和取消政策。',
    errorCondiciones: '预订前需要接受条款。',
    errorMedio: '请选择付款方式。',
    confirmarYPagar: '确认并支付定金',
    redirigiendo: '正在打开安全支付…',
    pagoSeguro: '安全支付。我们从不保存您的银行卡信息。',
    titulo: '即将完成',
    descripcion: '请确认信息无误，并告诉我们如何联系您。',
    volverOpciones: '返回选项',
    desdeLas: '{hora} 起',
    hastaLas: '{hora} 前',
    total: '总价',
    ivaIncluido: '含增值税',
    senia: '预订定金',
    seniaNota: '（相当于第一晚房费）',
    tusDatos: '您的信息',
    apellido: '姓',
    nombre: '名',
    email: '电子邮箱',
    emailAyuda: '我们会将带有预订编号的确认函发送到这里。',
    telefono: '电话',
    telefonoAyuda: '选填。如您抵达时有任何情况，方便我们通知您。',
    confirmar: '确认预订',
    reservando: '正在预订…',
    nadaAhora: '现在不会收取任何费用。预订已为您保留，我们会写信与您商定定金，金额相当于第一晚房费。',
    requerido: '必填',
    errorIncompleto: '预订信息不完整。',
    errorApellidoEmail: '请填写您的姓和电子邮箱。',
    errorEmail: '请填写有效的电子邮箱。',
    errorMaxNoches: '住宿不能超过 {n} 晚。',
    errorCapacidad: '该住宿最多可住 {n} 人。',
    errorNoExiste: '该住宿不存在。',
    errorNoDisponible: '该房间在这些日期已无空房。',
    errorLimite: '我们收到了来自您网络的多次提交。请几分钟后再试，或给我们写信，我们通过电话为您处理。',
    errorGenerico: '无法完成预订。请稍后再试，或给我们写信，我们通过邮件为您完成预订。',
  },

  /* ───────────────────────── política de cancelación ──────────────────────── */
  cancelacion: {
    primera: '提前 {n} 天或以上：{cargo}。',
    entre: '提前 {desde} 至 {hasta} 天：{cargo}。',
    menos: '提前不足 {n} 天：{cargo}。',
    ninguno: '免费',
    primera_noche: '收取首晚费用',
    total: '收取全部住宿费用',
  },

  /* ────────────────── comodidades reconocidas del catálogo ───────────────── */
  comodidades: {
    vista: '阿根廷湖景',
    hidromasaje: '按摩浴缸',
    desayuno: '含自助早餐',
    wifi: 'Wi-Fi',
    hogar: '柴火壁炉与烧烤炉',
    cocina: '设备齐全的厨房',
    calefaccion: '中央供暖',
    tv: '有线电视',
    estacionamiento: '室内停车场',
    caja: '保险箱',
  },

  /* ─────────────────────────── pasos de la reserva ────────────────────────── */
  pasos: {
    fechas: '日期',
    alojamiento: '住宿',
    datos: '您的信息',
    confirmacion: '确认',
    paso: '第 {n} 步，共 {total} 步',
    progreso: '预订进度',
  },
}
