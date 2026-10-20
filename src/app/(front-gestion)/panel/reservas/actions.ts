'use server'

/**
 * Acciones de reservas: el alta (individual y grupal), los cambios de estado y
 * los recordatorios de llegada.
 *
 * El resto vive al lado, un archivo por tema (todos terminan en `actions.ts`
 * para que `tests/contratos/autorizacion-acciones.test.ts` los vigile):
 *  · `cobros.actions.ts`   pagos, link de pago, origen del pago, garantía
 *  · `consumos.actions.ts` cargar y quitar consumos
 *  · `factura.actions.ts`  factura y nota de crédito
 *  · `cambios.actions.ts`  editar la ficha, cambiar fechas, mudar de unidad
 */

import { crearClienteAdmin } from '@/lib/supabase/admin'
import { deLista } from '@/lib/domain/listas'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import type { TarifaTipo } from '@/lib/domain/precios'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import type { SupabaseClient } from '@supabase/supabase-js'
import { diasEntre } from '@/lib/fechas'
import { puedeTransicionar, ESTADOS_ACTIVOS, type EstadoReserva } from '@/lib/domain/reservas'
import { puntosPorEstadia, nivelFidelidad, ETIQUETAS_NIVEL } from '@/lib/domain/fidelidad'
import { requerirAcceso } from '@/lib/auth/session'
import { hoyISO, sumarDias, formatoFechaCorta } from '@/lib/fechas'
import { encolar } from '@/lib/notificaciones'
import {
  avisarNoShow,
  avisarReservaCancelada,
  type DestinoHuesped,
} from '@/lib/notificaciones/eventos'
import { cargoDeCancelacion, textoDeCancelacion, textoDeNoShow } from '@/lib/reservas/cancelacion'
import { urlDelSitio } from '@/lib/env'
import { HORA_CHECK_IN } from '@/lib/domain/hotel'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'
import { paxQueOcupa, validarOcupantes, type Ocupantes } from '@/lib/domain/ocupantes'
import { GARANTIAS, PLANES, SEGMENTOS } from '@/lib/domain/reservas'

/*
  ⚠️ `avisarNuevaReserva` NO se importa acá, y es deliberado: el alta del
  mostrador la hace una persona que está mirando la pantalla. Avisarle a la
  cartelera de lo que acaba de cargar ella misma es ruido, y el ruido es lo que
  hace que después nadie mire la cartelera. El aviso sale del portal público
  (`app/reservar/actions.ts`) y del cron de canales, que son los caminos donde
  entra una reserva sin que haya nadie.
*/

export interface EstadoNuevaReserva {
  error?: string
  /**
   * Lo que se había cargado, para reponerlo si hubo error.
   *
   * React limpia el formulario después de una Server Action, así que sin esto
   * un error en un solo campo obligaba a escribir todo de nuevo.
   */
  valores?: {
    tipo_unidad_id?: string
    unidad_id?: string
    apellido?: string
    nombre?: string
    email?: string
    doc_numero?: string
    canal?: string
    agencia_id?: string
    /* Desglose de ocupantes y condiciones comerciales (paso 6). */
    adultos?: string
    menores?: string
    bebes?: string
    camas_extra?: string
    cunas?: string
    no_mover?: string
    plan?: string
    garantia?: string
    segmento?: string
    voucher?: string
    descuento_pct?: string
    promocion_id?: string
    checkin_inmediato?: string
  }
}

const CANAL_TARIFA: Record<string, TarifaTipo> = {
  directo: 'rack',
  web: 'rack',
  booking: 'neto',
  expedia: 'neto',
}

export async function crearReservaAction(
  _prev: EstadoNuevaReserva,
  formData: FormData,
): Promise<EstadoNuevaReserva> {
  await requerirAcceso('reservas')
  const tipoUnidadId = String(formData.get('tipo_unidad_id') ?? '')
  const unidadId = String(formData.get('unidad_id') ?? '').trim() || undefined
  const checkinInmediato = formData.get('checkin_inmediato') === '1'
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  const huespedesCant = Math.max(1, Number(formData.get('huespedes') ?? 1) || 1)
  const canal = String(formData.get('canal') ?? 'directo')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const apellido = String(formData.get('apellido') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  // Ficha existente elegida desde la del huésped (ver `nueva/page.tsx`).
  const huespedIdElegido = String(formData.get('huesped_id') ?? '').trim()
  const docNumero = String(formData.get('doc_numero') ?? '').trim()

  const agenciaId = String(formData.get('agencia_id') ?? '')

  // ── Desglose de ocupantes y condiciones comerciales (paso 6) ───────────────
  const entero = (clave: string, porDefecto = 0) => {
    const n = Number(formData.get(clave))
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : porDefecto
  }

  const ocupantes: Ocupantes = {
    // Sin desglose cargado se asume que todos los huéspedes de la búsqueda son
    // adultos, que es lo que el sistema suponía antes del paso 6.
    adultos: entero('adultos', huespedesCant) || huespedesCant,
    menores: entero('menores'),
    bebes: entero('bebes'),
    camasExtra: entero('camas_extra'),
    cunas: entero('cunas'),
  }
  const noMover = formData.get('no_mover') === '1'

  const planCrudo = String(formData.get('plan') ?? 'desayuno')
  const garantiaCrudo = String(formData.get('garantia') ?? 'sin_garantia')
  const segmentoCrudo = String(formData.get('segmento') ?? '')
  const voucher = String(formData.get('voucher') ?? '').trim()
  const descuentoPct = Math.min(100, Math.max(0, Number(formData.get('descuento_pct')) || 0))
  const promocionId = String(formData.get('promocion_id') ?? '').trim() || null

  // Se devuelve tal cual vino para reponer el formulario ante cualquier error.
  const valores = {
    tipo_unidad_id: tipoUnidadId,
    unidad_id: unidadId ?? '',
    apellido,
    nombre,
    email,
    doc_numero: docNumero,
    canal,
    agencia_id: agenciaId,
    adultos: String(ocupantes.adultos),
    menores: String(ocupantes.menores),
    bebes: String(ocupantes.bebes),
    camas_extra: String(ocupantes.camasExtra),
    cunas: String(ocupantes.cunas),
    no_mover: noMover ? '1' : '',
    plan: planCrudo,
    garantia: garantiaCrudo,
    segmento: segmentoCrudo,
    voucher,
    descuento_pct: String(descuentoPct),
    promocion_id: promocionId ?? '',
    checkin_inmediato: checkinInmediato ? '1' : '',
  }

  if (!tipoUnidadId || !checkIn || !checkOut) {
    return { error: 'Elegí fechas y un tipo de unidad.', valores }
  }
  if (checkOut <= checkIn) {
    return { error: 'El check-out debe ser posterior al check-in.', valores }
  }
  if (!apellido) return { error: 'Ingresá al menos el apellido del huésped.', valores }

  // El desglose se valida contra la capacidad de la unidad elegida. Se hace acá y
  // no en la base porque el mensaje tiene que decir cuántos entran y por qué, no
  // «viola una restricción».
  const { data: tipoElegido, error: eTipoElegido } = await (await crearClienteServidor())
    .from('tipos_unidad')
    .select('capacidad_max')
    .eq('id', tipoUnidadId)
    .maybeSingle<{ capacidad_max: number }>()

  /*
    Si esto falla y se sigue de largo, `validarOcupantes` recibe `undefined`
    de capacidad y SALTEA el chequeo entero (ver su propio código: sin
    capacidad no hay límite que aplicar) — una habitación de 2 podría
    quedar cargada con 10 personas sin que la validación lo note. No hay un
    valor por omisión seguro para "cuánto entra en esta unidad": se corta.
  */
  if (eTipoElegido) {
    registrarFalla(eTipoElegido, 'reservas:capacidad_max')
    return {
      error: 'No se pudo verificar la capacidad de la unidad. Probá de nuevo.',
      valores,
    }
  }

  const problemas = validarOcupantes(ocupantes, tipoElegido?.capacidad_max)
  if (problemas.length > 0) return { error: problemas[0], valores }

  const plan = deLista(PLANES, planCrudo) ?? 'desayuno'
  const garantia = deLista(GARANTIAS, garantiaCrudo) ?? 'sin_garantia'
  const segmento = deLista(SEGMENTOS, segmentoCrudo)

  const supabase = await crearClienteServidor()

  // Con convenio siempre corresponde tarifa NETA, sea cual sea el canal por el
  // que entró la reserva: es lo que define el acuerdo con la agencia.
  const tarifaTipo: TarifaTipo = agenciaId ? 'neto' : (CANAL_TARIFA[canal] ?? 'rack')

  /*
    Se cotiza ANTES de tocar la tabla de huéspedes.

    Antes el huésped se creaba primero y, si la reserva fallaba —por ejemplo por
    no haber tarifa cargada—, quedaba en la base un registro sin ninguna reserva
    asociada. Cotizar primero convierte el caso más común de fallo en un
    rechazo limpio, sin escribir nada.
  */
  const cotizacion = await cotizarEstadia({ tipoUnidadId, checkIn, checkOut, tarifaTipo })
  if (cotizacion.faltanTarifas) {
    return {
      error:
        'No hay tarifa cargada para esas fechas. Cargá la temporada y sus precios en Configuración → Temporadas.',
      valores,
    }
  }

  // La ficha elegida, el huésped de su email o uno nuevo.
  let huespedId: string | null = null
  if (huespedIdElegido) {
    /*
      Se reserva para un huésped que YA tiene ficha (botón «Nueva reserva» de su
      ficha). Antes no había forma: el alta pedía los datos a mano y sólo
      reutilizaba la ficha si coincidía el email, así que un habitual cargado
      sin email quedaba duplicado y perdía su historial de fidelidad.
    */
    const { data: elegido, error: eElegido } = await supabase
      .from('huespedes')
      .select('id')
      .eq('id', huespedIdElegido)
      .maybeSingle()
    if (eElegido) {
      return { error: 'No se pudo verificar la ficha del huésped. Probá de nuevo.', valores }
    }
    if (!elegido) return { error: 'Esa ficha de huésped ya no existe.', valores }
    huespedId = elegido.id as string
  } else if (email) {
    /*
      Con dos fichas del mismo email (pasa: por eso existe la fusión de la
      0111), `.maybeSingle()` daba error y la reserva no se podía crear. Se toma
      la más antigua, que es la que tiene el historial.
    */
    const { data: candidatos, error: eExistente } = await supabase
      .from('huespedes')
      .select('id')
      .eq('email', email)
      .order('creado_en', { ascending: true })
      .limit(1)
    const existente = candidatos?.[0]
    // Sin esto, una lectura que falla se confunde con "no hay huésped con
    // ese email" y el paso de abajo crea uno NUEVO — un huésped que ya tenía
    // ficha (con su historial, su nivel de fidelidad) termina duplicado.
    if (eExistente) {
      return { error: 'No se pudo verificar si el huésped ya está cargado. Probá de nuevo.', valores }
    }
    huespedId = existente?.id ?? null
  }

  // Solo hay que revertir el huésped si lo creó ESTA llamada: si ya existía,
  // borrarlo destruiría la ficha de alguien que se alojó antes.
  let huespedCreadoAca = false
  if (!huespedId) {
    const { data: nuevo, error: eHuesped } = await supabase
      .from('huespedes')
      .insert({ nombre: nombre || apellido, apellido, email: email || null, doc_numero: docNumero })
      .select('id')
      .single()
    if (eHuesped || !nuevo) return { error: 'No se pudo registrar al huésped.', valores }
    huespedId = nuevo.id
    huespedCreadoAca = true
  }

  if (!huespedId) return { error: 'No se pudo registrar al huésped.', valores }

  // Alta atómica: unidad libre + cotización + anti-overbooking (helper compartido).
  const res = await crearReservaEnUnidadLibre(supabase, {
    tipoUnidadId,
    unidadId,
    checkIn,
    checkOut,
    // `crear_reserva` deriva el pax del desglose, así que este valor queda como
    // respaldo para el caso sin desglose.
    huespedes: paxQueOcupa(ocupantes),
    huespedId,
    canal,
    tarifaTipo,
    estado: 'confirmada',
    ocupantes,
    noMover,
    // En la misma transacción que la reserva (migración 0083). Ver abajo.
    agenciaId: agenciaId || null,
    promocionId,
    comercial: {
      plan,
      garantia,
      segmento,
      voucher,
      // El descuento del convenio de la agencia ya está aplicado en la cotización
      // neta; éste es el adicional que carga recepción.
      descuentoPct,
    },
  })

  if (!res.ok) {
    // La cotización ya se validó arriba, así que llegar acá significa que la
    // unidad se ocupó entre la búsqueda y el alta. Si el huésped se creó en
    // esta misma llamada, se revierte: no debe quedar una ficha sin reserva.
    if (huespedCreadoAca) {
      // Compensación: se loguea y NO se corta. El error que el usuario tiene que
      // ver es `res.error` —por qué no se pudo reservar—, no el del rollback. Si
      // esto redirigiera, taparía la causa real. Si el borrado falla queda una
      // ficha de huésped sin reserva, que es prolijable a mano; perder el motivo
      // del rechazo, no.
      const { error: eRollback } = await supabase.from('huespedes').delete().eq('id', huespedId)
      registrarFalla(eRollback, `rollback del huésped ${huespedId} tras fallar el alta`)
    }
    return { error: res.error, valores }
  }

  /*
    El vínculo con la agencia ya viajó en la llamada de arriba.

    Hasta la migración 0084 se guardaba con un `update` aparte, con este
    razonamiento: «el helper de alta atómica es compartido con el portal público,
    donde no existe el concepto de convenio». El razonamiento estaba bien y la
    conclusión mal — el parámetro puede ser opcional, y el portal simplemente no
    lo manda—, porque si ese segundo paso fallaba la reserva quedaba **creada y
    sin agencia**: sin saber a quién facturarle, con qué tarifa ni qué cuenta
    corriente debitar (auditoría 2026-09, P1-7).

    Es el mismo movimiento que la 0039 hizo con el desglose de ocupación, que
    dejó escrito el argumento y no alcanzó a este campo.
  */

  // Check-in inmediato (patrón QloApps: marcar "In Progress" al confirmar el
  // alta de mostrador). Es una escritura ACCESORIA sobre una reserva que ya
  // quedó creada: si falla, no tiene sentido cortar ni mostrar el alta como
  // fallida —la reserva existe—, así que se loguea con `registrarFalla` y
  // recepción la pasa a `in_house` a mano desde la ficha (un clic).
  if (checkinInmediato) {
    const { error: eCheckin } = await supabase
      .from('reservas')
      .update({ estado: 'in_house' })
      .eq('id', res.reserva.id)
    if (eCheckin) {
      registrarFalla(eCheckin, `check-in inmediato de la reserva ${res.reserva.id}`)
      redirect(`/panel/reservas/${res.reserva.id}?error=checkin_inmediato`)
    }
  }

  redirect(`/panel/reservas/${res.reserva.id}`)
}

/** La forma con la que `cambiarEstadoReserva` lee la reserva para poder avisar. */
interface ReservaParaAvisar {
  total: number
  codigo: string
  tarifa_tipo: string
  huesped_id: string | null
  huesped: { nombre: string; email: string | null; telefono: string | null } | null
  // ⚠️ PostgREST tipa el embed como arreglo aunque la relación sea a-uno.
  estadia: { check_in: string; check_out: string; unidad: { tipo_unidad_id: string } | null }[] | null
}

/**
 * Le avisa al huésped que su reserva se canceló o quedó como no presentada.
 *
 * Está aparte de `cambiarEstadoReserva` para que la acción se siga leyendo de
 * corrido: lo que hace es una cosa —cambiar el estado— y esto es su consecuencia.
 *
 * **Nunca corta.** El estado ya cambió y el trigger ya liberó el inventario; que
 * no se pueda anotar un correo no puede volverse un error en la cara de quien
 * está atendiendo, ni dejar la operación a medias.
 */
async function avisarDelFinal(
  client: SupabaseClient,
  reservaId: string,
  nuevo: 'cancelada' | 'no_show',
  reserva: unknown,
): Promise<void> {
  const r = reserva as ReservaParaAvisar
  const estadia = r.estadia?.[0]
  if (!estadia) return

  const destino: DestinoHuesped = {
    reservaId,
    huespedId: r.huesped_id,
    email: r.huesped?.email ?? null,
    telefono: r.huesped?.telefono ?? null,
    nombre: r.huesped?.nombre ?? '',
    codigo: r.codigo,
  }

  const cargo = await cargoDeCancelacion(client, {
    checkIn: estadia.check_in,
    checkOut: estadia.check_out,
    total: Number(r.total),
    tipoUnidadId: estadia.unidad?.tipo_unidad_id ?? '',
    tarifaTipo: r.tarifa_tipo === 'neto' ? 'neto' : 'rack',
    noches: diasEntre(estadia.check_in, estadia.check_out),
    noShow: nuevo === 'no_show',
  })

  if (nuevo === 'no_show') {
    await avisarNoShow(crearClienteAdmin(), destino, {
      checkIn: estadia.check_in,
      // El no-show se cobra siempre al 100 %: no depende de la anticipación.
      detalle: textoDeNoShow(cargo?.monto ?? Number(r.total)),
    })
    return
  }

  await avisarReservaCancelada(crearClienteAdmin(), destino, {
    checkIn: estadia.check_in,
    checkOut: estadia.check_out,
    detalle: textoDeCancelacion(cargo),
  })
}

/**
 * Cambia el estado de una reserva validando la transición con la máquina de
 * estados. El trigger de la base sincroniza las estadías (libera/ocupa inventario).
 */
export async function cambiarEstadoReserva(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const id = String(formData.get('reserva_id') ?? '')
  const nuevo = String(formData.get('nuevo_estado') ?? '') as EstadoReserva
  if (!id || !nuevo) redirect('/panel/reservas')

  const supabase = await crearClienteServidor()
  const { data: reserva, error: eLectura } = await supabase
    .from('reservas')
    .select(
      `estado, total, codigo, tarifa_tipo, huesped_id,
       huesped:huespedes!reservas_huesped_id_fkey(nombre, email, telefono),
       estadia:estadias(check_in, check_out, unidad:unidades(tipo_unidad_id))`,
    )
    .eq('id', id)
    .maybeSingle()
  // Antes un fallo de lectura mandaba al listado sin decir nada.
  cortarSiFalla(eLectura, `/panel/reservas/${id}`, 'estado')
  if (!reserva) redirect('/panel/reservas')

  if (!puedeTransicionar(reserva.estado as EstadoReserva, nuevo)) {
    redirect(`/panel/reservas/${id}?error=transicion`)
  }

  /*
    El cambio sólo se aplica si la reserva SIGUE en el estado que se leyó.

    Dos puestos (o un reintento de red) haciendo check-out a la vez leían los
    dos `in_house`, los dos pasaban la validación y los dos seguían: puntos de
    fidelidad sumados dos veces, dos correos de cancelación. Con la condición
    sobre el estado, el segundo `update` no toca ninguna fila y se corta acá,
    antes de los efectos.
  */
  const { data: actualizadas, error: eEstado } = await supabase
    .from('reservas')
    .update({ estado: nuevo })
    .eq('id', id)
    .eq('estado', reserva.estado)
    .select('id')
  cortarSiFalla(eEstado, `/panel/reservas/${id}`, 'estado')
  if (!actualizadas || actualizadas.length === 0) {
    redirect(`/panel/reservas/${id}?error=estado_cambiado`)
  }

  /*
    Los dos finales que el huésped tiene que enterarse: la cancelación y el
    no-show.

    Hasta acá el sistema cambiaba el estado y no decía nada. Una reserva cancelada
    desde el mostrador —porque el huésped llamó, o porque el hotel la dio de
    baja— dejaba al huésped sin constancia de qué se le cobró, que es exactamente
    el dato por el que después llama.

    ⚠️ El cargo NO se calcula acá: sale de `lib/reservas/cancelacion.ts`, el mismo
    módulo que la ficha usa para mostrarlo **antes** de cancelar. Anunciar un
    número en pantalla y mandar otro por correo es la clase de diferencia que
    termina en una discusión con el tarifario publicado del otro lado.
  */
  if (nuevo === 'cancelada' || nuevo === 'no_show') {
    await avisarDelFinal(supabase, id, nuevo, reserva)
  }

  // Fidelidad: el check-out otorga puntos al huésped (una sola vez; 'checkout' es terminal).
  if (nuevo === 'checkout' && reserva.huesped_id) {
    const puntos = puntosPorEstadia(Number(reserva.total))
    if (puntos > 0) {
      /*
        La suma la hace la base (`sumar_puntos_huesped`, migración 0053), no la app.

        Antes esto era read-then-write y **descartaba el error de la lectura**: con la
        lectura fallada, `previos` quedaba en 0 y el `update` escribía solo los puntos
        de esta estadía, **borrando todo lo acumulado** del huésped. El check-out se
        completaba igual y nadie se enteraba.

        Arreglar solo el error de lectura habría dejado abierta una segunda carrera:
        dos check-outs simultáneos del mismo huésped —dos reservas, dos personas en el
        mostrador— leen el mismo valor previo y el segundo update pisa al primero.
        `update ... set puntos = puntos + n` no tiene lectura que falle ni valor previo
        que quede viejo.
      */
      const { data: totalesData, error: ePuntos } = await supabase.rpc('sumar_puntos_huesped', {
        p_huesped: reserva.huesped_id,
        p_puntos: puntos,
      })

      // El check-out ya quedó hecho arriba. Se corta igual: perder los puntos de
      // un huésped en silencio es un problema real, y avisando se pueden cargar
      // a mano. El aviso de nivel no se manda, que es lo correcto si no se pudo
      // guardar el nivel nuevo.
      cortarSiFalla(ePuntos, `/panel/reservas/${id}`, 'puntos')

      const totales = Number(totalesData ?? 0)
      const previos = totales - puntos

      // Solo se avisa si la estadía lo hizo CAMBIAR de nivel; sumar puntos sin
      // cruzar el umbral no amerita un correo.
      const nivelPrevio = nivelFidelidad(previos)
      const nivelNuevo = nivelFidelidad(totales)
      const huespedFid = reserva.huesped as unknown as {
        nombre: string
        email: string | null
      } | null

      if (nivelNuevo !== nivelPrevio && huespedFid?.email) {
        // Se encola: el aviso de fidelidad no puede demorar ni hacer fallar un
        // check-out. `huespedId` deja que la bandeja consulte el consentimiento.
        await encolar(crearClienteAdmin(), {
          evento: 'cambio_nivel_fidelidad',
          entidadId: id,
          destinatario: huespedFid.email,
          huespedId: reserva.huesped_id as string | null,
          reservaId: id,
          variables: {
            nombre: huespedFid.nombre,
            nivel: ETIQUETAS_NIVEL[nivelNuevo],
            puntos: totales,
          },
        })
      }
    }

    // El trigger `reservas_generar_encuesta` ya creó la encuesta con su token:
    // acá solo se le manda el enlace al huésped.
    const huesped = reserva.huesped as unknown as { nombre: string; email: string | null } | null
    const { data: encuesta, error: eEncuesta } = await supabase
      .from('encuestas_satisfaccion')
      .select('token')
      .eq('reserva_id', id)
      .maybeSingle()
    // Accesorio al check-out: si falla, la encuesta no sale, pero queda registrado.
    registrarFalla(eEncuesta, 'reservas:checkout_leer_encuesta')

    if (encuesta?.token && huesped?.email) {
      // La encuesta respeta el horario permitido: es un mensaje que inicia el
      // hotel, y un check-out de las 23:00 no justifica escribirle a esa hora.
      await encolar(crearClienteAdmin(), {
        evento: 'encuesta_postcheckout',
        entidadId: id,
        destinatario: huesped.email,
        huespedId: reserva.huesped_id as string | null,
        reservaId: id,
        variables: {
          nombre: huesped.nombre,
          enlace: `${urlDelSitio()}/encuesta/${encuesta.token}`,
        },
      })
    }
  }

  redirect(`/panel/reservas/${id}`)
}

export interface EstadoReservaGrupal {
  error?: string
  /**
   * Éxito **parcial**: el grupo se creó, pero con menos unidades de las pedidas.
   *
   * ── Por qué no se aborta el lote entero ─────────────────────────────────────
   *
   * El pendiente original decía «`crearReservaGrupal` no es atómica». La
   * no-atomicidad no es el problema: para un hotel, un grupo de 5 que sólo consigue
   * 4 unidades **suele valer la pena igual** —se toman las 4 y se llama al cliente—,
   * y abortar el lote perdería cuatro ventas reales por una que no entró.
   *
   * El problema es el **silencio**: `primerError` se calculaba y se descartaba
   * cuando `creadas > 0`, así que quien pedía 5 y recibía 2 veía la misma pantalla
   * de éxito que quien recibía las 5. Lo descubría el día de la llegada.
   *
   * Por eso el resultado parcial se devuelve como estado y **no** se redirige: el
   * listado de reservas no renderiza mensajes de query, así que un
   * `?parcial=…` se habría perdido en el camino.
   */
  parcial?: {
    creadas: number
    pedidas: number
    /** Por qué no entraron las demás, en las palabras del motor de disponibilidad. */
    motivo: string
    grupoId: string
  }
}

/**
 * Alta de una reserva GRUPAL: crea varias reservas (una por unidad) que comparten
 * un `grupo_id`. Reutiliza el alta atómica por unidad (anti-overbooking) y permite
 * check-out escalonado y facturación consolidada por grupo.
 */
export async function crearReservaGrupal(
  _prev: EstadoReservaGrupal,
  formData: FormData,
): Promise<EstadoReservaGrupal> {
  await requerirAcceso('reservas')
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  const canal = String(formData.get('canal') ?? 'directo')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const apellido = String(formData.get('apellido') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()

  if (!checkIn || !checkOut || checkOut <= checkIn) return { error: 'Revisá las fechas.' }
  if (!apellido) return { error: 'Ingresá el apellido del titular del grupo.' }

  const selecciones: { tipoUnidadId: string; cantidad: number }[] = []
  for (const [k, v] of formData.entries()) {
    if (k.startsWith('qty_')) {
      const cantidad = Math.max(0, Number(v) || 0)
      if (cantidad > 0) selecciones.push({ tipoUnidadId: k.slice(4), cantidad })
    }
  }
  if (selecciones.length === 0) return { error: 'Elegí al menos una unidad.' }

  const supabase = await crearClienteServidor()
  const tarifaTipo = CANAL_TARIFA[canal] ?? 'rack'

  let huespedId: string | null = null
  if (email) {
    const { data: existente, error: eExistente } = await supabase
      .from('huespedes')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    // Mismo motivo que en el alta individual: sin esto, una lectura que
    // falla duplica al titular en vez de reusar su ficha.
    if (eExistente) return { error: 'No se pudo verificar si el titular ya está cargado. Probá de nuevo.' }
    huespedId = existente?.id ?? null
  }
  if (!huespedId) {
    const { data: nuevo, error: eHuesped } = await supabase
      .from('huespedes')
      .insert({ nombre: nombre || apellido, apellido, email: email || null })
      .select('id')
      .single()
    if (eHuesped || !nuevo) return { error: 'No se pudo registrar al titular.' }
    huespedId = nuevo.id
  }

  if (!huespedId) return { error: 'No se pudo registrar al titular.' }

  const grupoId = crypto.randomUUID()
  let creadas = 0
  let primerError: string | undefined
  for (const s of selecciones) {
    for (let i = 0; i < s.cantidad; i++) {
      const res = await crearReservaEnUnidadLibre(supabase, {
        tipoUnidadId: s.tipoUnidadId,
        checkIn,
        checkOut,
        huespedes: 2,
        huespedId,
        canal,
        tarifaTipo,
        estado: 'confirmada',
      })
      if (!res.ok) {
        primerError ??= res.error
        break // no quedan más unidades de este tipo
      }
      const { error: eGrupo } = await supabase
        .from('reservas')
        .update({ grupo_id: grupoId })
        .eq('id', res.reserva.id)
      // No se corta: la reserva quedó creada y las demás del grupo también deben
      // intentarse. Sin el `grupo_id` aparece como individual, que se arregla
      // desde el panel; abortar el lote a medias sería peor.
      registrarFalla(eGrupo, `vínculo de la reserva ${res.reserva.id} con el grupo ${grupoId}`)
      creadas++
    }
  }

  if (creadas === 0) return { error: primerError ?? 'No se pudo crear el grupo.' }

  // Cuántas unidades se habían pedido, para poder comparar contra lo que entró.
  const pedidas = selecciones.reduce((a, s) => a + s.cantidad, 0)

  if (creadas < pedidas) {
    return {
      parcial: {
        creadas,
        pedidas,
        motivo: primerError ?? 'No había más unidades libres para esas fechas.',
        grupoId,
      },
    }
  }

  redirect(`/panel/reservas?grupo=${grupoId}`)
}

/**
 * Envía el recordatorio a los huéspedes que llegan mañana.
 *
 * Es una tarea programada, como `expirar_reservas_pendientes` o
 * `generar_mantenimiento_preventivo`: hoy se dispara a mano desde el panel y en
 * producción iría por cron. Se limita a las reservas activas con email cargado.
 */
export async function enviarRecordatoriosLlegada(): Promise<void> {
  const sesion = await requerirAcceso('reservas')
  if (!sesion) redirect('/login')

  const manana = sumarDias(hoyISO(), 1)
  const supabase = await crearClienteServidor()

  /*
    Se filtra en la BASE, no en JavaScript.

    Antes se traían **todas** las estadías activas y se descartaban en un bucle
    las que no llegaban mañana. Con eso, PostgREST cortaba en 1000 filas —con
    HTTP 200 y sin aviso— y a partir de ahí los recordatorios simplemente dejaban
    de salir para quien quedara del otro lado del corte, sin ningún error.

    `estadias.check_in` es una columna GENERADA desde `periodo` (migración 0037) y
    existe exactamente para esto: permite el filtro por fecha del lado del
    servidor, que PostgREST no puede expresar sobre un `daterange`.
  */
  const { data, error } = await supabase
    .from('estadias')
    .select(
      'reserva:reservas(id, codigo, huesped_id, huesped:huespedes!reservas_huesped_id_fkey(nombre, email))',
    )
    .eq('check_in', manana)
    .in('estado', [...ESTADOS_ACTIVOS])

  // Antes se descartaba: si la consulta fallaba, la pantalla decía «0
  // recordatorios» y eso se lee igual que «no llega nadie mañana».
  cortarSiFalla(error, '/panel/reservas', 'recordatorios')

  const filas = (data ?? []) as unknown as {
    reserva: {
      id: string
      codigo: string
      huesped_id: string | null
      huesped: { nombre: string; email: string | null } | null
    } | null
  }[]

  let encolados = 0
  for (const fila of filas) {
    const r = fila.reserva
    const h = r?.huesped
    if (!r || !h?.email) continue

    /*
      El `discriminante` es la fecha de llegada, y no es un detalle.

      Sin él, la clave sería `recordatorio_checkin:<reserva_id>` y una reserva que
      se reprograma no volvería a recibir aviso nunca. Con la fecha adentro, cada
      llegada tiene el suyo — y apretar el botón dos veces el mismo día sigue
      mandando uno solo, que es lo que hacía falta: antes no tenía idempotencia
      ninguna y dos clics eran dos correos.
    */
    const res = await encolar(crearClienteAdmin(), {
      evento: 'recordatorio_checkin',
      entidadId: r.id,
      discriminante: manana,
      destinatario: h.email,
      huespedId: r.huesped_id,
      reservaId: r.id,
      variables: {
        nombre: h.nombre,
        codigo: r.codigo,
        check_in: formatoFechaCorta(manana),
        hora_check_in: HORA_CHECK_IN,
      },
    })
    // `yaEstaba` no suma: es el mismo recordatorio que ya estaba anotado.
    if (res.ok && !res.yaEstaba) encolados++
  }

  redirect(`/panel/reservas?recordatorios=${encolados}`)
}
