'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'
import { obtenerProveedorCanal } from '@/lib/canales'
import { interpretarCsvBooking, normalizarEncabezado } from '@/lib/canales/csv'
import { firmaEncabezados } from '@/lib/domain/mapeo-columnas'
import { guardarEntrantes, importarEntrante } from '@/lib/canales/servicio'
import { hoyISO, sumarDias } from '@/lib/fechas'
import { requerirAcceso } from '@/lib/auth/session'

/**
 * Acciones del área de canales de venta: lo que ENTRA del canal (sondeo,
 * importación del CSV del extranet, convertir una entrante en reserva o
 * descartarla).
 *
 * El resto vive al lado, un archivo por tema (todos terminan en `actions.ts`
 * para que `tests/contratos/autorizacion-acciones.test.ts` los vigile):
 *  · `mensajes.actions.ts`    mensajes del huésped por el canal
 *  · `resenas.actions.ts`     reseñas: importar, cargar, vincular, responder
 *  · `cobros.actions.ts`      la plata del canal: transferencias, comisiones, conciliación
 *  · `publicacion.actions.ts` mapeo de tipos, publicar el ARI, restricciones por fecha
 *
 * Todas verifican `requerirAcceso('canales')`: el área ya está declarada para
 * admin, gerencia y recepción en `lib/domain/permisos.ts`.
 */

const DESTINO = '/panel/canales'

/* ──────────────────────────────────────────────────── sondeo automático ──── */

/**
 * Corre el proveedor configurado y aterriza lo que traiga.
 *
 * Con `CANAL_PROVIDER=booking-ical` lee los feeds del extranet. Con el simulado no
 * trae nada, y eso es correcto: la corrida queda registrada igual, así que la
 * pantalla puede decir «se sincronizó y no había nada» en vez de dejar la duda.
 */
export async function sincronizarCanal(): Promise<void> {
  const sesion = await requerirAcceso('canales')

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
    // Mismo sondeo que el cron: foto completa del feed, así que lo ausente se
    // marca como presunta cancelación. Ver el encabezado de la migración 0074.
    instantanea: {
      desde: sumarDias(hoyISO(), 1),
      // Lo que no se pudo leer no se da por ausente (ver `tiposSinDatos`).
      tiposSinDatos: proveedor.tiposSinDatos?.() ?? [],
    },
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
  const sesion = await requerirAcceso('canales')

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

  const { data: mapeo, error: eMapeo } = await supabaseLectura
    .from('canal_mapeos_columnas')
    .select('asignaciones')
    .eq('canal', 'booking')
    .eq('tipo_informe', 'reservas')
    .eq('firma_encabezados', firma)
    .eq('activo', true)
    .maybeSingle<{ asignaciones: Record<string, string> }>()
  // Si falla, se sigue con `primeraPasada` (mismo comportamiento que "no hay
  // mapeo guardado"): el peor caso es pedirle de nuevo el mapeo a alguien que
  // ya lo había configurado, no perder el informe. Pero que quede logueado.
  registrarFalla(eMapeo, 'canales:mapeo_columnas')

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
  const sesion = await requerirAcceso('canales')

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
  await requerirAcceso('canales')

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
  await requerirAcceso('canales')

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
