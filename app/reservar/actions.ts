'use server'

import { redirect } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { enviarPlantilla } from '@/lib/email'
import { urlDelSitio } from '@/lib/env'
import { formatoFechaCorta, diasEntre } from '@/lib/fechas'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'
import { HORA_CHECK_IN, HORA_CHECK_OUT } from '@/lib/domain/hotel'
import { permitirIntento } from '@/lib/limites'
import { mensajeLimite } from '@/lib/domain/limites'
import { validarCapacidad } from '@/lib/domain/unidades'

export interface EstadoReservaPublica {
  error?: string
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NOCHES_PUBLICO = 30

/**
 * Crea una reserva desde el portal público. Corre con `service_role` (el visitante
 * es anónimo): asigna una unidad libre, cotiza y crea la reserva en estado
 * `pendiente` (bloquea el inventario por la restricción de exclusión). La reserva
 * se confirma con el pago de la seña.
 */
export async function crearReservaPublica(
  _prev: EstadoReservaPublica,
  formData: FormData,
): Promise<EstadoReservaPublica> {
  const tipoUnidadId = String(formData.get('tipo') ?? '')
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  const huespedesCant = Math.max(1, Number(formData.get('huespedes') ?? 1) || 1)
  const nombre = String(formData.get('nombre') ?? '').trim()
  const apellido = String(formData.get('apellido') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const telefono = String(formData.get('telefono') ?? '').trim()

  if (!tipoUnidadId || !checkIn || !checkOut || checkOut <= checkIn) {
    return { error: 'Datos de la reserva incompletos.' }
  }
  if (!apellido || !email) return { error: 'Ingresá tu apellido y tu email.' }
  if (!RE_EMAIL.test(email)) return { error: 'Ingresá un email válido.' }

  /*
    Límite de volumen. Es la protección más importante del sistema hacia afuera:
    cada reserva pendiente bloquea una unidad durante 5 días, así que sin esto
    unas decenas de envíos dejan al hotel sin inventario vendible por casi una
    semana (ver `docs/SEGURIDAD.md`).

    Se comprueba DESPUÉS de validar los campos para no gastar cupo en envíos
    malformados, y ANTES de escribir nada.
  */
  if (!(await permitirIntento('reserva_publica'))) {
    return { error: mensajeLimite('reserva_publica') }
  }
  if (diasEntre(checkIn, checkOut) > MAX_NOCHES_PUBLICO) {
    return { error: `La estadía no puede superar las ${MAX_NOCHES_PUBLICO} noches.` }
  }

  const admin = crearClienteAdmin()

  /*
    Capacidad del alojamiento.

    Hasta acá el límite existía solo en el filtro de la pantalla, que sirve para
    no ofrecer una cabaña de cuatro a quien busca para seis. Pero esta acción es
    un endpoint HTTP público: un envío directo con `huespedes: 50` sobre una
    habitación doble entraba sin objeción, y el hotel se enteraba en el mostrador.
  */
  const { data: tipo, error: eTipo } = await admin
    .from('tipos_unidad')
    .select('capacidad_max')
    .eq('id', tipoUnidadId)
    .maybeSingle()
  if (eTipo) return { error: 'No se pudo verificar el alojamiento elegido.' }
  if (!tipo) return { error: 'Ese alojamiento no existe.' }

  const excedeCapacidad = validarCapacidad(huespedesCant, Number(tipo.capacidad_max))
  if (excedeCapacidad) return { error: excedeCapacidad }

  /*
    Huésped: se reutiliza el existente en vez de crear otro.

    El panel ya resuelve esto (`app/panel/huespedes/actions.ts`): el email es el
    modo en que el sistema reconoce a quien vuelve. Acá se insertaba siempre una
    fila nueva, así que un huésped habitual terminaba repetido una vez por
    reserva, con su historial partido entre varias fichas y la fidelidad sin
    acumular.
  */
  const { data: existente, error: eBusqueda } = await admin
    .from('huespedes')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (eBusqueda) return { error: 'No se pudieron registrar tus datos.' }

  let huespedId = existente?.id as string | undefined

  if (!huespedId) {
    const { data: huesped, error: eHuesped } = await admin
      .from('huespedes')
      .insert({ nombre: nombre || apellido, apellido, email, telefono })
      .select('id')
      .single()
    if (eHuesped || !huesped) return { error: 'No se pudieron registrar tus datos.' }
    huespedId = huesped.id
  }

  if (!huespedId) return { error: 'No se pudieron registrar tus datos.' }

  // Alta atómica (service_role): unidad libre + cotización + anti-overbooking.
  const res = await crearReservaEnUnidadLibre(admin, {
    tipoUnidadId,
    checkIn,
    checkOut,
    huespedes: huespedesCant,
    huespedId,
    canal: 'web',
    tarifaTipo: 'rack',
    estado: 'pendiente',
  })
  if (!res.ok) return { error: res.error }
  const nueva = res.reserva
  // La URL pública usa el token opaco (no el código, que es enumerable).
  const { data: full } = await admin
    .from('reservas')
    .select('token')
    .eq('id', nueva.id)
    .single()
  const token = (full as { token: string } | null)?.token ?? nueva.id

  // La confirmación sale del catálogo de plantillas, no de un texto suelto:
  // así el mismo correo se puede previsualizar y probar desde Configuración.
  await enviarPlantilla('confirmacion_reserva', email, {
    nombre: nombre || apellido,
    codigo: nueva.codigo,
    check_in: formatoFechaCorta(checkIn),
    check_out: formatoFechaCorta(checkOut),
    hora_check_in: HORA_CHECK_IN,
    hora_check_out: HORA_CHECK_OUT,
    total: Number(nueva.total).toLocaleString('es-AR'),
    enlace: `${urlDelSitio()}/reservar/confirmacion/${token}`,
  })

  redirect(`/reservar/confirmacion/${token}`)
}
