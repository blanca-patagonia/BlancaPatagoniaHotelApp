import { describe, it, expect } from 'vitest'
import { obtenerProveedor } from '@/lib/payments'

/**
 * Parseo del webhook de pagos: qué se acepta y qué se rechaza.
 *
 * ── Por qué importa aunque no haya pasarela conectada ───────────────────────
 *
 * Es el mismo criterio con el que se corrigió `verificarFirma`: el contrato es lo
 * que va a heredar quien enchufe MercadoPago o Stripe, y un contrato mal hecho se
 * copia sin leerlo. Acá el defecto era doble:
 *
 *  · `estado ?? 'aprobado'` — fail-open sobre dinero: un evento sin el campo se
 *    convertía en un cobro aprobado que nadie hizo.
 *  · `cuerpo.estado as EstadoPago` — un cast que no verifica nada: un valor fuera
 *    del enum pasaba el tipado y explotaba en el `insert`, dejando a la pasarela
 *    reintentando en bucle un evento que nunca va a entrar.
 */

const proveedor = obtenerProveedor('mercadopago')!

/** Arma un Request con el cuerpo JSON dado. */
function pedido(cuerpo: unknown): Request {
  return new Request('https://x.local/api/webhooks/pagos/mercadopago', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: { 'content-type': 'application/json' },
  })
}

const VALIDO = {
  external_id: 'mp-123',
  reserva_id: '00000000-0000-0000-0000-000000000001',
  monto: 150,
  tipo: 'senia',
  estado: 'aprobado',
}

describe('parseo del webhook de pagos', () => {
  it('un evento completo y válido se acepta', async () => {
    const e = await proveedor.parsearWebhook(pedido(VALIDO))
    expect(e).not.toBeNull()
    expect(e!.estado).toBe('aprobado')
    expect(e!.tipo).toBe('senia')
    expect(e!.monto).toBe(150)
  })

  it('SIN campo `estado` se RECHAZA: no se da por aprobado', async () => {
    // El caso que motivó el arreglo. Antes devolvía un evento `aprobado`.
    const { estado, ...sinEstado } = VALIDO
    void estado
    expect(await proveedor.parsearWebhook(pedido(sinEstado))).toBeNull()
  })

  it('un estado fuera del enum se rechaza acá y no en el insert', async () => {
    // Antes llegaba a la base, explotaba con un error de enum y devolvía 500, así
    // que la pasarela reintentaba para siempre un evento que nunca iba a entrar.
    expect(
      await proveedor.parsearWebhook(pedido({ ...VALIDO, estado: 'rechazado_por_fraude' })),
    ).toBeNull()
    expect(await proveedor.parsearWebhook(pedido({ ...VALIDO, estado: '' }))).toBeNull()
    expect(await proveedor.parsearWebhook(pedido({ ...VALIDO, estado: 123 }))).toBeNull()
  })

  it('un tipo fuera del enum se rechaza', async () => {
    expect(await proveedor.parsearWebhook(pedido({ ...VALIDO, tipo: 'propina' }))).toBeNull()
  })

  it('sin `tipo` se asume saldo, que es el valor por omisión del negocio', async () => {
    // Acá el default SÍ es correcto: el tipo no decide si se cobra, solo cómo se
    // imputa, y la base tiene el mismo default.
    const { tipo, ...sinTipo } = VALIDO
    void tipo
    const e = await proveedor.parsearWebhook(pedido(sinTipo))
    expect(e?.tipo).toBe('saldo')
  })

  it('los cuatro estados del enum se aceptan', async () => {
    for (const estado of ['pendiente', 'aprobado', 'rechazado', 'reembolsado']) {
      const e = await proveedor.parsearWebhook(pedido({ ...VALIDO, estado }))
      expect(e?.estado, `no se aceptó el estado ${estado}`).toBe(estado)
    }
  })

  it('un monto de cero o negativo se rechaza', async () => {
    expect(await proveedor.parsearWebhook(pedido({ ...VALIDO, monto: 0 }))).toBeNull()
    expect(await proveedor.parsearWebhook(pedido({ ...VALIDO, monto: -5 }))).toBeNull()
  })

  it('sin identificadores se rechaza', async () => {
    expect(await proveedor.parsearWebhook(pedido({ ...VALIDO, external_id: '' }))).toBeNull()
    expect(await proveedor.parsearWebhook(pedido({ ...VALIDO, reserva_id: '' }))).toBeNull()
  })

  it('un cuerpo que no es JSON no rompe: devuelve null', async () => {
    const req = new Request('https://x.local/', { method: 'POST', body: 'no soy json' })
    expect(await proveedor.parsearWebhook(req)).toBeNull()
  })
})
