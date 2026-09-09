import 'server-only'
import { comparacionConstante } from './firma-webhook'

/**
 * Verificación de la firma de Svix, que es la que usa Resend.
 *
 * ── Por qué un módulo aparte de `firma-webhook.ts` ──────────────────────────
 *
 * Porque **el mensaje firmado es distinto**. Aquél firma `"<timestamp>.<cuerpo>"`
 * con la clave en texto plano y compara en hexadecimal; Svix firma
 * `"<id>.<timestamp>.<cuerpo>"`, la clave viaja en base64 detrás de un prefijo
 * `whsec_`, y la firma se compara en base64.
 *
 * Reimplementar mal un HMAC no falla ruidosamente: **rechaza todos los eventos**,
 * y el síntoma es que el hotel deja de enterarse de los rebotes — o sea, vuelve
 * al estado que este webhook viene a corregir. Por eso cada diferencia está
 * escrita y hay tests con vectores fijos.
 *
 * Referencia: el esquema publicado por Svix, que Resend documenta como propio.
 */

/** Ventana de tolerancia contra el reenvío. Cinco minutos, igual que la otra. */
const TOLERANCIA_SEGUNDOS = 5 * 60

/** Convierte un ArrayBuffer a base64, que es como Svix publica la firma. */
function aBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario)
}

/** Decodifica base64 a bytes, para la clave secreta. */
function desdeBase64(texto: string): Uint8Array {
  const binario = atob(texto)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i)
  return bytes
}

/**
 * Calcula la firma esperada.
 *
 * ⚠️ La clave se usa **decodificada de base64**, no como texto. Si se firmara
 * con la cadena literal, la firma nunca coincidiría y ningún evento entraría.
 */
export async function firmaSvix(
  secreto: string,
  id: string,
  timestamp: string,
  cuerpo: string,
): Promise<string> {
  // El secreto viene como `whsec_<base64>`; el prefijo no es parte de la clave.
  const limpio = secreto.startsWith('whsec_') ? secreto.slice('whsec_'.length) : secreto

  const clave = await crypto.subtle.importKey(
    'raw',
    desdeBase64(limpio) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const firmado = await crypto.subtle.sign(
    'HMAC',
    clave,
    new TextEncoder().encode(`${id}.${timestamp}.${cuerpo}`),
  )
  return aBase64(firmado)
}

export interface ResultadoSvix {
  valida: boolean
  /** Motivo del rechazo, para el log. Nunca se le devuelve a quien llama. */
  motivo?: string
}

/**
 * Verifica la firma de un webhook de Svix/Resend.
 *
 * El cuerpo tiene que ser el **crudo**: cualquier parseo y re-serialización
 * cambia espacios y orden de claves, y la firma deja de coincidir.
 */
export async function verificarFirmaSvix(
  secreto: string,
  cabeceras: Headers,
  cuerpoCrudo: string,
  ahoraSegundos: number = Math.floor(Date.now() / 1000),
): Promise<ResultadoSvix> {
  const id = cabeceras.get('svix-id')
  const timestamp = cabeceras.get('svix-timestamp')
  const recibidas = cabeceras.get('svix-signature')

  if (!id || !timestamp || !recibidas) {
    return { valida: false, motivo: 'faltan las cabeceras svix' }
  }

  const enviado = Number(timestamp)
  if (!Number.isFinite(enviado) || Math.abs(ahoraSegundos - enviado) > TOLERANCIA_SEGUNDOS) {
    // Sin esto, capturar un evento válido una vez alcanza para reenviarlo para
    // siempre: alguien podría marcar como rebotado cualquier correo del hotel.
    return { valida: false, motivo: 'el timestamp está fuera de la ventana de tolerancia' }
  }

  const esperada = await firmaSvix(secreto, id, timestamp, cuerpoCrudo)

  /*
    ⚠️ La cabecera puede traer VARIAS firmas separadas por espacios, cada una con
    su versión: `v1,<firma> v1,<otra>`. Es lo que permite rotar el secreto sin
    perder eventos durante la transición.

    Comparar la cabecera entera contra una firma sola rechazaría todo justo
    durante una rotación, que es el peor momento para quedarse sin webhook.
  */
  for (const parte of recibidas.split(' ')) {
    const [version, valor] = parte.split(',')
    if (version !== 'v1' || !valor) continue
    if (comparacionConstante(esperada, valor)) return { valida: true }
  }

  return { valida: false, motivo: 'ninguna de las firmas recibidas coincide' }
}
