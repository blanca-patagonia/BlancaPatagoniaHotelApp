import { describe, it, expect } from 'vitest'
import {
  EVENTOS_EMAIL,
  PLANTILLAS,
  esInterno,
  renderizar,
  variablesFaltantes,
  type EventoEmail,
} from '@/lib/domain/plantillas'

describe('catálogo de plantillas', () => {
  it('hay una plantilla por evento', () => {
    for (const e of EVENTOS_EMAIL) {
      expect(PLANTILLAS[e]).toBeDefined()
      expect(PLANTILLAS[e].evento).toBe(e)
    }
  })

  it('cada plantilla declara asunto, cuerpo y disparador', () => {
    for (const e of EVENTOS_EMAIL) {
      const p = PLANTILLAS[e]
      expect(p.asunto.length).toBeGreaterThan(0)
      expect(p.cuerpo.length).toBeGreaterThan(0)
      expect(p.disparador.length).toBeGreaterThan(0)
    }
  })

  it('las variables declaradas son las que usa el texto', () => {
    for (const e of EVENTOS_EMAIL) {
      const p = PLANTILLAS[e]
      const usadas = new Set(
        [...`${p.asunto} ${p.cuerpo}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]),
      )
      /*
        Toda variable usada tiene que estar declarada, y viceversa — contando las
        opcionales.

        Las dos direcciones importan y por motivos distintos: una usada sin
        declarar no se le pide a quien dispara el aviso y **el huésped recibe
        `{{saldo}}` crudo**; una declarada sin usar hace que el aviso figure
        «incompleto» por un dato que no cambia nada.
      */
      const declaradas = [...p.variables, ...(p.opcionales ?? [])]
      expect([...usadas].sort()).toEqual(declaradas.sort())
    }
  })

  it('una variable no puede ser obligatoria y opcional a la vez', () => {
    // Sería ambiguo: `variablesFaltantes` la contaría como faltante y el render
    // la borraría igual.
    for (const e of EVENTOS_EMAIL) {
      const p = PLANTILLAS[e]
      for (const o of p.opcionales ?? []) {
        expect(p.variables, `«${o}» está en las dos listas de ${e}`).not.toContain(o)
      }
    }
  })
})

describe('render', () => {
  const datos = {
    nombre: 'Ana',
    codigo: 'BP-0042',
    check_in: '10/09/2026',
    check_out: '13/09/2026',
    hora_check_in: '15:00',
    hora_check_out: '10:00',
    total: '642,51',
    enlace: 'https://blancapatagonia.com/r/abc',
  }

  it('reemplaza los marcadores en asunto y cuerpo', () => {
    const r = renderizar('confirmacion_reserva', datos)
    expect(r.asunto).toBe('Recibimos tu reserva en Blanca Patagonia (BP-0042)')
    expect(r.cuerpo).toContain('Hola Ana,')
    expect(r.cuerpo).toContain('642,51')
    expect(r.faltantes).toEqual([])
  })

  /*
    El correo sale al ALTA, cuando la reserva nace `pendiente`, no al confirmarse.
    Decía «Confirmamos tu reserva» y el huésped se quedaba creyendo que tenía la
    habitación asegurada — cuando en realidad expira a los 5 días sin la seña y la
    unidad se libera. Este test evita que el texto vuelva a prometer eso.
  */
  it('NO le dice al huésped que la reserva está confirmada', () => {
    const r = renderizar('confirmacion_reserva', datos)
    expect(r.asunto.toLowerCase()).not.toContain('confirmada')
    expect(r.cuerpo.toLowerCase(), 'el correo afirma una confirmación que no ocurrió').not.toContain(
      'confirmamos tu reserva',
    )
  })

  it('le dice que hay que abonar la seña y qué pasa si no', () => {
    const r = renderizar('confirmacion_reserva', datos)
    expect(r.cuerpo.toLowerCase()).toContain('seña')
    expect(r.cuerpo.toLowerCase()).toContain('libera')
  })

  it('no deja marcadores sin reemplazar cuando están todos los datos', () => {
    const r = renderizar('confirmacion_reserva', datos)
    expect(r.cuerpo).not.toMatch(/\{\{\w+\}\}/)
  })

  it('deja el marcador VISIBLE cuando falta el dato', () => {
    // Es preferible que el error salte antes de enviar y no que llegue «Hola ,».
    const r = renderizar('recordatorio_checkin', { codigo: 'BP-1', check_in: '10/09' })
    expect(r.cuerpo).toContain('{{nombre}}')
    expect(r.faltantes).toContain('nombre')
    expect(r.faltantes).toContain('hora_check_in')
  })

  it('acepta números además de texto', () => {
    const r = renderizar('cambio_nivel_fidelidad', { nombre: 'Ana', nivel: 'Oro', puntos: 2100 })
    expect(r.cuerpo).toContain('2100 puntos')
    expect(r.faltantes).toEqual([])
  })

  it('variablesFaltantes detecta también los valores vacíos', () => {
    expect(variablesFaltantes(PLANTILLAS.encuesta_postcheckout, { nombre: '', enlace: 'x' })).toEqual([
      'nombre',
    ])
  })
})

/**
 * El catálogo ampliado (2026-09-08).
 *
 * El prompt del sistema enumera 19 tipos de aviso y había 4. Estos casos fijan
 * las decisiones que un evento nuevo obliga a tomar, para que agregar el número
 * 21 no sea copiar el 20 sin pensar.
 */
describe('catálogo de avisos', () => {
  it('cubre el ciclo completo de la reserva', () => {
    /*
      No es una lista decorativa: cada uno de estos existe porque su ausencia era
      un silencio concreto. El más caro: `reserva_por_vencer` — una reserva
      pendiente se libera a los 5 días y hasta ahora eso pasaba sin avisar, así
      que el huésped se enteraba al llegar.
    */
    const delCiclo = [
      'confirmacion_reserva',
      'reserva_confirmada',
      'reserva_por_vencer',
      'reserva_reprogramada',
      'reserva_cancelada',
      'no_show',
    ]
    for (const e of delCiclo) expect(EVENTOS_EMAIL).toContain(e)
  })

  it('cubre el dinero', () => {
    for (const e of ['pago_recibido', 'pago_rechazado', 'saldo_pendiente']) {
      expect(EVENTOS_EMAIL).toContain(e)
    }
  })

  it('cubre los seis avisos internos', () => {
    const internos = [
      'interno_nueva_reserva',
      'interno_nuevo_pago',
      'interno_error_sincronizacion',
      'interno_discrepancia_factura',
      'interno_habitacion_lista',
      'interno_incidente_mantenimiento',
    ]
    for (const e of internos) {
      expect(EVENTOS_EMAIL).toContain(e)
      expect(esInterno(e as EventoEmail), `${e} tendría que ser interno`).toBe(true)
    }
  })

  it('ningún aviso al huésped se marca como interno', () => {
    // Un interno se salta el consentimiento y la franja horaria. Marcar uno del
    // huésped como interno lo mandaría a las 3 de la mañana a quien pidió que no
    // le escriban.
    for (const e of EVENTOS_EMAIL) {
      if (e.startsWith('interno_')) continue
      expect(esInterno(e), `${e} quedó marcado como interno`).toBe(false)
    }
  })

  it('el pago rechazado NO le dice al huésped por qué', () => {
    /*
      El motivo lo sabe el emisor de la tarjeta, no el hotel. Arriesgar una
      explicación ajena —«fondos insuficientes»— donde pudo haber sido otra cosa
      es peor que no decir nada, y encima expone al huésped delante de quien lea
      su correo.
    */
    const cuerpo = PLANTILLAS.pago_rechazado.cuerpo.toLowerCase()
    for (const palabra of ['fondos', 'saldo insuficiente', 'vencida', 'robada']) {
      expect(cuerpo, `el correo aventura el motivo del rechazo: «${palabra}»`).not.toContain(
        palabra,
      )
    }
    // Y sí dice lo único que el hotel sabe con certeza.
    expect(cuerpo).toContain('no se te cobró nada')
  })

  it('un marcador opcional desaparece; uno obligatorio se deja ver', () => {
    // Sin esto, el huésped recibía «hasta las 10:00. {{aviso_saldo}}».
    const r = renderizar('checkout_proximo', {
      nombre: 'Ana',
      codigo: 'BP-1',
      check_out: '2026-10-02',
      hora_check_out: '10:00',
    })

    expect(r.cuerpo, 'el marcador opcional quedó a la vista').not.toContain('{{aviso_saldo}}')
    expect(r.faltantes, 'un opcional ausente no es una variable faltante').toEqual([])
  })

  it('y cuando el opcional viene, se usa', () => {
    const r = renderizar('checkout_proximo', {
      nombre: 'Ana',
      codigo: 'BP-1',
      check_out: '2026-10-02',
      hora_check_out: '10:00',
      aviso_saldo: 'Te queda un saldo de USD 40.',
    })

    expect(r.cuerpo).toContain('USD 40')
  })
})
