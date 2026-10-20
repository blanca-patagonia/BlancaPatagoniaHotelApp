import { describe, it, expect } from 'vitest'
import {
  firmar,
  comparacionConstante,
  timestampVigente,
  verificarFirmaWebhook,
} from '@/lib/integraciones/firma-webhook'

/**
 * Antes, `verificarFirma` hacía esto:
 *
 *     req.headers.get('x-webhook-signature') === secreto
 *
 * Un secreto compartido en una cabecera, **sin vínculo con el cuerpo**. Quien lo
 * capturara una vez podía enviar el contenido que quisiera. El primer bloque de
 * este archivo es el que reproduce ese ataque.
 */

const SECRETO = 'secreto-de-prueba'
const AHORA = 1_700_000_000

async function cabecerasFirmadas(cuerpo: string, ts = String(AHORA), secreto = SECRETO) {
  return new Headers({
    'x-webhook-timestamp': ts,
    'x-webhook-signature': await firmar(secreto, ts, cuerpo),
  })
}

describe('verificarFirmaWebhook', () => {
  const cuerpo = JSON.stringify({ external_id: 'mp-1', reserva_id: 'r-1', monto: 100 })

  it('acepta un pedido firmado correctamente', async () => {
    const h = await cabecerasFirmadas(cuerpo)
    expect((await verificarFirmaWebhook(SECRETO, h, cuerpo, AHORA)).valida).toBe(true)
  })

  it('RECHAZA un cuerpo alterado con la misma firma', async () => {
    // Este es el ataque que el esquema anterior no veía: capturar las cabeceras
    // de un pago de 100 y reenviarlas con un cuerpo de 10.000.
    const h = await cabecerasFirmadas(cuerpo)
    const alterado = JSON.stringify({ external_id: 'mp-1', reserva_id: 'r-1', monto: 10000 })
    const r = await verificarFirmaWebhook(SECRETO, h, alterado, AHORA)
    expect(r.valida).toBe(false)
    expect(r.motivo).toMatch(/no coincide/)
  })

  it('rechaza una firma hecha con otro secreto', async () => {
    const h = await cabecerasFirmadas(cuerpo, String(AHORA), 'otro-secreto')
    expect((await verificarFirmaWebhook(SECRETO, h, cuerpo, AHORA)).valida).toBe(false)
  })

  it('rechaza un reenvío viejo, aunque la firma sea válida', async () => {
    const h = await cabecerasFirmadas(cuerpo, String(AHORA - 3600))
    const r = await verificarFirmaWebhook(SECRETO, h, cuerpo, AHORA)
    expect(r.valida).toBe(false)
    expect(r.motivo).toMatch(/tolerancia/)
  })

  it('rechaza un timestamp del futuro lejano', async () => {
    const h = await cabecerasFirmadas(cuerpo, String(AHORA + 3600))
    expect((await verificarFirmaWebhook(SECRETO, h, cuerpo, AHORA)).valida).toBe(false)
  })

  it('rechaza si faltan las cabeceras', async () => {
    const r = await verificarFirmaWebhook(SECRETO, new Headers(), cuerpo, AHORA)
    expect(r.valida).toBe(false)
    expect(r.motivo).toMatch(/faltan/)
  })

  it('acepta dentro de la ventana de tolerancia', async () => {
    const h = await cabecerasFirmadas(cuerpo, String(AHORA - 120))
    expect((await verificarFirmaWebhook(SECRETO, h, cuerpo, AHORA)).valida).toBe(true)
  })
})

describe('comparacionConstante', () => {
  it('reconoce cadenas iguales', () => {
    expect(comparacionConstante('abc123', 'abc123')).toBe(true)
  })

  it('distingue por largo sin comparar contenido', () => {
    expect(comparacionConstante('abc', 'abcd')).toBe(false)
  })

  it('detecta una diferencia en el último carácter', () => {
    // Con `===` esta comparación tarda más que una que difiere en el primero, y
    // esa diferencia permite reconstruir la firma byte a byte.
    expect(comparacionConstante('aaaaaaab', 'aaaaaaac')).toBe(false)
  })
})

describe('timestampVigente', () => {
  it('rechaza un timestamp que no es un número', () => {
    expect(timestampVigente('ayer', AHORA)).toBe(false)
    expect(timestampVigente('', AHORA)).toBe(false)
  })

  it('acepta el borde exacto de la ventana', () => {
    expect(timestampVigente(String(AHORA - 300), AHORA, 300)).toBe(true)
    expect(timestampVigente(String(AHORA - 301), AHORA, 300)).toBe(false)
  })
})
