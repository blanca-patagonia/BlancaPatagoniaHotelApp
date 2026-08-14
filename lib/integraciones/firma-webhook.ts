import 'server-only'

/**
 * Verificación de firma de webhooks entrantes.
 *
 * Qué reemplaza. El stub de pagos comparaba así:
 *
 *     req.headers.get('x-webhook-signature') === secreto
 *
 * Eso no es una firma: es un secreto compartido que viaja en una cabecera, **sin
 * ningún vínculo con el cuerpo del mensaje**. Quien lo capture una sola vez
 * puede enviar el contenido que quiera —«pago aprobado por USD 10.000» sobre
 * cualquier reserva— y el sistema lo acepta. Tampoco había protección contra
 * reenvío: el mismo pedido, repetido mil veces, pasaba mil veces.
 *
 * Hoy ningún proveedor real está conectado. Se corrige igual porque el contrato
 * es lo que va a heredar quien enchufe MercadoPago o Stripe, y un contrato mal
 * hecho se copia sin revisarlo.
 *
 * Esquema implementado (el que usan las pasarelas reales):
 *
 *   firma = HMAC-SHA256(secreto, "<timestamp>.<cuerpo crudo>")
 *
 * con `x-webhook-timestamp` y `x-webhook-signature` en las cabeceras.
 */

/** Ventana de tolerancia para el reenvío. Cinco minutos es lo habitual. */
const TOLERANCIA_SEGUNDOS = 5 * 60

/** Convierte un ArrayBuffer a hexadecimal en minúsculas. */
function aHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Calcula la firma esperada para un cuerpo y un momento dados.
 *
 * Se exporta para poder generarla en los tests y en el simulador de pago sin
 * duplicar el algoritmo, que es justo donde se cuelan las diferencias.
 */
export async function firmar(
  secreto: string,
  timestamp: string,
  cuerpo: string,
): Promise<string> {
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(`${timestamp}.${cuerpo}`))
  return aHex(firma)
}

/**
 * Compara dos cadenas en tiempo constante.
 *
 * Con `===`, JavaScript corta en el primer carácter distinto, y esa diferencia
 * de tiempo —aunque mínima— permite reconstruir una firma válida byte a byte.
 * Acá el recorrido siempre cubre la cadena entera.
 */
export function comparacionConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferencia = 0
  for (let i = 0; i < a.length; i += 1) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diferencia === 0
}

/** ¿El momento declarado está dentro de la ventana de tolerancia? */
export function timestampVigente(
  timestamp: string,
  ahoraSegundos: number,
  tolerancia = TOLERANCIA_SEGUNDOS,
): boolean {
  const enviado = Number(timestamp)
  if (!Number.isFinite(enviado)) return false
  return Math.abs(ahoraSegundos - enviado) <= tolerancia
}

export interface ResultadoVerificacion {
  valida: boolean
  /** Motivo del rechazo, para el log del servidor. Nunca se le muestra a quien llama. */
  motivo?: string
}

/**
 * Verifica la firma de un webhook entrante.
 *
 * El cuerpo tiene que ser el **crudo**, tal como llegó: cualquier parseo y
 * re-serialización previa cambia los espacios y el orden de las claves, y la
 * firma deja de coincidir.
 */
export async function verificarFirmaWebhook(
  secreto: string,
  cabeceras: Headers,
  cuerpoCrudo: string,
  ahoraSegundos: number = Math.floor(Date.now() / 1000),
): Promise<ResultadoVerificacion> {
  const timestamp = cabeceras.get('x-webhook-timestamp')
  const recibida = cabeceras.get('x-webhook-signature')

  if (!timestamp || !recibida) {
    return { valida: false, motivo: 'faltan las cabeceras de firma' }
  }
  if (!timestampVigente(timestamp, ahoraSegundos)) {
    // Sin esto, capturar un pedido válido una vez alcanza para reenviarlo para
    // siempre. Con `pagos.external_id` único el daño estaría acotado, pero la
    // protección no puede depender de una restricción de otra capa.
    return { valida: false, motivo: 'el timestamp está fuera de la ventana de tolerancia' }
  }

  const esperada = await firmar(secreto, timestamp, cuerpoCrudo)
  if (!comparacionConstante(esperada, recibida)) {
    return { valida: false, motivo: 'la firma no coincide con el cuerpo recibido' }
  }

  return { valida: true }
}
