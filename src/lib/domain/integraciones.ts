/**
 * Catálogo de integraciones (lógica pura, ADR 0043).
 *
 * Es la ÚNICA lista de qué claves usa el sistema, para qué, dónde se consiguen y
 * qué pasa si faltan. La leen la pantalla `/panel/config/integraciones` y el
 * comando `npm run integraciones` (que la importa directo: por eso este archivo
 * no importa nada, y Node lo puede cargar sin compilar).
 *
 * El objetivo es que enchufar algo sea: leer esta ficha, conseguir la clave,
 * pegarla en `.env.local` (o en Vercel) y apretar «Probar». Sin tocar código.
 *
 * ⚠️ Nada de esto guarda ni muestra VALORES: sólo si la variable está cargada.
 */

export type GrupoIntegracion =
  | 'sistema'
  | 'pagos'
  | 'correo'
  | 'administracion'

export const ETIQUETAS_GRUPO: Record<GrupoIntegracion, string> = {
  sistema: 'Base del sistema',
  pagos: 'Cobros',
  correo: 'Correo',
  administracion: 'Facturación, divisas y firma',
}

export const ORDEN_GRUPOS: readonly GrupoIntegracion[] = [
  'sistema',
  'pagos',
  'correo',
  'administracion',
]

export interface VariableIntegracion {
  nombre: string
  /** Sin ella la integración no anda. Las opcionales suman algo, no la habilitan. */
  obligatoria: boolean
  /** Es una clave: nunca se muestra, ni siquiera parcialmente. */
  secreta: boolean
  ayuda: string
  ejemplo?: string
  /** No la exige nadie, pero con ella la conexión es mucho más simple (el botón «Conectar» puede registrar el webhook solo). */
  recomendada?: boolean
}

export interface Integracion {
  id: string
  nombre: string
  grupo: GrupoIntegracion
  paraQue: string
  /**
   * Interruptor que la enciende, cuando lo hay: `PAGO_PROVIDER` tiene que
   * nombrar la pasarela, `EMAIL_PROVIDER` tiene que decir `resend`. Sin él, las
   * claves pueden estar y la integración seguir apagada.
   */
  interruptor?: { variable: string; valor: string; lista?: boolean }
  variables: VariableIntegracion[]
  siFalta: string
  pasos: string[]
  /** Ruta del webhook que hay que registrar del lado del proveedor. */
  webhook?: { ruta: string; nota: string }
  /** Limitación que NO se resuelve con una clave. Se muestra destacada. */
  limitacion?: string
  /** Se puede probar la conexión sin cobrar ni mandar nada. */
  probable: boolean
}

export const INTEGRACIONES: readonly Integracion[] = [
  // ── Base del sistema ───────────────────────────────────────────────────────
  {
    id: 'supabase',
    nombre: 'Base de datos (Supabase)',
    grupo: 'sistema',
    paraQue: 'Donde viven todos los datos del hotel. Sin esto no arranca nada.',
    variables: [
      { nombre: 'NEXT_PUBLIC_SUPABASE_URL', obligatoria: true, secreta: false, ayuda: 'URL del proyecto.', ejemplo: 'https://xxxx.supabase.co' },
      { nombre: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', obligatoria: true, secreta: false, ayuda: 'Clave publicable (sb_publishable_…). Es pública por diseño: la protege RLS.' },
      { nombre: 'SUPABASE_SERVICE_ROLE_KEY', obligatoria: true, secreta: true, ayuda: 'Clave secreta (sb_secret_…). ⚠️ NO es la clave del protocolo S3 del Storage, que se le parece y no sirve.' },
    ],
    siFalta: 'El sistema no arranca.',
    pasos: ['Supabase → Project Settings → API keys.', 'Copiar la URL, la clave publicable y la secreta.'],
    probable: true,
  },
  {
    id: 'sitio',
    nombre: 'Dirección pública y tareas programadas',
    grupo: 'sistema',
    paraQue: 'Los enlaces de los correos, las URL de los webhooks y la autenticación de los crons.',
    variables: [
      { nombre: 'NEXT_PUBLIC_SITE_URL', obligatoria: true, secreta: false, ayuda: 'La dirección donde está publicado el sistema, sin barra al final.', ejemplo: 'https://reservas.blancapatagonia.com' },
      { nombre: 'CRON_SECRET', obligatoria: true, secreta: true, ayuda: 'Cualquier texto largo al azar. Vercel lo manda en cada cron.', ejemplo: 'openssl rand -hex 32' },
      { nombre: 'ENCRYPTION_KEY', obligatoria: false, secreta: true, ayuda: 'Clave AES-256 para cifrar tokens de terceros (ADR 0036). Obligatoria si se conecta Mercado Pago por OAuth.', ejemplo: 'openssl rand -base64 32' },
    ],
    siFalta: 'Los enlaces de los correos apuntan a localhost y los crons responden 401.',
    pasos: ['Definir la dirección final del sistema.', 'Generar CRON_SECRET con `openssl rand -hex 32` y cargarla igual en Vercel.'],
    probable: false,
  },

  // ── Cobros ────────────────────────────────────────────────────────────────
  {
    id: 'mercadopago',
    nombre: 'Mercado Pago',
    grupo: 'pagos',
    paraQue: 'Cobrar en pesos: tarjeta, cuotas, billetera, transferencia y efectivo en Rapipago.',
    interruptor: { variable: 'PAGO_PROVIDER', valor: 'mercadopago', lista: true },
    variables: [
      { nombre: 'MERCADOPAGO_ACCESS_TOKEN', obligatoria: true, secreta: true, ayuda: 'Access token de PRODUCCIÓN (APP_USR-…). El de prueba empieza con TEST-.' },
      { nombre: 'MERCADOPAGO_WEBHOOK_SECRET', obligatoria: true, secreta: true, ayuda: 'La «clave secreta» que muestra la pantalla de Webhooks de la aplicación.' },
      { nombre: 'MERCADOPAGO_APP_ID', obligatoria: false, secreta: false, ayuda: 'Sólo para el botón «Conectar con Mercado Pago» (OAuth).' },
      { nombre: 'MERCADOPAGO_APP_SECRET', obligatoria: false, secreta: true, ayuda: 'Sólo para OAuth, junto con el anterior.' },
    ],
    siFalta: 'No se ofrece pagar con Mercado Pago.',
    pasos: [
      'mercadopago.com.ar/developers → Tus integraciones → Crear aplicación (Checkout Pro).',
      'Credenciales de producción → copiar el Access token.',
      'Webhooks → URL de producción = la de abajo, evento «Pagos» → copiar la clave secreta.',
      'Agregar «mercadopago» a PAGO_PROVIDER (separado por comas si hay más de una).',
    ],
    webhook: { ruta: '/api/webhooks/pagos/mercadopago', nota: 'Evento: Pagos.' },
    probable: true,
  },
  {
    id: 'stripe',
    nombre: 'Stripe',
    grupo: 'pagos',
    paraQue: 'Cobrar en dólares con tarjeta internacional.',
    interruptor: { variable: 'PAGO_PROVIDER', valor: 'stripe', lista: true },
    variables: [
      { nombre: 'STRIPE_SECRET_KEY', obligatoria: true, secreta: true, ayuda: 'sk_live_… (o sk_test_… para probar).' },
      { nombre: 'STRIPE_WEBHOOK_SECRET', obligatoria: true, secreta: true, ayuda: 'whsec_… del endpoint de webhook.' },
    ],
    siFalta: 'No se ofrece pagar con tarjeta internacional.',
    pasos: [
      'dashboard.stripe.com → Developers → API keys → Secret key.',
      'Developers → Webhooks → Add endpoint con la URL de abajo, eventos checkout.session.completed y checkout.session.expired → copiar el Signing secret.',
      'Agregar «stripe» a PAGO_PROVIDER.',
    ],
    webhook: { ruta: '/api/webhooks/pagos/stripe', nota: 'Eventos: checkout.session.completed, checkout.session.expired.' },
    probable: true,
  },
  {
    id: 'payway',
    nombre: 'Payway',
    grupo: 'pagos',
    paraQue: 'Tarjetas locales por el procesador de Prisma (ADR 0038).',
    interruptor: { variable: 'PAGO_PROVIDER', valor: 'payway', lista: true },
    variables: [
      { nombre: 'PAYWAY_PUBLIC_KEY', obligatoria: true, secreta: false, ayuda: 'Clave pública: tokeniza la tarjeta en el navegador.' },
      { nombre: 'PAYWAY_PRIVATE_KEY', obligatoria: true, secreta: true, ayuda: 'Clave privada: ejecuta el pago desde el servidor.' },
      { nombre: 'PAYWAY_INTERNAL_SECRET', obligatoria: true, secreta: true, ayuda: 'Texto al azar propio del sistema (no lo da Payway).', ejemplo: 'openssl rand -hex 32' },
    ],
    siFalta: 'No se ofrece pagar con Payway.',
    pasos: ['Pedir a Payway las credenciales de e-commerce (pública y privada).', 'Generar PAYWAY_INTERNAL_SECRET.', 'Agregar «payway» a PAGO_PROVIDER.'],
    limitacion: 'La conexión no se puede probar sin hacer un pago: Payway no tiene una consulta gratuita para validar la clave.',
    probable: false,
  },

  // ── Correo ────────────────────────────────────────────────────
  {
    id: 'resend',
    nombre: 'Correo (Resend)',
    grupo: 'correo',
    paraQue: 'Confirmaciones de reserva, recordatorios y encuestas por correo.',
    interruptor: { variable: 'EMAIL_PROVIDER', valor: 'resend' },
    variables: [
      { nombre: 'RESEND_API_KEY', obligatoria: true, secreta: true, ayuda: 're_… con permiso de envío.' },
      { nombre: 'EMAIL_FROM', obligatoria: true, secreta: false, ayuda: 'Remitente de un dominio VERIFICADO en Resend.', ejemplo: 'Blanca Patagonia <reservas@blancapatagonia.com>' },
      { nombre: 'RESEND_WEBHOOK_SECRET', obligatoria: false, secreta: true, ayuda: 'whsec_… del webhook. Sin ella no se ven los rebotes.' },
    ],
    siFalta: 'Los correos se escriben en el log del servidor y no salen (en producción el sistema no arranca: ADR 0018).',
    pasos: [
      'resend.com → Domains → agregar el dominio del hotel y cargar los registros DNS que indica.',
      'API Keys → crear una.',
      'EMAIL_PROVIDER=resend.',
    ],
    webhook: { ruta: '/api/webhooks/email/resend', nota: 'Eventos: email.delivered, email.bounced, email.complained, email.opened.' },
    probable: true,
  },

  // ── Administración ────────────────────────────────────────────────────────
  {
    id: 'cotizacion',
    nombre: 'Cotización del dólar',
    grupo: 'administracion',
    paraQue: 'Convertir los precios en dólares a pesos (ADR 0020).',
    interruptor: { variable: 'COTIZACION_PROVIDER', valor: 'dolarapi' },
    variables: [{ nombre: 'DOLARAPI_URL', obligatoria: false, secreta: false, ayuda: 'Sólo si se quiere otra URL que la pública por omisión.' }],
    siFalta: 'Se usa la cotización que cargue un admin a mano.',
    pasos: ['COTIZACION_PROVIDER=dolarapi (fuente pública, sin clave). O «manual» para cargarla a mano.'],
    probable: true,
  },
  {
    id: 'facturacion',
    nombre: 'Factura electrónica (ARCA/AFIP)',
    grupo: 'administracion',
    paraQue: 'Pedir el CAE de cada factura.',
    interruptor: { variable: 'FACTURACION_PROVIDER', valor: 'afip' },
    variables: [],
    siFalta: 'Las facturas se emiten con un CAE simulado.',
    pasos: ['Lo arma el contador con el certificado digital del hotel.'],
    limitacion: 'Falta el certificado digital del hotel y la implementación del proveedor de ARCA: no es una clave que se pegue.',
    probable: false,
  },
]

export type EstadoIntegracion = 'lista' | 'incompleta' | 'apagada' | 'sin_configurar'

export const ETIQUETAS_ESTADO_INTEGRACION: Record<EstadoIntegracion, string> = {
  lista: 'Configurada',
  incompleta: 'Faltan datos',
  apagada: 'Cargada pero apagada',
  sin_configurar: 'Sin configurar',
}

export interface Diagnostico {
  estado: EstadoIntegracion
  faltantes: string[]
  /** Qué hacer, en una frase. */
  indicacion: string | null
}

type Entorno = Record<string, string | undefined>

function cargada(env: Entorno, nombre: string): boolean {
  return Boolean(env[nombre]?.trim())
}

function interruptorEncendido(i: Integracion, env: Entorno): boolean {
  if (!i.interruptor) return true
  const valor = env[i.interruptor.variable]?.trim() ?? ''
  if (i.interruptor.lista) return valor.split(',').map((v) => v.trim()).includes(i.interruptor.valor)
  return valor === i.interruptor.valor
}

/** Variables que usa más de una integración. */
const COMPARTIDAS: ReadonlySet<string> = (() => {
  const cuenta = new Map<string, number>()
  for (const i of INTEGRACIONES) for (const v of i.variables) cuenta.set(v.nombre, (cuenta.get(v.nombre) ?? 0) + 1)
  return new Set([...cuenta].filter(([, n]) => n > 1).map(([nombre]) => nombre))
})()

/**
 * Cómo está una integración según el entorno. No mira valores, sólo presencia
 * (y el interruptor). Que la clave sea VÁLIDA lo dice la prueba de conexión.
 *
 * «Empezada» se decide sólo por las variables PROPIAS: si dos integraciones
 * comparten una variable, cargarla para una no hace que la otra figure como
 * «faltan datos».
 */
export function diagnosticar(i: Integracion, env: Entorno): Diagnostico {
  const encendida = interruptorEncendido(i, env)
  const faltantes = i.variables.filter((v) => v.obligatoria && !cargada(env, v.nombre)).map((v) => v.nombre)
  const empezada =
    i.variables.some((v) => !COMPARTIDAS.has(v.nombre) && cargada(env, v.nombre)) ||
    (i.interruptor !== undefined && encendida)

  if (!empezada) return { estado: 'sin_configurar', faltantes, indicacion: null }
  if (faltantes.length > 0) return { estado: 'incompleta', faltantes, indicacion: `Falta: ${faltantes.join(', ')}.` }
  if (!encendida) {
    return {
      estado: 'apagada',
      faltantes: [],
      indicacion: i.interruptor?.lista
        ? `Agregá «${i.interruptor.valor}» a ${i.interruptor.variable} (separado por comas).`
        : `Poné ${i.interruptor?.variable}=${i.interruptor?.valor}.`,
    }
  }
  return { estado: 'lista', faltantes: [], indicacion: null }
}

/** Todas las variables del catálogo, sin repetir, en orden de aparición. */
export function todasLasVariables(): string[] {
  const vistas = new Set<string>()
  for (const i of INTEGRACIONES) {
    if (i.interruptor) vistas.add(i.interruptor.variable)
    for (const v of i.variables) vistas.add(v.nombre)
  }
  return [...vistas]
}

/** La URL completa de un webhook, para pegar en el proveedor. */
export function urlWebhook(sitio: string | undefined, ruta: string): string {
  const base = (sitio ?? '').trim().replace(/\/+$/, '')
  return base ? `${base}${ruta}` : `(definí NEXT_PUBLIC_SITE_URL)${ruta}`
}

/**
 * ¿La dirección sirve para que un proveedor llame al sistema?
 *
 * Resend y las pasarelas de pago avisan POR HTTP a esta dirección, así que
 * tiene que ser https y alcanzable desde internet. Con `localhost` el proveedor
 * responde que no pudo verificar la URL —un mensaje que no explica que el
 * problema es la dirección—, así que se detecta antes y se dice de frente.
 */
export function urlPublicaValida(url: string | undefined): { valida: boolean; motivo: string | null } {
  const u = (url ?? '').trim()
  if (!u) return { valida: false, motivo: 'Falta NEXT_PUBLIC_SITE_URL: la dirección donde está publicado el sistema.' }
  let host: string
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'https:') {
      return { valida: false, motivo: 'La dirección tiene que ser https. Los proveedores no avisan a una dirección sin candado.' }
    }
    host = parsed.hostname
  } catch {
    return { valida: false, motivo: 'NEXT_PUBLIC_SITE_URL no es una dirección válida.' }
  }
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return { valida: false, motivo: 'La dirección es de tu red local: el proveedor no puede llamarla desde internet. Publicá el sistema o usá un túnel (ver la guía).' }
  }
  return { valida: true, motivo: null }
}
