import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verificarFirmaMeta } from '@/lib/integraciones/firma-meta'

/**
 * La firma de Meta se calcula acá con `node:crypto`, una implementación
 * distinta de la del código (Web Crypto): si las dos coinciden, el HMAC está
 * bien hecho. Reimplementar mal una firma no falla ruidosamente: rechaza TODOS
 * los eventos y el hotel deja de recibir mensajes.
 */
const cuerpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
const firma = (secreto: string, texto = cuerpo) => `sha256=${createHmac('sha256', secreto).update(texto).digest('hex')}`

describe('verificarFirmaMeta', () => {
  it('acepta la firma correcta del cuerpo crudo', async () => {
    expect(await verificarFirmaMeta(['secreto-app'], firma('secreto-app'), cuerpo)).toBe(true)
  })

  it('acepta el secreto de Instagram si el de Facebook no coincide', async () => {
    expect(await verificarFirmaMeta(['otro', 'secreto-ig'], firma('secreto-ig'), cuerpo)).toBe(true)
  })

  it('rechaza otro secreto, otro cuerpo, sin prefijo o sin cabecera', async () => {
    expect(await verificarFirmaMeta(['secreto-app'], firma('falso'), cuerpo)).toBe(false)
    expect(await verificarFirmaMeta(['secreto-app'], firma('secreto-app', `${cuerpo} `), cuerpo)).toBe(false)
    expect(await verificarFirmaMeta(['secreto-app'], firma('secreto-app').replace('sha256=', ''), cuerpo)).toBe(false)
    expect(await verificarFirmaMeta(['secreto-app'], null, cuerpo)).toBe(false)
  })

  it('sin ningún secreto configurado no valida nada', async () => {
    expect(await verificarFirmaMeta([undefined, ''], firma(''), cuerpo)).toBe(false)
  })

  it('la cabecera en mayúsculas también vale (Meta manda hex en minúsculas, pero no se asume)', async () => {
    expect(await verificarFirmaMeta(['s'], firma('s').toUpperCase().replace('SHA256=', 'sha256='), cuerpo)).toBe(true)
  })
})
