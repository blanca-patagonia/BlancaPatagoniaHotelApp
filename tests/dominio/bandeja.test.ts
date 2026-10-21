import { describe, it, expect } from 'vitest'
import {
  adjuntosDe,
  asuntoDeRespuesta,
  esAvanceMensaje,
  esperaLarga,
  estadoEfectivo,
  iniciales,
  nombreDeContacto,
  pospuestaHasta,
  sinTextoCitado,
  sugerirRespuestas,
  textoDeHtml,
  tiempoEsperando,
  ventanaDeRespuesta,
  vistaPrevia,
} from '@/lib/domain/bandeja'

const HORA = 60 * 60 * 1000
const ahora = new Date('2026-10-21T15:00:00Z')
const haceHoras = (h: number) => new Date(ahora.getTime() - h * HORA).toISOString()

describe('ventanaDeRespuesta (24 h de Meta)', () => {
  it('WhatsApp dentro de las 24 h: abierta, con la hora de cierre', () => {
    const v = ventanaDeRespuesta('whatsapp', haceHoras(2), ahora)
    expect(v.abierta).toBe(true)
    expect(v.cierraEn?.toISOString()).toBe(new Date(ahora.getTime() + 22 * HORA).toISOString())
  })

  it('WhatsApp pasadas las 24 h: cerrada y explica que sólo acepta plantillas', () => {
    const v = ventanaDeRespuesta('whatsapp', haceHoras(25), ahora)
    expect(v.abierta).toBe(false)
    expect(v.motivo).toMatch(/plantillas/)
  })

  it('WhatsApp NO tiene agente humano: cerrada aunque se pida', () => {
    expect(ventanaDeRespuesta('whatsapp', haceHoras(30), ahora, { agenteHumano: true }).abierta).toBe(false)
  })

  it('Instagram con agente humano: abierta hasta 7 días, con la etiqueta', () => {
    const v = ventanaDeRespuesta('instagram', haceHoras(30), ahora, { agenteHumano: true })
    expect(v).toMatchObject({ abierta: true, agenteHumano: true })
    expect(ventanaDeRespuesta('instagram', haceHoras(24 * 8), ahora, { agenteHumano: true }).abierta).toBe(false)
  })

  it('dentro de las 24 h no se manda la etiqueta de agente humano', () => {
    expect(ventanaDeRespuesta('messenger', haceHoras(1), ahora, { agenteHumano: true }).agenteHumano).toBe(false)
  })

  it('sin ningún mensaje del huésped, un canal de Meta no deja iniciar', () => {
    const v = ventanaDeRespuesta('messenger', null, ahora)
    expect(v.abierta).toBe(false)
    expect(v.motivo).toMatch(/iniciar/)
  })

  it('correo, Telegram y web no tienen ventana', () => {
    for (const canal of ['email', 'telegram', 'web'] as const) {
      expect(ventanaDeRespuesta(canal, null, ahora)).toMatchObject({ abierta: true, cierraEn: null })
    }
  })
})

describe('esAvanceMensaje (los avisos de entrega llegan desordenados)', () => {
  it('avanza en orden', () => {
    expect(esAvanceMensaje('pendiente', 'enviado')).toBe(true)
    expect(esAvanceMensaje('enviado', 'entregado')).toBe(true)
    expect(esAvanceMensaje('entregado', 'leido')).toBe(true)
  })

  it('un «entregado» que llega después de «leído» no hace retroceder', () => {
    expect(esAvanceMensaje('leido', 'entregado')).toBe(false)
  })

  it('fallido pisa a enviado pero no a leído', () => {
    expect(esAvanceMensaje('enviado', 'fallido')).toBe(true)
    expect(esAvanceMensaje('leido', 'fallido')).toBe(false)
  })

  it('un fallido no revive y el mismo estado no es avance', () => {
    expect(esAvanceMensaje('fallido', 'entregado')).toBe(false)
    expect(esAvanceMensaje('enviado', 'enviado')).toBe(false)
  })
})

describe('estadoEfectivo y posponer', () => {
  it('una pospuesta vencida se muestra abierta; una vigente, pospuesta', () => {
    expect(estadoEfectivo('pospuesta', haceHoras(1), ahora)).toBe('abierta')
    expect(estadoEfectivo('pospuesta', new Date(ahora.getTime() + HORA).toISOString(), ahora)).toBe('pospuesta')
    expect(estadoEfectivo('resuelta', null, ahora)).toBe('resuelta')
  })

  it('«mañana a las 9» es a las 9 DEL HOTEL (12:00 UTC), no del servidor', () => {
    expect(pospuestaHasta('manana', ahora).toISOString()).toBe('2026-10-22T12:00:00.000Z')
  })

  it('a las 23:30 del hotel (02:30 UTC del día siguiente) «mañana» sigue siendo el día siguiente del hotel', () => {
    const noche = new Date('2026-10-22T02:30:00Z') // 21/10 23:30 en El Calafate
    expect(pospuestaHasta('manana', noche).toISOString()).toBe('2026-10-22T12:00:00.000Z')
  })

  it('una hora y una semana', () => {
    expect(pospuestaHasta('una_hora', ahora).getTime() - ahora.getTime()).toBe(HORA)
    expect(pospuestaHasta('proxima_semana', ahora).getTime() - ahora.getTime()).toBe(7 * 24 * HORA)
  })
})

describe('respuestas guardadas', () => {
  const lista = [
    { atajo: 'checkin', contenido: 'Desde las 15' },
    { atajo: 'checkout', contenido: 'Hasta las 10' },
    { atajo: 'saludo', contenido: 'Hola' },
  ]

  it('sugiere por prefijo cuando el texto entero es «/algo»', () => {
    expect(sugerirRespuestas('/check', lista).map((r) => r.atajo)).toEqual(['checkin', 'checkout'])
    expect(sugerirRespuestas('/', lista)).toHaveLength(3)
  })

  it('una barra en el medio de una frase no sugiere nada', () => {
    expect(sugerirRespuestas('llegamos el 3/12', lista)).toEqual([])
    expect(sugerirRespuestas('hola /saludo', lista)).toEqual([])
  })
})

describe('correo: lo citado no es parte del mensaje', () => {
  it('corta en «El … escribió:»', () => {
    const t = 'Perfecto, confirmo.\n\nEl lun, 20 oct 2026 a las 10:00, Recepción <r@hotel.com> escribió:\n> ¿Confirmás?'
    expect(sinTextoCitado(t)).toBe('Perfecto, confirmo.')
  })

  it('corta en «On … wrote:» y en el separador de Outlook', () => {
    expect(sinTextoCitado('Thanks!\nOn Mon, Oct 20 2026 Front desk wrote:\n> hi')).toBe('Thanks!')
    expect(sinTextoCitado('Gracias\n-----Original Message-----\nFrom: x')).toBe('Gracias')
  })

  it('si sólo hay cita, devuelve el original en vez de vacío', () => {
    expect(sinTextoCitado('> sólo cita')).toBe('> sólo cita')
  })

  it('una línea que empieza con «>» en el medio no corta si sigue texto propio', () => {
    expect(sinTextoCitado('Mirá esto:\n> algo\nY además otra cosa')).toBe('Mirá esto:\n> algo\nY además otra cosa')
  })

  it('HTML a texto plano', () => {
    expect(textoDeHtml('<p>Hola&nbsp;<b>Ana</b></p><br><style>x{}</style>Chau')).toBe('Hola Ana\n\nChau')
  })

  it('«Re:» una sola vez', () => {
    expect(asuntoDeRespuesta('Consulta')).toBe('Re: Consulta')
    expect(asuntoDeRespuesta('RE: Consulta')).toBe('RE: Consulta')
    expect(asuntoDeRespuesta(null)).toMatch(/^Re: /)
  })
})

describe('vista previa y adjuntos', () => {
  it('recorta el texto largo y colapsa espacios', () => {
    expect(vistaPrevia('a   b\n c')).toBe('a b c')
    expect(vistaPrevia('x'.repeat(200), [], 10)).toHaveLength(10)
  })

  it('sin texto muestra qué se mandó', () => {
    expect(vistaPrevia('', [{ tipo: 'imagen' }])).toBe('[Foto]')
  })

  it('adjuntosDe descarta lo que no entiende y las URL que no son http(s)', () => {
    const a = adjuntosDe([{ tipo: 'imagen', url: 'javascript:alert(1)' }, { tipo: 'raro' }, 'x', { tipo: 'audio', url: 'https://x/a.ogg' }])
    expect(a).toEqual([
      { tipo: 'imagen', url: undefined, nombre: undefined, mime: undefined },
      { tipo: 'audio', url: 'https://x/a.ogg', nombre: undefined, mime: undefined },
    ])
    expect(adjuntosDe(null)).toEqual([])
  })
})

describe('tiempos y contacto', () => {
  it('tiempo esperando', () => {
    expect(tiempoEsperando(null, ahora)).toBeNull()
    expect(tiempoEsperando(new Date(ahora.getTime() - 5 * 60_000).toISOString(), ahora)).toBe('5 min')
    expect(tiempoEsperando(haceHoras(3), ahora)).toBe('3 h')
    expect(tiempoEsperando(haceHoras(72), ahora)).toBe('3 d')
  })

  it('espera larga desde la hora', () => {
    expect(esperaLarga(haceHoras(0.5), ahora)).toBe(false)
    expect(esperaLarga(haceHoras(1), ahora)).toBe(true)
  })

  it('nombre a mostrar y avatar', () => {
    expect(nombreDeContacto({ nombre: '', telefono: '+549', email: 'a@b.c' })).toBe('+549')
    expect(nombreDeContacto({ nombre: null })).toBe('Sin nombre')
    expect(iniciales('Ana María López')).toBe('AL')
    expect(iniciales('@ana')).toBe('@')
    expect(iniciales('   ')).toBe('?')
  })
})
