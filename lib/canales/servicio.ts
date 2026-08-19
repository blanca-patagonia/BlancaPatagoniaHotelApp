import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'
import {
  detectarDiscrepancia,
  esEventoMasReciente,
  estadoSegunOperacion,
  tarifaDeCanal,
  validarReservaEntrante,
} from '@/lib/domain/canales'
import { devengarComision } from '@/lib/domain/canales-costos'
import type { CanalVenta, ReservaDeCanal } from '.'

/**
 * Servicio de canales: aterrizar lo que llega y convertirlo en reserva propia.
 *
 * ── Las dos etapas, y por qué están separadas ───────────────────────────────
 *
 *   1. **Aterrizar** (`guardarEntrantes`): lo que manda el canal se guarda crudo
 *      en `canal_reservas`. No toca inventario ni crea nada.
 *   2. **Importar** (`importarEntrante`): recién acá se crea la reserva de verdad,
 *      por el mismo camino atómico que usa recepción.
 *
 * Separarlas es lo que permite que un choque con el anti-overbooking sea
 * **visible**. Si el canal vendió una unidad que el mostrador ya vendió, la
 * restricción de exclusión (ADR 0002) rechaza la estadía — y eso es correcto. Lo
 * que no puede pasar es que la reserva desaparezca: queda en `canal_reservas` con
 * estado `error` y el motivo escrito, para resolverla a mano.
 *
 * Escribir directo en `reservas` habría hecho que ese caso —el más importante de
 * todos— se perdiera en un log.
 */

/* ─────────────────────────────────────────────────────────── aterrizar ──── */

export interface ResumenSincronizacion {
  leidas: number
  nuevas: number
  actualizadas: number
  rechazadas: number
  /** Motivos de rechazo, agrupados para poder mostrarlos sin repetir. */
  motivos: string[]
}

interface FilaGuardada {
  id: string
  emitida_en: string
  estado: string
}

/**
 * Guarda las reservas entrantes en la zona de recepción.
 *
 * ── Idempotencia y orden ────────────────────────────────────────────────────
 *
 * Los canales reenvían, y **no garantizan el orden de entrega**: una modificación
 * vieja puede llegar después de una nueva. Por eso no se hace un `upsert` a secas:
 * se compara `emitidaEn` con lo guardado (`esEventoMasReciente`) y sólo se pisa si
 * el evento entrante es posterior. Sin eso, un reenvío tardío revertiría el estado
 * correcto.
 *
 * Una reserva **ya importada** no se vuelve a tocar salvo que el canal mande algo
 * más nuevo: si el canal la canceló después de que la importamos, hay que verlo.
 */
export async function guardarEntrantes(
  client: SupabaseClient,
  entrantes: readonly ReservaDeCanal[],
  contexto: { canal: CanalVenta; proveedor: string; origen: string; perfilId?: string },
): Promise<ResumenSincronizacion> {
  const resumen: ResumenSincronizacion = {
    leidas: entrantes.length,
    nuevas: 0,
    actualizadas: 0,
    rechazadas: 0,
    motivos: [],
  }

  for (const e of entrantes) {
    // El dominio decide si la reserva es procesable. Se valida antes de tocar la
    // base: es el único momento en que todavía se puede rechazar sin ensuciar datos.
    const motivos = validarReservaEntrante({
      externalId: e.externalId,
      canal: e.canal,
      tipoUnidadCodigo: e.tipoUnidadCodigo,
      checkIn: e.checkIn,
      checkOut: e.checkOut,
      huespedes: e.huespedes,
      apellido: e.huesped.apellido,
      email: e.huesped.email,
      importeCanal: e.importeCanal,
      monedaCanal: e.monedaCanal,
      operacion: e.operacion,
      emitidaEn: e.emitidaEn,
    })

    if (motivos.length > 0) {
      resumen.rechazadas++
      for (const m of motivos) if (!resumen.motivos.includes(m)) resumen.motivos.push(m)
      continue
    }

    const fila = {
      canal: e.canal,
      external_id: e.externalId,
      operacion: e.operacion,
      emitida_en: e.emitidaEn,
      huesped_apellido: e.huesped.apellido,
      huesped_nombre: e.huesped.nombre,
      huesped_email: e.huesped.email,
      huesped_telefono: e.huesped.telefono,
      huesped_pais: e.huesped.pais ?? null,
      tipo_unidad_codigo: e.tipoUnidadCodigo,
      check_in: e.checkIn,
      check_out: e.checkOut,
      huespedes: e.huespedes,
      importe_canal: e.importeCanal,
      moneda_canal: e.monedaCanal,
      comision: e.comision ?? null,
      // El feed iCal no informa la modalidad, así que llega `undefined`: cae en
      // `'desconocida'`, que es el mismo default de la columna y la verdad del caso.
      modalidad_cobro: e.modalidadCobro ?? 'desconocida',
      notas: e.notas ?? '',
    }

    const { data: existente } = await client
      .from('canal_reservas')
      .select('id, emitida_en, estado')
      .eq('canal', e.canal)
      .eq('external_id', e.externalId)
      .maybeSingle<FilaGuardada>()

    if (!existente) {
      const { data: creada, error } = await client
        .from('canal_reservas')
        .insert(fila)
        .select('id')
        .single<{ id: string }>()
      if (error) {
        // No corta: una fila que no entra no justifica abandonar las otras 39.
        registrarFalla(error, `guardar entrante ${e.canal}/${e.externalId}`)
        resumen.rechazadas++
        const m = 'No se pudo guardar en la base.'
        if (!resumen.motivos.includes(m)) resumen.motivos.push(m)
        continue
      }
      resumen.nuevas++
      await devengarComisionDeEntrante(client, e, creada.id, contexto.perfilId)
      continue
    }

    // Ya existe: sólo se pisa si el evento entrante es posterior.
    if (!esEventoMasReciente(e.emitidaEn, existente.emitida_en)) continue

    /*
      ⚠️ La modalidad de cobro NO se pisa con `'desconocida'`.

      Los dos caminos traen datos distintos: el informe CSV sabe quién cobra, el feed
      iCal no. Como el iCal se sondea cada hora y el CSV se sube una vez por semana,
      un `...fila` a secas haría que el primer sondeo posterior **borrara** la
      modalidad que el informe había establecido — y esa reserva desaparecería de la
      lista de cobros sin que nadie lo note.

      Un dato que llega vacío no es un dato que cambió a vacío.
    */
    const { modalidad_cobro: modalidadEntrante, ...resto } = fila
    const { error } = await client
      .from('canal_reservas')
      .update({
        ...resto,
        ...(modalidadEntrante !== 'desconocida' ? { modalidad_cobro: modalidadEntrante } : {}),
        // Si venía marcada como error, el dato nuevo merece otro intento.
        estado: existente.estado === 'error' ? 'pendiente' : existente.estado,
        motivo: '',
      })
      .eq('id', existente.id)

    if (error) {
      registrarFalla(error, `actualizar entrante ${e.canal}/${e.externalId}`)
      resumen.rechazadas++
      continue
    }
    resumen.actualizadas++

    // También en la actualización: el canal puede corregir la comisión de una
    // reserva que ya habíamos aterrizado, y el devengo tiene que reflejarlo. El
    // `on conflict` de la clave de idempotencia hace que un reenvío sin cambios no
    // duplique nada.
    await devengarComisionDeEntrante(client, e, existente.id, contexto.perfilId)
  }

  // Se registra la corrida completa, incluso si no entró nada: «se sincronizó y
  // no había nada nuevo» es una respuesta distinta de «no se sincronizó».
  const { error } = await client.from('canal_sincronizaciones').insert({
    canal: contexto.canal,
    proveedor: contexto.proveedor,
    origen: contexto.origen,
    leidas: resumen.leidas,
    nuevas: resumen.nuevas,
    actualizadas: resumen.actualizadas,
    rechazadas: resumen.rechazadas,
    detalle: resumen.motivos.join(' · ').slice(0, 1000),
    corrida_por: contexto.perfilId ?? null,
  })
  registrarFalla(error, 'registrar la sincronización de canal')

  return resumen
}

/**
 * Devenga la comisión de una entrante en `canal_cargos`.
 *
 * ── Por qué acá y no al importar ────────────────────────────────────────────
 *
 * La comisión existe desde que el canal la informa, **independientemente de que la
 * reserva se importe o no**. Una entrante que queda en `error` por choque de cupo
 * igual va a aparecer en la factura del mes: si el devengo esperara a la
 * importación, esa comisión no estaría en ninguna cuenta y la factura no cerraría
 * sin que nadie supiera por qué.
 *
 * ── Por qué no corta la sincronización ──────────────────────────────────────
 *
 * Va por `registrarFalla` y no por `cortarSiFalla`: el devengo es una escritura
 * **accesoria** respecto de aterrizar la reserva. Si falla, lo que no puede pasar es
 * perder la reserva —que es la operación del hotel— por un problema de contabilidad.
 * Queda en el log del servidor con su contexto, y el reporte de comisión lo va a
 * mostrar como una reserva sin devengo, que es visible.
 *
 * ── Idempotencia ────────────────────────────────────────────────────────────
 *
 * `on conflict (canal, clave_idempotencia) do update` sobre el monto: un reenvío del
 * mismo informe no duplica, y una corrección de la comisión por parte del canal sí
 * se refleja. Lo que **no** se toca en el update es `estado_conciliacion`: si
 * gerencia ya conció ese cargo, un reenvío del archivo no lo vuelve a «devengado».
 */
async function devengarComisionDeEntrante(
  client: SupabaseClient,
  entrante: ReservaDeCanal,
  canalReservaId: string,
  perfilId?: string,
): Promise<void> {
  const cargo = devengarComision({
    comision: entrante.comision,
    monedaCanal: entrante.monedaCanal,
    operacion: entrante.operacion,
    externalId: entrante.externalId,
  })

  // `null` es el caso normal, no un fallo: el feed iCal nunca informa comisión.
  if (!cargo) return

  const { error } = await client.from('canal_cargos').upsert(
    {
      canal: entrante.canal,
      concepto: cargo.concepto,
      origen: cargo.origen,
      canal_reserva_id: canalReservaId,
      monto: cargo.monto,
      moneda: cargo.moneda,
      // El default de `canal_config.imputa_por` es `salida`: la comisión se devenga
      // cuando se consume la estadía, que es con qué criterio factura el canal.
      imputado_el: entrante.checkOut,
      clave_idempotencia: cargo.claveIdempotencia,
      creado_por: perfilId ?? null,
    },
    { onConflict: 'canal,clave_idempotencia' },
  )

  registrarFalla(error, `devengar comisión de ${entrante.canal}/${entrante.externalId}`)
}

/* ──────────────────────────────────────────────────────────── importar ──── */

export type ResultadoImportacion =
  | { ok: true; reservaId: string; codigo: string; aviso?: string }
  | { ok: false; error: string }

interface EntranteFila {
  id: string
  canal: CanalVenta
  external_id: string
  operacion: string
  estado: string
  huesped_apellido: string
  huesped_nombre: string
  huesped_email: string | null
  huesped_telefono: string | null
  huesped_pais: string | null
  tipo_unidad_codigo: string
  check_in: string
  check_out: string
  huespedes: number
  importe_canal: number | string | null
  moneda_canal: string | null
  /**
   * Hasta la migración 0049 este campo **no estaba** —ni acá ni en el `select` de
   * abajo—, así que la comisión se guardaba, se mostraba en la pantalla y se
   * descartaba al importar. Era el único dato del canal que no llegaba a ninguna
   * cuenta.
   */
  comision: number | string | null
  notas: string
  reserva_id: string | null
}

/**
 * Convierte una entrante en reserva propia.
 *
 * ── Lo que este flujo NO hace ───────────────────────────────────────────────
 *
 * **No usa el importe del canal como total.** El precio lo fija el hotel
 * (ADR 0004): se cotiza con nuestro dominio, a tarifa **neto**, porque una venta
 * por OTA es venta de agencia. Lo que informa el canal se compara y, si difiere,
 * se avisa — pero no manda.
 *
 * ── Por qué entra como confirmada ───────────────────────────────────────────
 *
 * `estadoSegunOperacion` la deja `confirmada` y no `pendiente`. El canal ya la
 * cerró con el huésped: tratarla como pendiente la expondría a la expiración
 * automática de la migración 0011 y liberaría una unidad **ya vendida**.
 */
export async function importarEntrante(
  client: SupabaseClient,
  entranteId: string,
  perfilId: string,
): Promise<ResultadoImportacion> {
  const { data: e, error: eLectura } = await client
    .from('canal_reservas')
    .select(
      'id, canal, external_id, operacion, estado, huesped_apellido, huesped_nombre, huesped_email, huesped_telefono, huesped_pais, tipo_unidad_codigo, check_in, check_out, huespedes, importe_canal, moneda_canal, comision, notas, reserva_id',
    )
    .eq('id', entranteId)
    .maybeSingle<EntranteFila>()

  if (eLectura || !e) return { ok: false, error: 'No se encontró la reserva entrante.' }
  if (e.estado === 'importada' && e.reserva_id) {
    return { ok: false, error: 'Esa reserva ya se importó.' }
  }

  // Una cancelada no se importa: no hay reserva que crear. Se marca ignorada, que
  // es distinto de error — no hay nada que arreglar.
  if (e.operacion === 'cancelada') {
    await marcar(client, e.id, 'ignorada', 'El canal la informó como cancelada: no se crea reserva.')
    return { ok: false, error: 'El canal informó esta reserva como cancelada.' }
  }

  // 1) Resolver el tipo de unidad. El código del canal puede no ser el nuestro.
  const { data: tipo } = await client
    .from('tipos_unidad')
    .select('id, codigo')
    .eq('codigo', e.tipo_unidad_codigo)
    .eq('activo', true)
    .maybeSingle<{ id: string; codigo: string }>()

  if (!tipo) {
    const motivo =
      `El canal informó el tipo «${e.tipo_unidad_codigo}», que no existe en el sistema. ` +
      `Creá ese tipo de unidad o corregí el código antes de importar.`
    await marcar(client, e.id, 'error', motivo)
    return { ok: false, error: motivo }
  }

  // 2) Huésped. Se busca por email y sólo por email: es el único dato que el canal
  // manda y que identifica sin ambigüedad. Por apellido se fusionarían dos
  // personas distintas, que es peor que tener dos fichas de la misma.
  let huespedId: string | null = null
  if (e.huesped_email) {
    const { data: existente } = await client
      .from('huespedes')
      .select('id')
      .eq('email', e.huesped_email)
      .maybeSingle<{ id: string }>()
    huespedId = existente?.id ?? null
  }

  if (!huespedId) {
    const { data: nuevo, error: eHuesped } = await client
      .from('huespedes')
      .insert({
        apellido: e.huesped_apellido,
        nombre: e.huesped_nombre || '',
        email: e.huesped_email,
        telefono: e.huesped_telefono,
        nacionalidad: e.huesped_pais,
        notas: `Alta automática desde ${e.canal} (${e.external_id}).`,
      })
      .select('id')
      .single<{ id: string }>()

    if (eHuesped || !nuevo) {
      const motivo = 'No se pudo crear la ficha del huésped.'
      await marcar(client, e.id, 'error', motivo)
      return { ok: false, error: motivo }
    }
    huespedId = nuevo.id
  }

  // 3) Alta por el camino atómico de siempre, con tarifa según el canal.
  const resultado = await crearReservaEnUnidadLibre(client, {
    tipoUnidadId: tipo.id,
    checkIn: e.check_in,
    checkOut: e.check_out,
    huespedes: e.huespedes,
    huespedId,
    canal: e.canal,
    tarifaTipo: tarifaDeCanal(e.canal),
    estado: estadoSegunOperacion('nueva'),
  })

  if (!resultado.ok) {
    // Acá aterriza el choque con el anti-overbooking, y es exactamente por esto
    // que existe la zona de recepción: el motivo queda escrito y visible.
    await marcar(client, e.id, 'error', resultado.error)
    return { ok: false, error: resultado.error }
  }

  // 4) Conciliación: ¿lo que dice el canal coincide con nuestra cuenta?
  const totalPropio = Number(resultado.reserva.total)
  const importeCanal = Number(e.importe_canal ?? 0)
  let aviso: string | undefined

  // Sólo se compara si el canal informó algo: el iCal manda 0 porque no sabe, y
  // avisar de una diferencia contra un cero que nunca fue un precio sería ruido.
  if (importeCanal > 0) {
    const d = detectarDiscrepancia(totalPropio, importeCanal)
    if (d.hay) aviso = d.detalle
  }

  const { error: eMarca } = await client
    .from('canal_reservas')
    .update({
      estado: 'importada',
      motivo: aviso ?? '',
      reserva_id: resultado.reserva.id,
      importada_en: new Date().toISOString(),
      importada_por: perfilId,
    })
    .eq('id', e.id)

  // La reserva ya existe: si falla la marca, no se deshace nada, se registra. Al
  // reintentar, el `estado !== 'importada'` haría un duplicado, así que el aviso
  // en el log es lo que permite detectarlo.
  registrarFalla(eMarca, `marcar como importada la entrante ${e.id}`)

  // 5) El cargo de comisión ya existía desde que se aterrizó (con
  //    `canal_reserva_id` pero sin `reserva_id`, porque la reserva no existía
  //    todavía). Recién acá se puede completar el vínculo, y es lo que permite
  //    responder «cuánto me costó ESTA venta» y cruzar comisión con ocupación.
  const { error: eVinculo } = await client
    .from('canal_cargos')
    .update({ reserva_id: resultado.reserva.id })
    .eq('canal_reserva_id', e.id)
    .is('reserva_id', null)

  registrarFalla(eVinculo, `vincular los cargos de la entrante ${e.id} a su reserva`)

  return { ok: true, reservaId: resultado.reserva.id, codigo: resultado.reserva.codigo, aviso }
}

/** Marca una entrante con su estado y motivo. */
async function marcar(
  client: SupabaseClient,
  id: string,
  estado: 'error' | 'ignorada' | 'pendiente',
  motivo: string,
): Promise<void> {
  const { error } = await client.from('canal_reservas').update({ estado, motivo }).eq('id', id)
  registrarFalla(error, `marcar la entrante ${id} como ${estado}`)
}
