import { describe, it, expect } from 'vitest'
import {
  PARAMETROS_WHATSAPP,
  PLANTILLAS_WHATSAPP,
  canalDelAviso,
  telefonoParaWhatsApp,
  tienePlantillaWhatsApp,
} from '@/lib/domain/whatsapp'
import { EVENTOS_INTERNOS, PLANTILLAS, type EventoEmail } from '@/lib/domain/plantillas'

/**
 * El canal de WhatsApp.
 *
 * Lo que se prueba acá es **por dónde sale cada aviso** y **si el teléfono
 * sirve**. El envío en sí lo hace la Cloud API de Meta y no se puede probar sin
 * credenciales; lo que sí se puede fijar son las reglas que deciden antes.
 */

describe('el teléfono que WhatsApp acepta', () => {
  it('saca todo lo que no sea dígito', () => {
    // Meta quiere sólo dígitos: sin `+`, espacios, guiones ni paréntesis.
    expect(telefonoParaWhatsApp('+54 9 2902 12-3456')).toBe('5492902123456')
    expect(telefonoParaWhatsApp('(54) 9 2902 123456')).toBe('5492902123456')
  })

  it('rechaza lo que no tiene código de país', () => {
    /*
      ⚠️ No se le antepone `54` a lo que parece argentino.

      El hotel es internacional: la mitad de sus huéspedes son de afuera, y
      ponerle 54 adelante a un número europeo lo manda a un desconocido en Río
      Gallegos. Sin código de país, el aviso cae al correo.
    */
    expect(telefonoParaWhatsApp('2902 123456')).toBeNull()
    expect(telefonoParaWhatsApp('123456')).toBeNull()
  })

  it('rechaza vacío, nulo y basura', () => {
    expect(telefonoParaWhatsApp(null)).toBeNull()
    expect(telefonoParaWhatsApp(undefined)).toBeNull()
    expect(telefonoParaWhatsApp('')).toBeNull()
    expect(telefonoParaWhatsApp('sin teléfono')).toBeNull()
    // Más de 15 dígitos no es un número: E.164 corta ahí.
    expect(telefonoParaWhatsApp('1234567890123456789')).toBeNull()
  })
})

describe('por dónde sale cada aviso', () => {
  const TEL = '+5492902123456'

  it('los internos van a la cartelera, aunque haya WhatsApp', () => {
    // No salen del sistema: el destinatario es un puesto del hotel, no una
    // persona con teléfono.
    for (const e of EVENTOS_INTERNOS) {
      expect(canalDelAviso(e, { telefono: TEL, whatsappActivo: true })).toBe('interno')
    }
  })

  it('sin WhatsApp configurado, todo sale por correo', () => {
    expect(canalDelAviso('confirmacion_reserva', { telefono: TEL, whatsappActivo: false })).toBe(
      'email',
    )
  })

  it('con WhatsApp pero sin plantilla aprobada, sale por correo', () => {
    /*
      Fuera de la ventana de 24 horas, Meta sólo acepta plantillas aprobadas por
      ellos. Un evento sin plantilla mandado igual sería rechazado por la API y el
      huésped no recibiría nada — el correo sí llega.
    */
    expect(tienePlantillaWhatsApp('reserva_cancelada')).toBe(false)
    expect(canalDelAviso('reserva_cancelada', { telefono: TEL, whatsappActivo: true })).toBe('email')
  })

  it('con WhatsApp pero sin teléfono usable, sale por correo', () => {
    expect(canalDelAviso('confirmacion_reserva', { telefono: null, whatsappActivo: true })).toBe(
      'email',
    )
    expect(
      canalDelAviso('confirmacion_reserva', { telefono: '2902 1234', whatsappActivo: true }),
    ).toBe('email')
  })

  it('con todo dado, sale por WhatsApp', () => {
    expect(canalDelAviso('confirmacion_reserva', { telefono: TEL, whatsappActivo: true })).toBe(
      'whatsapp',
    )
    expect(canalDelAviso('recordatorio_checkin', { telefono: TEL, whatsappActivo: true })).toBe(
      'whatsapp',
    )
  })

  it('devuelve UN canal, nunca dos', () => {
    /*
      Mandar el mismo aviso por correo y por WhatsApp le duplica el mensaje al
      huésped, y además rompe la idempotencia: la clave de la bandeja no incluye
      el canal, así que las dos filas chocarían contra el `unique` y una se
      descartaría en silencio.
    */
    const canal = canalDelAviso('confirmacion_reserva', { telefono: TEL, whatsappActivo: true })
    expect(typeof canal).toBe('string')
    expect(['interno', 'whatsapp', 'email']).toContain(canal)
  })
})

describe('el contrato con las plantillas de Meta', () => {
  it('toda plantilla declarada tiene sus parámetros', () => {
    // Sin la lista de parámetros no se puede armar el envío: `parametrosDe`
    // devolvería null y el aviso quedaría fallido para siempre.
    for (const evento of Object.keys(PLANTILLAS_WHATSAPP) as EventoEmail[]) {
      expect(PARAMETROS_WHATSAPP[evento], `«${evento}» sin parámetros declarados`).toBeTruthy()
      expect(PARAMETROS_WHATSAPP[evento]!.length).toBeGreaterThan(0)
    }
  })

  it('y todo parámetro declarado pertenece a la plantilla del catálogo', () => {
    /*
      ⚠️ El test que evita el error caro.

      WhatsApp numera los huecos (`{{1}}`, `{{2}}`), no los nombra: Meta valida la
      CANTIDAD de parámetros, no el significado. Un nombre que la plantilla del
      catálogo no produce llega como cadena vacía o cruzado con otro, y el mensaje
      sale igual: el huésped recibe el código de reserva donde iba la fecha.
    */
    for (const [evento, nombres] of Object.entries(PARAMETROS_WHATSAPP)) {
      const plantilla = PLANTILLAS[evento as EventoEmail]
      const disponibles = [...plantilla.variables, ...(plantilla.opcionales ?? [])]
      for (const n of nombres!) {
        expect(
          disponibles,
          `«${evento}» pide «${n}», que su plantilla del catálogo no produce`,
        ).toContain(n)
      }
    }
  })

  it('no hay parámetros declarados sin plantilla', () => {
    // Una lista de parámetros huérfana es una plantilla que alguien sacó y se
    // olvidó de limpiar: al volver a agregarla, el orden podría no coincidir.
    for (const evento of Object.keys(PARAMETROS_WHATSAPP)) {
      expect(
        PLANTILLAS_WHATSAPP[evento as EventoEmail],
        `«${evento}» tiene parámetros pero ninguna plantilla`,
      ).toBeTruthy()
    }
  })

  it('ningún evento interno tiene plantilla de WhatsApp', () => {
    // Un aviso interno va a la cartelera. Tener plantilla lo haría alcanzable por
    // un camino que nunca se toma, y confundiría al que lea la lista.
    for (const e of EVENTOS_INTERNOS) {
      expect(PLANTILLAS_WHATSAPP[e], `«${e}» es interno y tiene plantilla`).toBeUndefined()
    }
  })
})
