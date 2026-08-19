'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'
import { obtenerProveedorCanal } from '@/lib/canales'
import { interpretarCsvBooking, normalizarEncabezado } from '@/lib/canales/csv'
import { firmaEncabezados } from '@/lib/domain/mapeo-columnas'
import { guardarEntrantes, importarEntrante } from '@/lib/canales/servicio'
import { interpretarCsvResenas } from '@/lib/canales/resenas-csv'
import { guardarResenas } from '@/lib/canales/resenas-servicio'
import { saldarSiCorresponde } from '@/lib/reservas/saldar'
import { hoyISO } from '@/lib/fechas'
import {
  MODALIDADES_COBRO,
  referenciaTransferenciaCanal,
  type ModalidadCobro,
} from '@/lib/domain/canales-cobro'

/**
 * Acciones del área de canales de venta.
 *
 * Las cuatro operaciones que hay: sincronizar (sondeo automático), importar un
 * archivo CSV del extranet, convertir una entrante en reserva, y descartarla.
 *
 * Todas verifican `puedeAcceder(rol, 'canales')` en vez del literal
 * `['admin','gerencia','recepcion']`, que es lo que pide `AGENTS.md` para el
 * código nuevo. El área ya está declarada para esos tres roles en
 * `lib/domain/permisos.ts`, así que no hay dos fuentes de verdad.
 */

const DESTINO = '/panel/canales'

/** Sesión con permiso sobre el área, o afuera. */
async function exigirAcceso() {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'canales')) redirect('/panel')
  return sesion
}

/* ──────────────────────────────────────────────────── sondeo automático ──── */

/**
 * Corre el proveedor configurado y aterriza lo que traiga.
 *
 * Con `CANAL_PROVIDER=booking-ical` lee los feeds del extranet. Con el simulado no
 * trae nada, y eso es correcto: la corrida queda registrada igual, así que la
 * pantalla puede decir «se sincronizó y no había nada» en vez de dejar la duda.
 */
export async function sincronizarCanal(): Promise<void> {
  const sesion = await exigirAcceso()

  const proveedor = obtenerProveedorCanal()
  if (!proveedor.capacidades().traeReservas) {
    redirect(`${DESTINO}?error=sin_sondeo`)
  }

  let entrantes
  try {
    entrantes = await proveedor.traerReservas(new Date().toISOString())
  } catch (e) {
    // El proveedor promete no lanzar, pero si una implementación futura rompe ese
    // contrato la pantalla tiene que decirlo, no quedarse colgada.
    registrarFalla(
      { message: e instanceof Error ? e.message : String(e) },
      'sondear el canal de venta',
    )
    redirect(`${DESTINO}?error=sondeo`)
  }

  const supabase = await crearClienteServidor()
  const resumen = await guardarEntrantes(supabase, entrantes, {
    canal: 'booking',
    proveedor: proveedor.nombre,
    origen: 'sondeo',
    perfilId: sesion.userId,
  })

  revalidatePath(DESTINO)
  redirect(
    `${DESTINO}?ok=sincro&nuevas=${resumen.nuevas}&actualizadas=${resumen.actualizadas}&rechazadas=${resumen.rechazadas}`,
  )
}

/* ─────────────────────────────────────────────────────── importar CSV ──── */

export interface EstadoImportacionCsv {
  error?: string
  ok?: string
  /** Detalle de las filas que quedaron afuera, para mostrarlas una por una. */
  rechazadas?: { fila: number; motivos: string[] }[]
  advertencia?: string
  /**
   * Nombre del borrador de mapeo que quedó guardado, cuando el lector no pudo
   * interpretar el archivo. La pantalla lo usa para ofrecer el link a mapear en vez
   * de dejar al usuario con un error sin salida.
   */
  mapear?: string
}

/**
 * Importa el «Informe de reservas» descargado del extranet.
 *
 * Devuelve estado en vez de redirigir porque el resultado es **detallado**: si el
 * archivo trae 40 reservas y entraron 38, hay que poder ver las dos que faltan y
 * por qué. Eso no cabe en un `?error=` de la URL.
 *
 * Tope de tamaño: el informe de un hotel de 15 unidades no pasa de unos cientos de
 * kilobytes. El límite existe para que un archivo equivocado —un PDF, un ZIP— no
 * se lea entero en memoria antes de descubrir que no era un CSV.
 */
const MAX_BYTES = 5 * 1024 * 1024

export async function importarCsvCanal(
  _prev: EstadoImportacionCsv,
  formData: FormData,
): Promise<EstadoImportacionCsv> {
  const sesion = await exigirAcceso()

  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Elegí el archivo CSV que bajaste del extranet.' }
  }
  if (archivo.size > MAX_BYTES) {
    return { error: 'El archivo es demasiado grande. ¿Seguro que es el informe de reservas?' }
  }

  const texto = await archivo.text()
  const supabaseLectura = await crearClienteServidor()

  /*
    Se busca un mapeo guardado ANTES de leer. Si alguien ya dijo qué columna es cuál
    para este formato, el diccionario de alias no tiene que volver a adivinar.

    Se busca por `firma_encabezados`, pero la firma sale de los encabezados del
    archivo… que todavía no leímos. Se resuelve leyendo dos veces: la primera pasada
    sin mapeo devuelve los encabezados igual —eso es lo que cambió en el lector— y con
    ellos se calcula la firma y se busca. La segunda pasada usa lo que se encontró.

    Son dos pasadas sobre un archivo de unos cientos de kilobytes en memoria, sin
    tocar la base de más. La alternativa —adivinar la firma o guardar el archivo entre
    peticiones— es peor.
  */
  const primeraPasada = interpretarCsvBooking(texto)
  const firma = firmaEncabezados(primeraPasada.encabezados, normalizarEncabezado)

  const { data: mapeo } = await supabaseLectura
    .from('canal_mapeos_columnas')
    .select('asignaciones')
    .eq('canal', 'booking')
    .eq('tipo_informe', 'reservas')
    .eq('firma_encabezados', firma)
    .eq('activo', true)
    .maybeSingle<{ asignaciones: Record<string, string> }>()

  const resultado = mapeo
    ? interpretarCsvBooking(texto, 'booking', mapeo.asignaciones)
    : primeraPasada

  if (resultado.faltantes.length > 0) {
    /*
      Antes esto devolvía un texto y ahí moría: «bajá el informe sin modificarlo» es
      inútil si el export de esta cuenta simplemente tiene otros encabezados.

      Ahora se guarda un borrador con los encabezados y la muestra —el archivo NO se
      guarda: son datos de huéspedes y no hay Storage— y se manda a la pantalla de
      mapeo. El usuario asigna una vez, vuelve, y sube el archivo de nuevo. Es una
      sola vez en la vida del formato.
    */
    const { error: eBorrador } = await supabaseLectura.from('canal_mapeos_columnas').upsert(
      {
        canal: 'booking',
        tipo_informe: 'reservas',
        nombre: archivo.name.slice(0, 80) || 'Formato sin nombre',
        firma_encabezados: firma,
        asignaciones: {},
        muestra: { encabezados: resultado.encabezados, valores: resultado.muestra },
        // Borrador: no se usa para importar hasta que alguien lo complete.
        activo: false,
        creado_por: sesion.userId,
      },
      { onConflict: 'canal,tipo_informe,nombre' },
    )

    if (eBorrador) {
      // Si no se pudo guardar el borrador, al menos se dice qué falta. Perder el
      // borrador es molesto; perder el mensaje sería dejar al usuario sin salida.
      registrarFalla(eBorrador, 'guardar el borrador de mapeo de columnas')
      return {
        error:
          `No se reconocieron las columnas del archivo. Faltan: ${resultado.faltantes.join(', ')}.`,
      }
    }

    return {
      error:
        `No se reconocieron las columnas de este archivo. Faltan: ${resultado.faltantes.join(', ')}.`,
      mapear: archivo.name.slice(0, 80) || 'Formato sin nombre',
    }
  }

  if (resultado.reservas.length === 0 && resultado.rechazadas.length === 0) {
    return { error: 'El archivo no tiene ninguna reserva.' }
  }

  const resumen = await guardarEntrantes(supabaseLectura, resultado.reservas, {
    canal: 'booking',
    proveedor: 'csv',
    origen: archivo.name,
    perfilId: sesion.userId,
  })

  revalidatePath(DESTINO)

  return {
    ok:
      `Se leyeron ${resultado.leidas} fila(s): ${resumen.nuevas} nueva(s), ` +
      `${resumen.actualizadas} actualizada(s), ${resumen.rechazadas + resultado.rechazadas.length} sin importar.`,
    rechazadas: resultado.rechazadas.length > 0 ? resultado.rechazadas : undefined,
    // La ambigüedad día/mes no se puede resolver mirando el archivo, así que se
    // avisa: una reserva en la fecha equivocada no la detecta nadie hasta que el
    // huésped aparece.
    advertencia:
      resultado.fechasAmbiguas > 0
        ? `${resultado.fechasAmbiguas} fecha(s) se pudieron leer de dos formas (día/mes o mes/día) ` +
          `y se interpretaron como día/mes. Revisá esas reservas antes de importarlas.`
        : undefined,
  }
}

/* ──────────────────────────────────────────────────── importar una ──── */

/** Convierte una entrante en reserva propia. */
export async function importarUna(formData: FormData): Promise<void> {
  const sesion = await exigirAcceso()

  const id = String(formData.get('entrante_id') ?? '')
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const r = await importarEntrante(supabase, id, sesion.userId)

  revalidatePath(DESTINO)
  revalidatePath('/panel/reservas')

  if (!r.ok) {
    // El motivo ya quedó escrito en la fila (`canal_reservas.motivo`), así que la
    // pantalla lo muestra en su lugar sin necesidad de pasarlo por la URL.
    redirect(`${DESTINO}?error=importar`)
  }

  redirect(
    r.aviso
      ? `${DESTINO}?ok=importada_con_aviso&codigo=${encodeURIComponent(r.codigo)}`
      : `${DESTINO}?ok=importada&codigo=${encodeURIComponent(r.codigo)}`,
  )
}

/** Descarta una entrante sin importarla (duplicada, de prueba, ya cargada a mano). */
export async function ignorarEntrante(formData: FormData): Promise<void> {
  await exigirAcceso()

  const id = String(formData.get('entrante_id') ?? '')
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_reservas')
    .update({ estado: 'ignorada', motivo: 'Descartada a mano desde el panel.' })
    .eq('id', id)

  cortarSiFalla(error, DESTINO, 'ignorar')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?ok=ignorada`)
}

/** Vuelve una entrante a pendiente, para reintentar después de arreglar la causa. */
export async function reintentarEntrante(formData: FormData): Promise<void> {
  await exigirAcceso()

  const id = String(formData.get('entrante_id') ?? '')
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_reservas')
    .update({ estado: 'pendiente', motivo: '' })
    .eq('id', id)

  cortarSiFalla(error, DESTINO, 'reintentar')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?ok=reintentar`)
}

/* ─────────────────────────────────────────────── mensajes y reseñas ──── */

/** Marca un mensaje del huésped como atendido. */
export async function marcarMensajeAtendido(formData: FormData): Promise<void> {
  const sesion = await exigirAcceso()

  const id = String(formData.get('mensaje_id') ?? '')
  const atendido = String(formData.get('atendido') ?? '') === 'true'
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_mensajes')
    .update({
      atendido: !atendido,
      atendido_por: !atendido ? sesion.userId : null,
    })
    .eq('id', id)

  cortarSiFalla(error, `${DESTINO}?vista=mensajes`, 'mensaje')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=mensajes`)
}

/**
 * Carga a mano un mensaje o petición que llegó por el canal.
 *
 * Es manual porque **ni el CSV ni el iCal traen los mensajes**: eso requiere la
 * API de mensajería de Booking, que va con la Connectivity API. Cargarlos a mano
 * igual sirve — un pedido de cuna sin atender termina siendo una queja en la
 * reseña, y tenerlo en el sistema es mejor que en la memoria de quien lo leyó.
 */
export async function cargarMensaje(formData: FormData): Promise<void> {
  await exigirAcceso()

  const cuerpo = String(formData.get('cuerpo') ?? '').trim()
  if (!cuerpo) redirect(`${DESTINO}?vista=mensajes&error=cuerpo`)

  const entranteId = String(formData.get('entrante_id') ?? '')

  /*
    El autor sale del formulario en vez de estar fijado en `'huesped'`.

    El `check` de la base ya permitía `'hotel'` desde la migración 0038, pero el valor
    nunca se usaba: no había forma de registrar la respuesta del hotel, así que el
    módulo guardaba media conversación. Sin la respuesta, «mensaje sin atender» es la
    única información disponible, y no se puede saber qué se le contestó al huésped.
  */
  const autor = String(formData.get('autor') ?? 'huesped')
  if (autor !== 'huesped' && autor !== 'hotel') {
    redirect(`${DESTINO}?vista=mensajes&error=autor`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canal_mensajes').insert({
    canal: 'booking',
    cuerpo,
    autor,
    canal_reserva_id: entranteId || null,
    // Un mensaje que escribe el hotel nace atendido: es la respuesta, no un pedido
    // pendiente. Sin esto, responder aumentaría el contador de «sin atender».
    ...(autor === 'hotel' ? { atendido: true } : {}),
  })

  cortarSiFalla(error, `${DESTINO}?vista=mensajes`, 'mensaje')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=mensajes&ok=mensaje`)
}

/* ──────────────────────────────────────────────── importar reseñas ──── */

export interface EstadoImportacionResenas {
  error?: string
  ok?: string
  rechazadas?: { fila: number; motivos: string[] }[]
  /** Cuántas quedaron sin ligar, para ofrecer resolverlas. */
  sinLigar?: number
}

/**
 * Importa el export de reseñas del extranet.
 *
 * ── Lo que resuelve ────────────────────────────────────────────────────────
 *
 * Hasta acá `canal_resenas` existía con las columnas correctas y **sin ningún camino
 * de ingesta**: solo un formulario manual que escribía cinco campos, así que
 * `external_id`, `reserva_id`, `pais` y `titulo` nunca se llenaban y una reseña
 * cargada a mano no quedaba ligada a nada.
 *
 * La API de reseñas de Booking es de partner, así que el export del extranet es el
 * único camino disponible — y es suficiente: trae puntaje, texto, fecha y a veces el
 * número de reserva.
 */
export async function importarResenasCanal(
  _prev: EstadoImportacionResenas,
  formData: FormData,
): Promise<EstadoImportacionResenas> {
  const sesion = await exigirAcceso()

  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Elegí el archivo de reseñas que bajaste del extranet.' }
  }
  if (archivo.size > MAX_BYTES) {
    return { error: 'El archivo es demasiado grande. ¿Seguro que es el export de reseñas?' }
  }

  const resultado = interpretarCsvResenas(await archivo.text())

  if (resultado.faltantes.length > 0) {
    return {
      error:
        'No se reconoció la columna con el nombre de quien escribió la reseña, que es la única ' +
        'imprescindible. Revisá que el archivo sea el export de reseñas y no otro.',
    }
  }

  if (resultado.resenas.length === 0 && resultado.rechazadas.length === 0) {
    return { error: 'El archivo no tiene ninguna reseña.' }
  }

  const supabase = await crearClienteServidor()
  const resumen = await guardarResenas(supabase, resultado.resenas, {
    canal: 'booking',
    origen: archivo.name,
    perfilId: sesion.userId,
  })

  revalidatePath(DESTINO)

  return {
    ok:
      `Se leyeron ${resumen.leidas} reseña(s): ${resumen.nuevas} nueva(s), ` +
      `${resumen.actualizadas} actualizada(s). ${resumen.ligadas} quedaron ligadas a su reserva.`,
    rechazadas: resultado.rechazadas.length > 0 ? resultado.rechazadas : undefined,
    sinLigar: resumen.sinLigar > 0 ? resumen.sinLigar : undefined,
  }
}

/**
 * Liga una reseña a una reserva, a mano.
 *
 * El vínculo queda marcado como `'manual'`, y eso importa: reimportar el archivo **no**
 * lo pisa. Si alguien ya decidió a qué reserva pertenece, la heurística no tiene
 * autoridad para cambiarlo.
 */
export async function vincularResena(formData: FormData): Promise<void> {
  await exigirAcceso()

  const resenaId = String(formData.get('resena_id') ?? '')
  const reservaId = String(formData.get('reserva_id') ?? '')
  if (!resenaId) redirect(`${DESTINO}?vista=resenas&error=falta_id`)

  const supabase = await crearClienteServidor()

  // Cadena vacía = desvincular. Es un caso legítimo: alguien se dio cuenta de que la
  // había ligado mal.
  const { error } = await supabase
    .from('canal_resenas')
    .update(
      reservaId
        ? { reserva_id: reservaId, vinculo: 'manual', motivo_sin_vinculo: '' }
        : {
            reserva_id: null,
            vinculo: 'sin_vincular',
            motivo_sin_vinculo: 'Se desvinculó a mano.',
          },
    )
    .eq('id', resenaId)

  cortarSiFalla(error, `${DESTINO}?vista=resenas`, 'vincular')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=resenas&ok=${reservaId ? 'vinculada' : 'desvinculada'}`)
}

/**
 * Registra la transferencia que el canal hizo al hotel.
 *
 * ── Por qué esto es lo más cerca de una «notificación de pago» ──────────────
 *
 * Sin ser Connectivity Partner **no hay** aviso de «Booking te pagó»: no existe
 * webhook ni push. Lo que sí se puede hacer es que, cuando alguien ve la
 * transferencia en el extracto del banco o en la liquidación del extranet, la
 * registre acá — y que eso cierre la fila en la lista de conciliación.
 *
 * ── Idempotencia sin tabla nueva ni enum nuevo ───────────────────────────────
 *
 * El pago se inserta con `external_id = 'booking-payout:<referencia>'`. Como
 * `pagos.external_id` ya tiene restricción única (migración 0009, puesta para los
 * webhooks de pasarela), registrar dos veces la misma liquidación **choca con la base
 * en vez de duplicar la plata**. Y `medio` va como `'transferencia'` en lugar de
 * agregarle un valor `'canal'` al enum: una transferencia de Booking **es** una
 * transferencia, y tocar el enum habría exigido dos migraciones (SQLSTATE 55P04).
 */
export async function registrarTransferenciaCanal(formData: FormData): Promise<void> {
  const sesion = await exigirAcceso()

  const entranteId = String(formData.get('entrante_id') ?? '')
  const referencia = String(formData.get('referencia') ?? '').trim().slice(0, 60)
  const monto = Number(formData.get('monto'))

  if (!entranteId) redirect(`${DESTINO}?vista=cobros&error=falta_id`)
  if (!referencia) redirect(`${DESTINO}?vista=cobros&error=transf_referencia`)
  if (!Number.isFinite(monto) || monto <= 0) {
    redirect(`${DESTINO}?vista=cobros&error=transf_monto`)
  }

  const supabase = await crearClienteServidor()

  const { data: entrante, error: eLectura } = await supabase
    .from('canal_reservas')
    .select('canal, reserva_id')
    .eq('id', entranteId)
    .maybeSingle<{ canal: string; reserva_id: string | null }>()

  cortarSiFalla(eLectura, `${DESTINO}?vista=cobros`, 'transf_lectura')
  if (!entrante) redirect(`${DESTINO}?vista=cobros&error=transf_no_existe`)

  // Sin reserva propia no hay a qué imputarle el pago. Pasa si la entrante todavía
  // no se importó, y el mensaje lo dice en vez de fallar por una FK.
  if (!entrante.reserva_id) redirect(`${DESTINO}?vista=cobros&error=transf_sin_reserva`)

  const { error: ePago } = await supabase.from('pagos').insert({
    reserva_id: entrante.reserva_id,
    medio: 'transferencia',
    tipo: 'saldo',
    monto,
    estado: 'aprobado',
    external_id: referenciaTransferenciaCanal(entrante.canal, referencia),
    nota: `Liquidación de ${entrante.canal}, referencia ${referencia}.`,
    creado_por: sesion.userId,
  })

  // 23505 = la misma liquidación ya se registró. NO es un error del usuario: es la
  // idempotencia funcionando, y decirle «ya estaba» es más útil que un error genérico.
  if (ePago?.code === '23505') {
    redirect(`${DESTINO}?vista=cobros&ok=transf_repetida`)
  }
  cortarSiFalla(ePago, `${DESTINO}?vista=cobros`, 'transf_pago')

  // Se anota cuándo se liquidó. Escritura accesoria: el pago ya está registrado y es
  // lo que importa, así que un fallo acá no puede tapar el éxito del cobro.
  const { error: eFecha } = await supabase
    .from('canal_reservas')
    .update({ liquidado_en: hoyISO() })
    .eq('id', entranteId)
  registrarFalla(eFecha, `anotar la fecha de liquidación de la entrante ${entranteId}`)

  // Puede haber quedado saldada: se recalcula por el camino compartido.
  const { error: eSaldada } = await saldarSiCorresponde(supabase, entrante.reserva_id)
  registrarFalla(
    eSaldada ? { message: eSaldada } : null,
    `saldar la reserva ${entrante.reserva_id} tras la transferencia del canal`,
  )

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=cobros&ok=transferencia`)
}

/**
 * Fija quién cobra, en una entrante o en todas las que están sin determinar.
 *
 * ── Por qué existe la opción «todas» ────────────────────────────────────────
 *
 * Cuando el informe del extranet no trae la columna de forma de pago, **todas** las
 * reservas quedan en `desconocida`. Obligar a tocar 40 filas de a una garantiza que
 * nadie lo haga, y la lista queda inútil.
 *
 * En la práctica un hotel chico suele tener una sola modalidad activa por temporada,
 * así que «todas las que no sabemos, cobra el hotel» resuelve el caso real en un clic.
 * Sigue siendo una afirmación de una persona, no una suposición del sistema — que es
 * la diferencia que importa.
 */
export async function fijarModalidadCobro(formData: FormData): Promise<void> {
  await exigirAcceso()

  const modalidad = String(formData.get('modalidad') ?? '')
  if (!MODALIDADES_COBRO.includes(modalidad as ModalidadCobro)) {
    redirect(`${DESTINO}?vista=cobros&error=modalidad_invalida`)
  }

  const entranteId = String(formData.get('entrante_id') ?? '')
  const todas = String(formData.get('todas') ?? '') === '1'

  if (!entranteId && !todas) redirect(`${DESTINO}?vista=cobros&error=falta_id`)

  const supabase = await crearClienteServidor()

  const consulta = supabase.from('canal_reservas').update({ modalidad_cobro: modalidad })
  const { error } = todas
    ? // Solo las que están sin determinar: no se pisan las que alguien ya resolvió.
      await consulta.eq('canal', 'booking').eq('modalidad_cobro', 'desconocida')
    : await consulta.eq('id', entranteId)

  cortarSiFalla(error, `${DESTINO}?vista=cobros`, 'modalidad')

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=cobros&ok=modalidad`)
}

/**
 * Registra la factura de comisión del canal.
 *
 * ── Qué hace y qué NO hace ──────────────────────────────────────────────────
 *
 * Crea **dos** cosas: la línea en `canal_cargos` con `origen = 'factura_comision'`
 * —que es la que se compara contra lo devengado— y el asiento en
 * `movimientos_proveedor`, que es el que hereda la antigüedad de saldos, el
 * vencimiento y el estado del comprobante (0022, 0026).
 *
 * **No concilia sola.** La pantalla muestra devengado, facturado y diferencia antes
 * de que alguien apriete nada, y esta acción no marca los cargos como conciliados:
 * decidir que una diferencia es aceptable es una decisión de gerencia, no un efecto
 * secundario de cargar un número.
 *
 * ── Por qué exige el proveedor configurado ──────────────────────────────────
 *
 * Sin `canal_config.proveedor_id` no hay contra quién asentar la deuda. Se corta con
 * un mensaje accionable en vez de crear la línea del cargo y dejar el asiento a
 * medias, que es el estado del que después nadie se acuerda.
 */
export async function registrarFacturaComision(formData: FormData): Promise<void> {
  const sesion = await exigirAcceso()

  // Registrar una factura mueve el libro mayor: es de gerencia, no del mostrador.
  // La política RLS de `movimientos_proveedor` ya lo impone; se verifica acá también
  // para poder explicarlo en español en vez de mostrar un error de base.
  if (sesion.rol !== 'admin' && sesion.rol !== 'gerencia') {
    redirect(`${DESTINO}?vista=costos&error=factura_rol`)
  }

  const comprobante = String(formData.get('comprobante') ?? '').trim().slice(0, 60)
  const monto = Number(formData.get('monto'))
  const periodo = String(formData.get('periodo') ?? '').trim()
  const vencimiento = String(formData.get('vencimiento') ?? '').trim()

  if (!comprobante) redirect(`${DESTINO}?vista=costos&error=factura_comprobante`)
  if (!Number.isFinite(monto) || monto <= 0) {
    redirect(`${DESTINO}?vista=costos&error=factura_monto`)
  }
  // `periodo` llega como `YYYY-MM` de un `<input type="month">`: se normaliza al
  // primer día, que es con qué la vista de conciliación agrupa (`date_trunc`).
  if (!/^\d{4}-\d{2}$/.test(periodo)) redirect(`${DESTINO}?vista=costos&error=factura_periodo`)
  const imputadoEl = `${periodo}-01`

  const supabase = await crearClienteServidor()

  const { data: config, error: eConfig } = await supabase
    .from('canal_config')
    .select('proveedor_id')
    .eq('canal', 'booking')
    .maybeSingle<{ proveedor_id: string | null }>()

  cortarSiFalla(eConfig, `${DESTINO}?vista=costos`, 'factura_config')
  if (!config?.proveedor_id) redirect(`${DESTINO}?vista=costos&error=factura_sin_proveedor`)

  // 1) El asiento del libro mayor. Va primero: si falla, no queda una línea de
  //    cargo sin contrapartida contable.
  const { data: movimiento, error: eMov } = await supabase
    .from('movimientos_proveedor')
    .insert({
      proveedor_id: config.proveedor_id,
      tipo: 'cargo',
      monto,
      concepto: `Comisión Booking ${periodo}`,
      comprobante,
      vencimiento: vencimiento || null,
      creado_por: sesion.userId,
    })
    .select('id')
    .single<{ id: string }>()

  cortarSiFalla(eMov, `${DESTINO}?vista=costos`, 'factura_movimiento')

  // 2) La línea comparable contra lo devengado. `canal_reserva_id` queda nulo: es
  //    el total del mes, no el costo de una reserva puntual.
  const { error: eCargo } = await supabase.from('canal_cargos').insert({
    canal: 'booking',
    concepto: 'comision',
    origen: 'factura_comision',
    monto,
    imputado_el: imputadoEl,
    movimiento_proveedor_id: movimiento?.id ?? null,
    clave_idempotencia: `factura_comision:comision:${comprobante}`,
    detalle: `Factura ${comprobante} del período ${periodo}.`,
    creado_por: sesion.userId,
  })

  // Si esto falla, el asiento contable ya existe. NO se deshace con `cortarSiFalla`
  // encadenado —taparía cuál de las dos escrituras falló— y borrar el movimiento
  // sería peor: la deuda con el canal es real y perderla es el fallo más caro.
  // Queda el aviso y el movimiento visible en Proveedores.
  if (eCargo?.code === '23505') {
    redirect(`${DESTINO}?vista=costos&error=factura_repetida`)
  }
  cortarSiFalla(eCargo, `${DESTINO}?vista=costos`, 'factura_cargo')

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=costos&ok=factura`)
}

/** Carga a mano una reseña publicada en el canal. */
export async function cargarResena(formData: FormData): Promise<void> {
  await exigirAcceso()

  const autor = String(formData.get('autor') ?? '').trim()
  const puntajeCrudo = Number(formData.get('puntaje'))
  const positivo = String(formData.get('positivo') ?? '').trim()
  const negativo = String(formData.get('negativo') ?? '').trim()

  // Booking puntúa de 1 a 10. Un valor fuera de rango lo rechaza el `check` de la
  // base, pero se corta antes para poder explicarlo en español.
  if (!Number.isFinite(puntajeCrudo) || puntajeCrudo < 0 || puntajeCrudo > 10) {
    redirect(`${DESTINO}?vista=resenas&error=puntaje`)
  }
  if (!positivo && !negativo) {
    redirect(`${DESTINO}?vista=resenas&error=resena_vacia`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canal_resenas').insert({
    canal: 'booking',
    autor: autor || 'Anónimo',
    puntaje: puntajeCrudo,
    positivo,
    negativo,
    publicada_en: String(formData.get('publicada_en') ?? '') || null,
  })

  cortarSiFalla(error, `${DESTINO}?vista=resenas`, 'resena')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=resenas&ok=resena`)
}

/** Guarda la respuesta del hotel a una reseña. */
export async function responderResena(formData: FormData): Promise<void> {
  await exigirAcceso()

  const id = String(formData.get('resena_id') ?? '')
  const respuesta = String(formData.get('respuesta') ?? '').trim()
  if (!id) redirect(`${DESTINO}?error=falta_id`)
  if (!respuesta) redirect(`${DESTINO}?vista=resenas&error=respuesta_vacia`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_resenas')
    .update({ respuesta, respondida: true })
    .eq('id', id)

  cortarSiFalla(error, `${DESTINO}?vista=resenas`, 'respuesta')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=resenas&ok=respuesta`)
}
