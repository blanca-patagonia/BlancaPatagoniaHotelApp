import { describe, it, expect } from 'vitest'
import { obtenerProveedor, type ResultadoWebhook } from '@/lib/payments'

/**
 * Parseo del webhook de pagos: qué se acepta, qué se rechaza y qué se ignora.
 *
 * ── Por qué importa ────────────────────────────────────────────────────────
 *
 * El contrato es lo que hereda quien enchufa una pasarela, y un contrato mal
 * hecho se copia sin leerlo. Los defectos que este archivo fija:
 *
 *  · `estado ?? 'aprobado'` — fail-open sobre dinero: un evento sin el campo se
 *    convertía en un cobro aprobado que nadie hizo.
 *  · `cuerpo.estado as EstadoPago` — un cast que no verifica nada: un valor fuera
 *    del enum pasaba el tipado y explotaba en el `insert`, dejando a la pasarela
 *    reintentando en bucle un evento que nunca va a entrar.
 *
 * ── Por qué prueba al simulador y no a MercadoPago ─────────────────────────
 *
 * Antes este archivo usaba `obtenerProveedor('mercadopago')`, que era un stub y
 * parseaba un JSON plano. Hoy MercadoPago es real: su webhook trae sólo un id y
 * el adapter va a buscar el pago a la API. Ese camino se prueba aparte, con la
 * red simulada (`tests/pasarelas-reales.test.ts`). El simulador conserva el
 * formato plano y es el que corresponde probar acá.
 */

const proveedor = obtenerProveedor('simulado')!

/** Arma un Request con el cuerpo JSON dado. */
function pedido(cuerpo: unknown): Request {
  return new Request('https://x.local/api/webhooks/pagos/simulado', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: { 'content-type': 'application/json' },
  })
}

const VALIDO = {
  external_id: 'bp-123',
  reserva_id: '00000000-0000-0000-0000-000000000001',
  monto: 150,
  moneda: 'USD',
  tipo: 'senia',
  estado: 'aprobado',
}

/** El evento, cuando el resultado es uno. Falla el test si no lo es. */
function evento(r: ResultadoWebhook) {
  expect(r.tipo, `se esperaba un evento y vino «${r.tipo}»`).toBe('evento')
  return r.tipo === 'evento' ? r.evento : null!
}

describe('parseo del webhook de pagos', () => {
  it('un evento completo y válido se acepta', async () => {
    const e = evento(await proveedor.parsearWebhook(pedido(VALIDO)))
    expect(e.estado).toBe('aprobado')
    expect(e.tipo).toBe('senia')
    expect(e.monto).toBe(150)
    expect(e.moneda).toBe('USD')
  })

  it('SIN campo `estado` se RECHAZA: no se da por aprobado', async () => {
    // El caso que motivó el arreglo. Antes devolvía un evento `aprobado`.
    const { estado, ...sinEstado } = VALIDO
    void estado
    expect((await proveedor.parsearWebhook(pedido(sinEstado))).tipo).toBe('invalido')
  })

  it('un estado fuera del enum se rechaza acá y no en el insert', async () => {
    // Antes llegaba a la base, explotaba con un error de enum y devolvía 500, así
    // que la pasarela reintentaba para siempre un evento que nunca iba a entrar.
    for (const estado of ['rechazado_por_fraude', '', 123]) {
      const r = await proveedor.parsearWebhook(pedido({ ...VALIDO, estado }))
      expect(r.tipo, `se aceptó el estado ${JSON.stringify(estado)}`).toBe('invalido')
    }
  })

  it('un tipo fuera del enum se rechaza', async () => {
    expect((await proveedor.parsearWebhook(pedido({ ...VALIDO, tipo: 'propina' }))).tipo).toBe(
      'invalido',
    )
  })

  it('sin `tipo` se asume saldo, que es el valor por omisión del negocio', async () => {
    // Acá el default SÍ es correcto: el tipo no decide si se cobra, solo cómo se
    // imputa, y la base tiene el mismo default.
    const { tipo, ...sinTipo } = VALIDO
    void tipo
    expect(evento(await proveedor.parsearWebhook(pedido(sinTipo))).tipo).toBe('saldo')
  })

  it('los cuatro estados del enum se aceptan', async () => {
    for (const estado of ['pendiente', 'aprobado', 'rechazado', 'reembolsado']) {
      const e = evento(await proveedor.parsearWebhook(pedido({ ...VALIDO, estado })))
      expect(e.estado, `no se aceptó el estado ${estado}`).toBe(estado)
    }
  })

  it('un monto de cero o negativo se rechaza', async () => {
    for (const monto of [0, -5]) {
      const r = await proveedor.parsearWebhook(pedido({ ...VALIDO, monto }))
      expect(r.tipo, `se aceptó el monto ${monto}`).toBe('invalido')
    }
  })

  it('sin `external_id` se rechaza: no hay con qué hacerlo idempotente', async () => {
    expect((await proveedor.parsearWebhook(pedido({ ...VALIDO, external_id: '' }))).tipo).toBe(
      'invalido',
    )
  })

  /*
    Cambio deliberado respecto de la versión anterior, que rechazaba el evento
    sin `reserva_id`.

    Hoy la reserva la resuelve el webhook leyendo la fila del pago por su
    `external_id`, que es la fuente autoritativa —la escribió el propio sistema
    al crear el link—. Exigirlo en el evento obligaría a confiar en un dato que
    manda la pasarela para decidir a qué reserva se le imputa la plata, que es
    exactamente al revés de lo que conviene.
  */
  it('sin `reserva_id` se acepta: la reserva sale de la fila del pago', async () => {
    const e = evento(await proveedor.parsearWebhook(pedido({ ...VALIDO, reserva_id: '' })))
    expect(e.externalId).toBe('bp-123')
    expect(e.reservaId).toBe('')
  })

  it('una moneda que el sistema no sabe convertir se rechaza', async () => {
    // Sin conversión, el importe en USD que salda la reserva sería inventado.
    expect((await proveedor.parsearWebhook(pedido({ ...VALIDO, moneda: 'XXX' }))).tipo).toBe(
      'invalido',
    )
  })

  it('acepta pesos, que es como cobra MercadoPago', async () => {
    const e = evento(await proveedor.parsearWebhook(pedido({ ...VALIDO, moneda: 'ARS' })))
    expect(e.moneda).toBe('ARS')
  })

  it('un cuerpo que no es JSON no rompe: se marca inválido', async () => {
    const req = new Request('https://x.local/', { method: 'POST', body: 'no soy json' })
    expect((await proveedor.parsearWebhook(req)).tipo).toBe('invalido')
  })
})
