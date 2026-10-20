import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cifrar, descifrar } from '@/lib/seguridad/cifrado'

/**
 * Cifrado de credenciales de terceros en reposo (ADR 0036).
 *
 * La clave de prueba es generada para este archivo (`openssl rand -base64
 * 32`), no una real: no protege nada, es solo del tamaño correcto para
 * ejercitar AES-256.
 */
const CLAVE_DE_PRUEBA = 'slwnR7g6cB0Wyx9QeNSva6BAgwbkJVzQD1+ayMntaUo='

beforeEach(() => {
  process.env.ENCRYPTION_KEY = CLAVE_DE_PRUEBA
})

afterEach(() => {
  delete process.env.ENCRYPTION_KEY
})

describe('cifrar / descifrar', () => {
  it('descifra exactamente lo que se cifró', async () => {
    const original = 'ejemplo de valor sensible para el test, no un token real'
    const cifrado = await cifrar(original)
    expect(await descifrar(cifrado)).toBe(original)
  })

  it('dos cifrados del mismo texto NO son iguales (el IV es aleatorio)', async () => {
    const a = await cifrar('mismo-texto')
    const b = await cifrar('mismo-texto')
    expect(a).not.toBe(b)
    // Pero los dos descifran al mismo valor.
    expect(await descifrar(a)).toBe('mismo-texto')
    expect(await descifrar(b)).toBe('mismo-texto')
  })

  it('rechaza descifrar con la clave equivocada', async () => {
    const cifrado = await cifrar('secreto')
    process.env.ENCRYPTION_KEY = 'b3RyYS1jbGF2ZS1kZS0zMi1ieXRlcy1kaXN0aW50YQ=='
    await expect(descifrar(cifrado)).rejects.toThrow()
  })

  it('rechaza sin ENCRYPTION_KEY configurada', async () => {
    delete process.env.ENCRYPTION_KEY
    await expect(cifrar('x')).rejects.toThrow(/ENCRYPTION_KEY/)
  })

  it('rechaza una clave que no tiene 32 bytes', async () => {
    process.env.ENCRYPTION_KEY = btoa('demasiado-corta')
    await expect(cifrar('x')).rejects.toThrow(/32/)
  })

  it('un texto largo (equivalente a un refresh token real) también va y vuelve', async () => {
    const largo = 'valor-de-ejemplo-'.repeat(50) + 'final'
    expect(await descifrar(await cifrar(largo))).toBe(largo)
  })

  it('caracteres no ASCII (por si algún día se cifra texto con acentos)', async () => {
    const texto = 'contraseña con ñ y émojis 🔒'
    expect(await descifrar(await cifrar(texto))).toBe(texto)
  })
})
