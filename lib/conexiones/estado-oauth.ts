import 'server-only'
import { hmacHex, comparacionConstante } from '@/lib/integraciones/firma-webhook'

/**
 * `state` firmado para el flujo OAuth2 de una conexión (Mercado Pago, Google).
 *
 * Reusa el HMAC de `lib/integraciones/firma-webhook.ts` en vez de traer una
 * librería de JWT: la necesidad es la misma —que nadie pueda fabricar un
 * `state` válido— y el mecanismo ya existe y está probado.
 *
 * Formato: `<proveedor>.<nonce>.<timestamp>.<firma>`. El nonce no se guarda en
 * ningún lado (no hay tabla de estados de un solo uso): la ventana de
 * tolerancia corta es la protección real contra un reintento, igual que en
 * los webhooks de pago.
 */

const TOLERANCIA_SEGUNDOS = 5 * 60

function secreto(): string {
  const clave = process.env.ENCRYPTION_KEY?.trim()
  if (!clave) throw new Error('Falta ENCRYPTION_KEY: hace falta para firmar el state de OAuth2.')
  return clave
}

export async function generarState(proveedor: string): Promise<string> {
  const nonce = crypto.randomUUID()
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const mensaje = `${proveedor}.${nonce}.${timestamp}`
  const firma = await hmacHex(secreto(), mensaje)
  return `${mensaje}.${firma}`
}

export interface ResultadoState {
  valido: boolean
  proveedor?: string
  motivo?: string
}

export async function verificarState(
  state: string,
  proveedorEsperado: string,
  ahoraSegundos: number = Math.floor(Date.now() / 1000),
): Promise<ResultadoState> {
  const partes = state.split('.')
  if (partes.length !== 4) return { valido: false, motivo: 'formato inválido' }
  const [proveedor, nonce, timestamp, firmaRecibida] = partes
  if (!proveedor || !nonce || !timestamp || !firmaRecibida) {
    return { valido: false, motivo: 'formato inválido' }
  }
  if (proveedor !== proveedorEsperado) return { valido: false, motivo: 'proveedor no coincide' }

  const enviado = Number(timestamp)
  if (!Number.isFinite(enviado) || Math.abs(ahoraSegundos - enviado) > TOLERANCIA_SEGUNDOS) {
    return { valido: false, motivo: 'expirado' }
  }

  const esperada = await hmacHex(secreto(), `${proveedor}.${nonce}.${timestamp}`)
  if (!comparacionConstante(esperada, firmaRecibida)) {
    return { valido: false, motivo: 'firma inválida' }
  }

  return { valido: true, proveedor }
}
