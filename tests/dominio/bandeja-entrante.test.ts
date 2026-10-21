import { describe, it, expect } from 'vitest'
import {
  interpretarCorreoRecibido,
  interpretarMensajeriaMeta,
  interpretarTelegram,
  interpretarWhatsApp,
  separarRemitente,
} from '@/lib/domain/bandeja-entrante'

/**
 * Los payloads son los que documenta cada API (y los que usan las fixtures de
 * Chatwoot en `spec/`), recortados a lo que se lee.
 */

const whatsapp = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '123' }, ...value } }] }],
})

describe('WhatsApp Cloud API', () => {
  it('mensaje de texto con nombre de perfil', () => {
    const r = interpretarWhatsApp(
      whatsapp({
        contacts: [{ profile: { name: 'Ana López' }, wa_id: '5492902123456' }],
        messages: [{ from: '5492902123456', id: 'wamid.A', timestamp: '1760000000', type: 'text', text: { body: 'Hola, ¿tienen lugar?' } }],
      }),
    )
    expect(r.mensajes).toEqual([
      {
        canal: 'whatsapp',
        externoContacto: '5492902123456',
        nombre: 'Ana López',
        telefono: '+5492902123456',
        externoMensaje: 'wamid.A',
        contenido: 'Hola, ¿tienen lugar?',
        adjuntos: [],
        creadoEn: new Date(1760000000 * 1000).toISOString(),
        tipo: 'entrante',
      },
    ])
  })

  it('imagen con pie, botón y lista interactiva', () => {
    const r = interpretarWhatsApp(
      whatsapp({
        messages: [
          { from: '1', id: 'w1', timestamp: '1', type: 'image', image: { id: 'MEDIA1', caption: 'la ventana', mime_type: 'image/jpeg' } },
          { from: '1', id: 'w2', timestamp: '2', type: 'button', button: { text: 'Confirmar' } },
          { from: '1', id: 'w3', timestamp: '3', type: 'interactive', interactive: { list_reply: { title: 'Suite' } } },
        ],
      }),
    )
    expect(r.mensajes.map((m) => m.contenido)).toEqual(['la ventana', 'Confirmar', 'Suite'])
    expect(r.mensajes[0].adjuntos).toEqual([{ tipo: 'imagen', nombre: 'media:MEDIA1', mime: 'image/jpeg' }])
  })

  it('ubicación con enlace a mapas', () => {
    const r = interpretarWhatsApp(
      whatsapp({ messages: [{ from: '1', id: 'w', timestamp: '1', type: 'location', location: { latitude: -50.3, longitude: -72.2, name: 'Glaciar' } }] }),
    )
    expect(r.mensajes[0].contenido).toBe('Glaciar')
    expect(r.mensajes[0].adjuntos[0]).toEqual({ tipo: 'ubicacion', url: 'https://www.google.com/maps?q=-50.3,-72.2' })
  })

  it('estados de entrega, con el error de un fallido', () => {
    const r = interpretarWhatsApp(
      whatsapp({
        statuses: [
          { id: 'wamid.X', status: 'read', recipient_id: '1' },
          { id: 'wamid.Y', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }] },
          { id: 'wamid.Z', status: 'desconocido' },
        ],
      }),
    )
    expect(r.estados).toEqual([
      { externoMensaje: 'wamid.X', estado: 'leido', error: undefined },
      { externoMensaje: 'wamid.Y', estado: 'fallido', error: '131047 Re-engagement message' },
    ])
  })

  it('un eco (escrito desde la app del teléfono) entra como saliente, a nombre del destinatario', () => {
    const r = interpretarWhatsApp(whatsapp({ message_echoes: [{ from: 'HOTEL', to: '549111', id: 'e1', timestamp: '5', type: 'text', text: { body: 'Te esperamos' } }] }))
    expect(r.mensajes[0]).toMatchObject({ tipo: 'saliente', externoContacto: '549111', contenido: 'Te esperamos' })
  })

  it('otro objeto, basura o mensajes sin id: nada', () => {
    expect(interpretarWhatsApp({ object: 'page' })).toEqual({ mensajes: [], estados: [] })
    expect(interpretarWhatsApp('basura')).toEqual({ mensajes: [], estados: [] })
    expect(interpretarWhatsApp(whatsapp({ messages: [{ from: '1', type: 'text' }] })).mensajes).toEqual([])
  })
})

describe('Instagram y Messenger', () => {
  const evento = (objeto: string, messaging: unknown[]) => ({ object: objeto, entry: [{ id: 'CUENTA', time: 1, messaging }] })

  it('mensaje de Instagram con adjunto', () => {
    const r = interpretarMensajeriaMeta(
      evento('instagram', [
        {
          sender: { id: 'IGSID' },
          recipient: { id: 'CUENTA' },
          timestamp: 1760000000000,
          message: { mid: 'm1', text: 'Hola', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] },
        },
      ]),
      'CUENTA',
    )
    expect(r.mensajes[0]).toMatchObject({
      canal: 'instagram',
      externoContacto: 'IGSID',
      externoMensaje: 'm1',
      contenido: 'Hola',
      tipo: 'entrante',
      adjuntos: [{ tipo: 'imagen', url: 'https://cdn/x.jpg' }],
    })
  })

  it('un eco es saliente y el contacto es el destinatario', () => {
    const r = interpretarMensajeriaMeta(
      evento('instagram', [{ sender: { id: 'CUENTA' }, recipient: { id: 'IGSID' }, timestamp: 1, message: { mid: 'm2', text: 'Gracias', is_echo: true } }]),
    )
    expect(r.mensajes[0]).toMatchObject({ tipo: 'saliente', externoContacto: 'IGSID' })
  })

  it('el remitente igual a la cuenta propia también es eco, aunque falte is_echo', () => {
    const r = interpretarMensajeriaMeta(
      evento('page', [{ sender: { id: 'PAGINA' }, recipient: { id: 'PSID' }, timestamp: 1, message: { mid: 'm3', text: 'x' } }]),
      'PAGINA',
    )
    expect(r.mensajes[0]).toMatchObject({ canal: 'messenger', tipo: 'saliente', externoContacto: 'PSID' })
  })

  it('un mensaje borrado no entra; las URL que no son https se descartan', () => {
    const r = interpretarMensajeriaMeta(
      evento('instagram', [
        { sender: { id: 'A' }, recipient: { id: 'B' }, timestamp: 1, message: { mid: 'b', is_deleted: true } },
        { sender: { id: 'A' }, recipient: { id: 'B' }, timestamp: 1, message: { mid: 'c', attachments: [{ type: 'image', payload: { url: 'http://x' } }] } },
      ]),
    )
    expect(r.mensajes).toHaveLength(1)
    expect(r.mensajes[0].adjuntos).toEqual([{ tipo: 'imagen', url: undefined }])
  })

  it('entregas de Messenger y lecturas de Instagram', () => {
    expect(interpretarMensajeriaMeta(evento('page', [{ sender: { id: 'P' }, recipient: { id: 'X' }, delivery: { mids: ['a', 'b'] } }])).estados).toEqual([
      { externoMensaje: 'a', estado: 'entregado' },
      { externoMensaje: 'b', estado: 'entregado' },
    ])
    expect(interpretarMensajeriaMeta(evento('instagram', [{ sender: { id: 'P' }, recipient: { id: 'X' }, read: { mid: 'z' } }])).estados).toEqual([
      { externoMensaje: 'z', estado: 'leido' },
    ])
  })
})

describe('Telegram', () => {
  const update = (chat: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    update_id: 1,
    message: { message_id: 77, date: 1760000000, chat, from: { id: 9, first_name: 'Juan', last_name: 'Pérez' }, text: 'Hola', ...extra },
  })

  it('chat privado: el id del mensaje lleva el chat delante (los ids son por chat)', () => {
    const r = interpretarTelegram(update({ id: 9, type: 'private' }))
    expect(r.mensajes[0]).toMatchObject({ canal: 'telegram', externoContacto: '9', externoMensaje: 'tg:9:77', nombre: 'Juan Pérez', contenido: 'Hola' })
  })

  it('un grupo se ignora: no es un huésped', () => {
    expect(interpretarTelegram(update({ id: -100, type: 'group' })).mensajes).toEqual([])
  })

  it('el contacto compartido por el propio huésped aporta su teléfono; uno ajeno no', () => {
    expect(interpretarTelegram(update({ id: 9, type: 'private' }, { contact: { user_id: 9, phone_number: '+5492902123456' } })).mensajes[0].telefono).toBe('+5492902123456')
    expect(interpretarTelegram(update({ id: 9, type: 'private' }, { contact: { user_id: 5, phone_number: '+1' } })).mensajes[0].telefono).toBeUndefined()
  })
})

describe('correo recibido (Resend Inbound)', () => {
  it('separa nombre y dirección del remitente', () => {
    expect(separarRemitente('"Ana López" <Ana@Mail.com>')).toEqual({ nombre: 'Ana López', email: 'ana@mail.com' })
    expect(separarRemitente('ana@mail.com')).toEqual({ email: 'ana@mail.com' })
    expect(separarRemitente('sin direccion')).toEqual({})
  })

  it('texto sin la cita, asunto y Message-ID como clave', () => {
    const r = interpretarCorreoRecibido({
      id: 'r1',
      from: 'ana@mail.com',
      headers: { from: 'Ana <ana@mail.com>' },
      subject: 'Re: Tu consulta',
      text: 'Sí, confirmo.\n\nEl lun 20 oct, Recepción escribió:\n> ¿Confirmás?',
      message_id: '<abc@mail.com>',
      created_at: '2026-10-21T10:00:00Z',
      attachments: [
        { filename: 'logo.png', content_type: 'image/png', content_disposition: 'inline' },
        { filename: 'dni.pdf', content_type: 'application/pdf', content_disposition: null },
      ],
    })
    expect(r.mensajes[0]).toMatchObject({
      canal: 'email',
      externoContacto: 'ana@mail.com',
      nombre: 'Ana',
      email: 'ana@mail.com',
      externoMensaje: '<abc@mail.com>',
      contenido: 'Sí, confirmo.',
      asunto: 'Re: Tu consulta',
      adjuntos: [{ tipo: 'archivo', nombre: 'dni.pdf', mime: 'application/pdf' }],
    })
  })

  it('sin texto, usa el HTML (también en data URI base64)', () => {
    const html = `data:text/html;base64,${btoa('<p>Hola desde HTML</p>')}`
    const r = interpretarCorreoRecibido({ from: 'a@b.com', html, message_id: '<x@b.com>' })
    expect(r.mensajes[0].contenido).toBe('Hola desde HTML')
  })

  it('un correo de la propia dirección del hotel no es de un huésped', () => {
    const r = interpretarCorreoRecibido({ from: 'reservas@hotel.com', text: 'x', message_id: '<y>' }, 'Blanca <reservas@hotel.com>')
    expect(r.mensajes).toEqual([])
  })
})
