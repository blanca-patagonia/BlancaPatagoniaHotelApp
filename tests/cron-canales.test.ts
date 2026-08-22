import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Tests del cron de sincronización de canales.
 *
 * ── Qué se verifica y por qué así ───────────────────────────────────────────
 *
 * Este endpoint es la única puerta del sistema que **escribe en la base sin sesión de
 * usuario**: corre con `service_role`, que saltea RLS por completo. Todo lo que lo
 * protege es un secreto en una cabecera, así que lo que hay que probar no es que
 * funcione —eso es lo fácil— sino que **rechace**.
 *
 * La base y el proveedor van falseados a propósito: lo que importa es el borde de
 * autorización y qué se llama (o no) detrás de él, no que Postgres responda.
 */

/** Registro de lo que el handler hizo, para poder afirmar sobre ello. */
let sondeos = 0
let guardados: { origen: string; canal: string }[] = []
let capacidadTraeReservas = true

vi.mock('@/lib/canales', () => ({
  obtenerProveedorCanal: () => ({
    nombre: 'falso',
    esReal: () => true,
    capacidades: () => ({
      publicaDisponibilidad: false,
      traeReservas: capacidadTraeReservas,
      recibeWebhook: false,
      confirmaRecepcion: false,
      trae: { importes: false, contacto: false, huespedes: false, tipoUnidad: true },
    }),
    traerReservas: async () => {
      sondeos += 1
      return []
    },
  }),
}))

vi.mock('@/lib/canales/servicio', () => ({
  guardarEntrantes: async (
    _c: unknown,
    entrantes: readonly unknown[],
    ctx: { origen: string; canal: string },
  ) => {
    guardados.push({ origen: ctx.origen, canal: ctx.canal })
    return {
      leidas: entrantes.length,
      nuevas: 0,
      actualizadas: 0,
      rechazadas: 0,
      motivos: [],
    }
  },
  // Si el handler llamara a esto, el test de abajo lo detecta.
  importarEntrante: async () => {
    throw new Error('el cron NO debe importar')
  },
}))

vi.mock('@/lib/supabase/admin', () => ({ crearClienteAdmin: () => ({}) }))

const SECRETO = 'secreto-de-prueba-1234'

/** Petición al cron con la cabecera que se le indique. */
function pedido(cabeceras: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/canales', {
    method: 'POST',
    headers: cabeceras,
  })
}

async function handler() {
  return (await import('@/app/api/cron/canales/route')).POST
}

describe('cron de canales · autorización', () => {
  beforeEach(() => {
    sondeos = 0
    guardados = []
    capacidadTraeReservas = true
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('SIN CRON_SECRET configurada, rechaza y no sincroniza', async () => {
    /*
      La decisión más importante del endpoint.

      La alternativa —«si el secreto no está, dejá pasar»— convertiría esto en un
      endpoint público que escribe en la base con `service_role`, y el fallo sería
      silencioso justo en producción, que es donde importa. Mismo criterio que el
      ADR 0018 con los proveedores simulados: si falta la configuración, se falla
      fuerte.
    */
    delete process.env.CRON_SECRET

    const POST = await handler()
    const res = await POST(pedido({ authorization: `Bearer ${SECRETO}` }))

    expect(res.status).toBe(503)
    expect(sondeos, 'sondeó el canal sin estar configurado').toBe(0)
    expect(guardados, 'escribió en la base sin estar configurado').toHaveLength(0)
  })

  it('sin cabecera de autorización, 401', async () => {
    process.env.CRON_SECRET = SECRETO

    const POST = await handler()
    const res = await POST(pedido())

    expect(res.status).toBe(401)
    expect(sondeos).toBe(0)
  })

  it('con el secreto equivocado, 401', async () => {
    process.env.CRON_SECRET = SECRETO

    const POST = await handler()
    const res = await POST(pedido({ authorization: 'Bearer otro-secreto-cualquiera' }))

    expect(res.status).toBe(401)
    expect(sondeos).toBe(0)
  })

  it('EL CASO CLAVE: la cabecera x-vercel-cron NO alcanza', async () => {
    /*
      Vercel agrega `x-vercel-cron` a sus llamadas, y es tentador usarla como prueba de
      origen. No lo es: cualquiera la escribe en un `curl`. Sirve para saber quién DICE
      ser el llamador, no para creerle.
    */
    process.env.CRON_SECRET = SECRETO

    const POST = await handler()
    const res = await POST(pedido({ 'x-vercel-cron': '1' }))

    expect(res.status).toBe(401)
    expect(sondeos, 'una cabecera falsificable disparó la sincronización').toBe(0)
  })

  it('el mensaje del 401 no confirma nada sobre el esquema', async () => {
    // Decir «el secreto no coincide» le confirma a quien prueba que el endpoint existe
    // y que espera un Bearer.
    process.env.CRON_SECRET = SECRETO

    const POST = await handler()
    const res = await POST(pedido({ authorization: 'Bearer mal' }))
    const cuerpo = await res.json()

    expect(JSON.stringify(cuerpo)).not.toMatch(/secreto|bearer|cron_secret/i)
  })

  it('con el secreto correcto, sincroniza', async () => {
    process.env.CRON_SECRET = SECRETO

    const POST = await handler()
    const res = await POST(pedido({ authorization: `Bearer ${SECRETO}` }))

    expect(res.status).toBe(200)
    expect(sondeos).toBe(1)
    expect(guardados).toHaveLength(1)
  })
})

describe('cron de canales · qué hace y qué NO hace', () => {
  beforeEach(() => {
    sondeos = 0
    guardados = []
    capacidadTraeReservas = true
    vi.resetModules()
    process.env.CRON_SECRET = SECRETO
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('registra la corrida con origen «cron», para poder distinguirla', async () => {
    // Es lo que permite que la pantalla diga «se sincronizó sola hace 40 minutos», que
    // es la diferencia entre confiar en el sistema y no confiar.
    const POST = await handler()
    await POST(pedido({ authorization: `Bearer ${SECRETO}` }))

    expect(guardados[0].origen).toBe('cron')
    expect(guardados[0].canal).toBe('booking')
  })

  it('ATERRIZA pero NO importa: no crea reservas', async () => {
    /*
      La decisión de diseño del archivo. Importar es crear una reserva `confirmada` que
      ocupa inventario, y hacerlo sin que nadie mire contradice la razón por la que
      existe la zona de recepción (ADR 0021): que el choque con el anti-overbooking sea
      VISIBLE en vez de perderse en un log.

      El mock de `importarEntrante` lanza, así que si el handler lo llamara este test
      fallaría con ese mensaje.
    */
    const POST = await handler()
    const res = await POST(pedido({ authorization: `Bearer ${SECRETO}` }))

    expect(res.status).toBe(200)
    expect(guardados).toHaveLength(1)
  })

  it('con un proveedor que no sondea responde 200, no error', async () => {
    /*
      Con el simulado —o con uno que solo acepta subidas de archivo— no hay nada que
      consultar. Responder error dejaría el cron marcado como fallando para siempre, y
      un trabajo que siempre falla se termina ignorando: cuando falle de verdad, nadie
      va a mirar.
    */
    capacidadTraeReservas = false

    const POST = await handler()
    const res = await POST(pedido({ authorization: `Bearer ${SECRETO}` }))
    const cuerpo = await res.json()

    expect(res.status).toBe(200)
    expect(cuerpo.ok).toBe(true)
    expect(cuerpo.leidas).toBe(0)
    expect(sondeos).toBe(0)
  })

  it('GET hace lo mismo que POST, con la misma autorización', async () => {
    // Vercel Cron dispara con GET. Pelearse con el disparador no aporta nada; dejarlo
    // sin secreto por ser un GET, sí sería un problema.
    const { GET } = await import('@/app/api/cron/canales/route')

    const sinSecreto = await GET(pedido())
    expect(sinSecreto.status).toBe(401)

    const conSecreto = await GET(pedido({ authorization: `Bearer ${SECRETO}` }))
    expect(conSecreto.status).toBe(200)
  })
})
