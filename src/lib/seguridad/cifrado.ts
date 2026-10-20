import 'server-only'

/**
 * Cifrado simétrico de credenciales de terceros en reposo (ADR 0036).
 *
 * Para el `access_token`/`refresh_token` de una conexión OAuth2
 * (`conexiones_proveedores`): son credenciales que el PROVEEDOR emitió, no
 * este sistema, y con ellas se opera la cuenta real del hotel desde afuera.
 * RLS protege la fila del resto del staff; esto protege el valor si alguna
 * vez alguien lee la tabla con `service_role` sin deber hacerlo.
 *
 * `crypto.subtle` (Web Crypto), no el módulo `crypto` de Node: mismo criterio
 * que `lib/integraciones/firma-webhook.ts`, compatible con Edge Runtime y sin
 * agregar una dependencia.
 *
 * Formato del texto cifrado: base64(iv[12] || ciphertext || tag[16]) — un solo
 * string, listo para guardar en una columna `text`. AES-GCM ya devuelve el tag
 * de autenticación pegado al final del `ciphertext`; no hace falta separarlo
 * a mano.
 */

const ALGORITMO = 'AES-GCM'
const LARGO_IV = 12 // bytes recomendados para GCM

function claveInvalida(motivo: string): never {
  throw new Error(
    `ENCRYPTION_KEY inválida: ${motivo}. Tiene que ser una clave AES-256 de 32 bytes en base64 ` +
      '(generarla con `openssl rand -base64 32`).',
  )
}

async function importarClave(): Promise<CryptoKey> {
  const b64 = process.env.ENCRYPTION_KEY?.trim()
  if (!b64) claveInvalida('falta la variable de entorno')

  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  } catch {
    return claveInvalida('no es base64 válido')
  }
  if (bytes.length !== 32) {
    claveInvalida(`tiene ${bytes.length} bytes, hacen falta 32 (AES-256)`)
  }

  // `bytes` tipa como `Uint8Array<ArrayBufferLike>` y `importKey` pide
  // `Uint8Array<ArrayBuffer>`: es un desajuste de los tipos de lib.dom.d.ts,
  // no un problema real en tiempo de ejecución (`Uint8Array.from` siempre
  // reserva un `ArrayBuffer` propio, nunca un `SharedArrayBuffer`).
  return crypto.subtle.importKey('raw', bytes as BufferSource, ALGORITMO, false, [
    'encrypt',
    'decrypt',
  ])
}

function aBase64(bytes: Uint8Array): string {
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario)
}

function deBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** Cifra un texto. Un IV nuevo y aleatorio en cada llamada — nunca reusado. */
export async function cifrar(texto: string): Promise<string> {
  const clave = await importarClave()
  const iv = crypto.getRandomValues(new Uint8Array(LARGO_IV))
  const cifrado = await crypto.subtle.encrypt(
    { name: ALGORITMO, iv },
    clave,
    new TextEncoder().encode(texto),
  )

  const combinado = new Uint8Array(iv.length + cifrado.byteLength)
  combinado.set(iv, 0)
  combinado.set(new Uint8Array(cifrado), iv.length)
  return aBase64(combinado)
}

/**
 * Descifra un texto cifrado con `cifrar()`.
 *
 * Si `ENCRYPTION_KEY` cambió desde que se cifró, o el valor fue manipulado, el
 * tag de autenticación de GCM no valida y `crypto.subtle.decrypt` rechaza:
 * llega acá como una excepción, no como un texto corrupto silencioso.
 */
export async function descifrar(cifrado: string): Promise<string> {
  const clave = await importarClave()
  const combinado = deBase64(cifrado)
  const iv = combinado.slice(0, LARGO_IV)
  const datos = combinado.slice(LARGO_IV)

  const descifrado = await crypto.subtle.decrypt({ name: ALGORITMO, iv }, clave, datos)
  return new TextDecoder().decode(descifrado)
}
