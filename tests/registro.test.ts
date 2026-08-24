import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * El registro estructurado, y sobre todo lo que NO deja salir.
 *
 * El proveedor de email ya tuvo el problema que este módulo previene: logueaba
 * el cuerpo entero de los correos, y esos cuerpos llevan enlaces con token. Los
 * tokens no caducan, así que cualquiera con acceso de lectura al log tenía
 * credenciales de larga vida.
 *
 * `headers()` de Next se falsea: fuera de una petición lanza, y lo que importa
 * acá es el formato de la línea, no de dónde sale el id.
 */
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-vercel-id': 'iad1::abc123' }),
}))

const { registrarError, registrarAviso, registrarInfo } = await import('@/lib/registro')

/** Captura la última línea emitida y la devuelve ya parseada. */
function capturar(metodo: 'error' | 'warn' | 'info') {
  const espia = vi.spyOn(console, metodo).mockImplementation(() => {})
  return {
    espia,
    ultima: () => JSON.parse(espia.mock.calls.at(-1)![0] as string),
  }
}

describe('registro estructurado', () => {
  let restaurar: (() => void)[] = []

  beforeEach(() => {
    restaurar = []
  })
  afterEach(() => {
    for (const r of restaurar) r()
    vi.restoreAllMocks()
  })

  it('emite una sola línea JSON con nivel, evento y momento', async () => {
    const c = capturar('error')
    restaurar.push(() => c.espia.mockRestore())

    await registrarError('fallo_de_prueba', { reserva: 'BP-1' })

    expect(c.espia).toHaveBeenCalledTimes(1)
    const linea = c.ultima()
    expect(linea.nivel).toBe('error')
    expect(linea.evento).toBe('fallo_de_prueba')
    expect(linea.reserva).toBe('BP-1')
    expect(typeof linea.en).toBe('string')
  })

  it('incluye el id de la petición, que es lo que permite correlacionar', async () => {
    // Sin esto, en un log con varias peticiones entrelazadas no hay forma de
    // saber qué líneas pertenecen al mismo pedido.
    const c = capturar('error')
    restaurar.push(() => c.espia.mockRestore())

    await registrarError('x')
    expect(c.ultima().pedido).toBe('iad1::abc123')
  })

  it('OCULTA los campos sensibles por nombre', async () => {
    const c = capturar('error')
    restaurar.push(() => c.espia.mockRestore())

    await registrarError('intento', {
      token: 'abc-123-secreto',
      password: 'hunter2',
      authorization: 'Bearer xyz',
      reserva: 'BP-9',
    })

    const l = c.ultima()
    expect(l.token).toBe('[oculto]')
    expect(l.password).toBe('[oculto]')
    expect(l.authorization).toBe('[oculto]')
    // Lo que no es sensible sigue saliendo: un log que oculta todo no sirve.
    expect(l.reserva).toBe('BP-9')
  })

  it('OCULTA lo que parece un número de tarjeta, aunque venga dentro de un texto', async () => {
    // La capa que salva cuando el dato viaja anidado en un mensaje de error de
    // la base, que es como se cuela en la práctica.
    const c = capturar('error')
    restaurar.push(() => c.espia.mockRestore())

    await registrarError('pago', {
      detalle: 'la tarjeta 4111111111111111 fue rechazada por el emisor',
    })

    const l = c.ultima()
    expect(l.detalle).not.toContain('4111111111111111')
    expect(l.detalle).toContain('[oculto]')
    // El resto del mensaje se conserva: es lo que hace útil el log.
    expect(l.detalle).toContain('rechazada por el emisor')
  })

  it('un campo que contiene «token» en el nombre también se oculta', async () => {
    const c = capturar('error')
    restaurar.push(() => c.espia.mockRestore())

    await registrarError('portal', { ical_token: 'xyz', tarjeta_numero: '1234' })
    const l = c.ultima()
    expect(l.ical_token).toBe('[oculto]')
    expect(l.tarjeta_numero).toBe('[oculto]')
  })

  it('cada nivel usa el canal de consola que le corresponde', async () => {
    const e = capturar('error')
    const w = capturar('warn')
    const i = capturar('info')
    restaurar.push(() => {
      e.espia.mockRestore()
      w.espia.mockRestore()
      i.espia.mockRestore()
    })

    await registrarError('a')
    await registrarAviso('b')
    await registrarInfo('c')

    expect(e.espia).toHaveBeenCalledTimes(1)
    expect(w.espia).toHaveBeenCalledTimes(1)
    expect(i.espia).toHaveBeenCalledTimes(1)
  })

  it('un dato que no se puede serializar no rompe la operación', async () => {
    // Un log que tira abajo lo que estaba registrando es peor que no tenerlo.
    const c = capturar('error')
    restaurar.push(() => c.espia.mockRestore())

    const circular: Record<string, unknown> = {}
    circular.yo = circular

    await expect(registrarError('circular', circular)).resolves.toBeUndefined()
    expect(c.espia).toHaveBeenCalled()
  })
})
