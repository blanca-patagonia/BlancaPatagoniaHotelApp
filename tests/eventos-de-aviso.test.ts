import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as eventos from '@/lib/notificaciones/eventos'
import {
  PLANTILLAS,
  EVENTOS_EMAIL,
  renderizar,
  variablesFaltantes,
  type EventoEmail,
} from '@/lib/domain/plantillas'

/**
 * Los disparadores llenan todas las variables de su plantilla.
 *
 * ── El defecto que este test impide ─────────────────────────────────────────
 *
 * `encolar` recibe `variables: Record<string, string | number>`. El nombre de
 * cada marcador se escribe a mano, así que escribir `checkin` donde la plantilla
 * dice `check_in` **no es un error**: el correo sale igual, con «{{check_in}}»
 * impreso adentro, y el que se entera es el huésped.
 *
 * Los marcadores sin valor se dejan visibles a propósito (ver `renderizar`) para
 * que un error se note **antes** de enviar. Este test es ese «antes».
 *
 * ── Por qué un cliente falso y no la base ───────────────────────────────────
 *
 * Lo que se verifica es la forma del payload, no que Postgres lo acepte —de eso
 * se ocupa `tests/notificaciones-bandeja.test.ts`—. Sin base, el test corre en
 * cada `npm test` y no en los que necesitan Docker.
 */

interface Encolado {
  evento: string
  canal: string
  clave: string
  destinatario: string
  variables: Record<string, string | number>
}

/**
 * Cliente falso: acepta la cadena de PostgREST y guarda lo que se insertó.
 *
 * Devuelve preferencias que aceptan todo, para que el consentimiento no corte el
 * encolado del evento comercial y el test llegue a mirar sus variables.
 */
function clienteFalso(): { client: SupabaseClient; encolados: Encolado[] } {
  const encolados: Encolado[] = []

  const client = {
    from(tabla: string) {
      if (tabla === 'huespedes') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { acepta_avisos: true, acepta_promociones: true },
                error: null,
              }),
            }),
          }),
        }
      }
      return {
        insert: async (fila: Encolado) => {
          encolados.push(fila)
          return { error: null }
        },
      }
    },
  } as unknown as SupabaseClient

  return { client, encolados }
}

/** Datos de un huésped cualquiera, con todo cargado. */
const HUESPED = {
  reservaId: '11111111-1111-1111-1111-111111111111',
  huespedId: '22222222-2222-2222-2222-222222222222',
  email: 'ana@example.com',
  nombre: 'Ana',
  codigo: 'BP-000123',
}

const ENLACE = 'https://blancapatagonia.test/x/abc'

/**
 * Una llamada por evento, con datos completos.
 *
 * La clave del mapa es el evento, así que el test de cobertura de más abajo
 * puede comparar contra `EVENTOS_EMAIL` y nombrar el que falte.
 */
const LLAMADAS: Partial<Record<EventoEmail, (c: SupabaseClient) => Promise<unknown>>> = {
  interno_nueva_reserva: (c) =>
    eventos.avisarNuevaReserva(c, {
      reservaId: HUESPED.reservaId,
      codigo: HUESPED.codigo,
      huesped: 'Ana Pérez',
      checkIn: '2027-03-10',
      checkOut: '2027-03-13',
      total: 300,
      origen: 'Portal',
    }),
  interno_nuevo_pago: (c) =>
    eventos.avisarPagoInterno(c, {
      pagoId: 'pago-1',
      reservaId: HUESPED.reservaId,
      codigo: HUESPED.codigo,
      huesped: 'Ana Pérez',
      importe: 120,
      medio: 'MercadoPago',
      saldo: 180,
    }),
  interno_error_sincronizacion: (c) =>
    eventos.avisarErrorSincronizacion(c, {
      canal: 'Booking',
      detalle: 'el feed respondió 502',
      dia: '2027-03-10',
    }),
  interno_canal_por_revisar: (c) =>
    eventos.avisarCanalPorRevisar(c, {
      canal: 'Booking',
      cantidad: 3,
      dia: '2027-03-10',
      conflictos: 1,
    }),
  interno_reserva_modificada_canal: (c) =>
    eventos.avisarReservasModificadas(c, { canal: 'Booking', cantidad: 2, dia: '2027-03-10' }),
  interno_discrepancia_factura: (c) =>
    eventos.avisarDiscrepanciaFactura(c, {
      cargoId: 'cargo-1',
      canal: 'Booking',
      devengado: 100,
      facturado: 130,
    }),
  interno_habitacion_lista: (c) =>
    eventos.avisarHabitacionLista(c, {
      unidadId: 'unidad-1',
      unidad: 'Habitación 12',
      dia: '2027-03-10',
      paraQuien: 'Ana Pérez',
    }),
  interno_incidente_mantenimiento: (c) =>
    eventos.avisarIncidenteMantenimiento(c, {
      ordenId: 'orden-1',
      unidad: 'Habitación 12',
      titulo: 'Pérdida de agua',
      prioridad: 'urgente',
    }),
  reserva_confirmada: (c) =>
    eventos.avisarReservaConfirmada(c, HUESPED, {
      checkIn: '2027-03-10',
      checkOut: '2027-03-13',
      saldo: 180,
    }),
  pago_recibido: (c) =>
    eventos.avisarPagoRecibido(c, HUESPED, { pagoId: 'pago-1', importe: 120, saldo: 180 }),
  pago_rechazado: (c) =>
    eventos.avisarPagoRechazado(c, HUESPED, { pagoId: 'pago-1', importe: 120, enlace: ENLACE }),
  reserva_reprogramada: (c) =>
    eventos.avisarReservaReprogramada(c, HUESPED, {
      checkIn: '2027-04-01',
      checkOut: '2027-04-04',
      total: 360,
    }),
  reserva_cancelada: (c) =>
    eventos.avisarReservaCancelada(c, HUESPED, {
      checkIn: '2027-03-10',
      checkOut: '2027-03-13',
      detalle: 'Sin cargo: faltaban más de 14 días.',
    }),
  no_show: (c) =>
    eventos.avisarNoShow(c, HUESPED, {
      checkIn: '2027-03-10',
      detalle: 'Se cobra el total de la estadía.',
    }),
  reserva_por_vencer: (c) =>
    eventos.avisarReservaPorVencer(c, HUESPED, {
      checkIn: '2027-03-10',
      sena: 90,
      enlace: ENLACE,
    }),
  saldo_pendiente: (c) =>
    eventos.avisarSaldoPendiente(c, HUESPED, {
      checkIn: '2027-03-10',
      saldo: 180,
      enlace: ENLACE,
    }),
  checkout_proximo: (c) =>
    eventos.avisarCheckoutProximo(c, HUESPED, { checkOut: '2027-03-13', saldo: 40 }),
  solicitud_resena: (c) => eventos.avisarSolicitudResena(c, HUESPED, { enlace: ENLACE }),
}

/**
 * Eventos que todavía no tienen disparador propio, con el motivo.
 *
 * Los tres se encolan desde su propio flujo, escritos antes de que existiera
 * esta capa. Están acá para que la lista no sea un agujero silencioso: si mañana
 * uno se migra, se saca de acá y el test de cobertura lo exige en `LLAMADAS`.
 */
const SIN_DISPARADOR: Record<string, string> = {
  confirmacion_reserva:
    'Se encola en app/reservar/actions.ts, dentro del alta pública, con el token de la reserva recién creada.',
  recordatorio_checkin:
    'Lo encola el cron de recordatorios (lib/notificaciones/recordatorios.ts) y también el botón del listado de reservas, que fuerza la misma corrida.',
  encuesta_postcheckout:
    'Se encola en el check-out, que es el único momento en que existe el token de la encuesta.',
  cambio_nivel_fidelidad:
    'Se encola en el check-out, después de sumar los puntos: sólo se avisa si la estadía hizo cambiar de nivel.',
}

describe('los disparadores llenan las variables de su plantilla', () => {
  for (const [evento, llamar] of Object.entries(LLAMADAS)) {
    it(`${evento} no deja ningún marcador sin valor`, async () => {
      const { client, encolados } = clienteFalso()
      await llamar!(client)

      expect(encolados.length, 'no se encoló nada').toBe(1)
      const fila = encolados[0]
      expect(fila.evento).toBe(evento)

      const faltantes = variablesFaltantes(
        PLANTILLAS[evento as EventoEmail],
        fila.variables,
      )
      expect(
        faltantes,
        `el huésped iba a recibir «{{${faltantes.join('}}», «{{')}}}» impreso en el correo`,
      ).toEqual([])
    })

    it(`${evento} no deja marcadores crudos en el texto final`, async () => {
      /*
        La comprobación de arriba mira las variables DECLARADAS. Ésta mira el
        texto: agarra un marcador que la plantilla usa y se olvidó de declarar,
        que es el mismo error visto desde el otro lado.
      */
      const { client, encolados } = clienteFalso()
      await llamar!(client)

      const { asunto, cuerpo } = renderizar(evento as EventoEmail, encolados[0].variables)
      expect(asunto, 'quedó un marcador sin reemplazar en el asunto').not.toMatch(/\{\{/)
      expect(cuerpo, 'quedó un marcador sin reemplazar en el cuerpo').not.toMatch(/\{\{/)
    })
  }

  it('todo evento del catálogo tiene disparador o motivo escrito', () => {
    /*
      Sin esto, agregar una plantilla y no dispararla nunca queda como una
      función que existe y no la llama nadie — que es exactamente el estado en el
      que estaba `crearCheckout` antes de la Fase 23.
    */
    for (const evento of EVENTOS_EMAIL) {
      const tiene = evento in LLAMADAS || evento in SIN_DISPARADOR
      expect(tiene, `«${evento}» no se dispara desde ningún lado`).toBe(true)
    }
  })

  it('cada excepción explica por qué, y ninguna sobra', () => {
    for (const [evento, motivo] of Object.entries(SIN_DISPARADOR)) {
      expect(
        motivo.length,
        `la excepción de «${evento}» no dice desde dónde se encola`,
      ).toBeGreaterThan(40)
      expect(
        evento in LLAMADAS,
        `«${evento}» ya tiene disparador: sacalo de SIN_DISPARADOR`,
      ).toBe(false)
    }
  })
})

describe('las claves de idempotencia distinguen lo que se repite', () => {
  it('los avisos que se repiten llevan discriminante y los que no, no', async () => {
    /*
      El caso caro es el de la habitación lista: la misma unidad se limpia todos
      los días. Sin discriminante, la clave sería `interno_habitacion_lista:<id>`
      y sólo se avisaría la primera vez en la vida de esa unidad — el resto
      chocaría contra el `unique` y se descartaría en silencio.
    */
    const { client, encolados } = clienteFalso()

    await eventos.avisarHabitacionLista(client, {
      unidadId: 'u1',
      unidad: 'Hab 12',
      dia: '2027-03-10',
    })
    await eventos.avisarHabitacionLista(client, {
      unidadId: 'u1',
      unidad: 'Hab 12',
      dia: '2027-03-11',
    })

    expect(encolados[0].clave).not.toBe(encolados[1].clave)
    expect(encolados[0].clave).toContain('2027-03-10')
  })

  it('el mismo pago no se avisa dos veces', async () => {
    // La entidad es el pago y no la reserva: hay varios pagos por reserva, pero
    // reprocesar el webhook del mismo pago tiene que encontrar la fila que ya está.
    const { client, encolados } = clienteFalso()

    await eventos.avisarPagoRecibido(client, HUESPED, { pagoId: 'p1', importe: 100, saldo: 0 })
    await eventos.avisarPagoRecibido(client, HUESPED, { pagoId: 'p1', importe: 100, saldo: 0 })

    expect(encolados[0].clave).toBe(encolados[1].clave)
  })
})

describe('el canal de cada aviso', () => {
  it('los internos salen por el canal interno, con el rol como destinatario', async () => {
    const { client, encolados } = clienteFalso()
    await eventos.avisarErrorSincronizacion(client, {
      canal: 'Booking',
      detalle: 'timeout',
      dia: '2027-03-10',
    })

    expect(encolados[0].canal).toBe('interno')
    expect(encolados[0].destinatario).toBe('gerencia')
  })

  it('los del huésped salen por correo', async () => {
    const { client, encolados } = clienteFalso()
    await eventos.avisarPagoRecibido(client, HUESPED, { pagoId: 'p1', importe: 100, saldo: 0 })

    expect(encolados[0].canal).toBe('email')
    expect(encolados[0].destinatario).toBe(HUESPED.email)
  })
})
