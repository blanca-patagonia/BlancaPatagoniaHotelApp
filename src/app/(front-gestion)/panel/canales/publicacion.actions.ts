'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cortarSiFalla } from '@/lib/acciones'
import { esDireccion } from '@/lib/domain/permisos'
import { publicarAri } from '@/lib/canales/ari'
import { requerirAcceso } from '@/lib/auth/session'

/**
 * Lo que el hotel PUBLICA en el canal (ADR 0032): el mapeo de tipos, la
 * publicación del ARI y las restricciones por fecha (migración 0087).
 * ⚠️ Con el proveedor real esto NO evita el overbooking (ver la pantalla).
 */

const DESTINO = '/panel/canales'

/* ─────────────────────────────────── publicación al canal (ARI) ────────── */

/**
 * Guarda con qué código conoce el canal a un tipo de unidad, y sus restricciones.
 *
 * ── El defecto que cierra (auditoría 2026-09, P1-1) ─────────────────────────
 *
 * `importarEntrante` resolvía el tipo con `eq('codigo', tipo_unidad_codigo)`, o
 * sea asumiendo que el código del canal **es** el nuestro, con un comentario al
 * lado diciendo que puede no serlo. Si Booking llama «DBL-LAGO» a lo que el
 * sistema llama «DOBLE_VISTA», había que renombrar el tipo del hotel para que la
 * importación funcionara. Y del lado saliente directamente no había dónde decirlo.
 */
export async function guardarMapeoCanal(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('canales')

  // El mapeo lleva el inventario que el hotel se reserva para la venta directa y
  // qué tipos tiene cerrados en cada OTA: es estrategia comercial, no mostrador.
  if (!esDireccion(sesion.rol)) {
    redirect(`${DESTINO}?vista=publicacion&error=mapeo_rol`)
  }

  const tipoId = String(formData.get('tipo_unidad_id') ?? '')
  const codigo = String(formData.get('codigo_canal') ?? '').trim().slice(0, 60)
  if (!tipoId) redirect(`${DESTINO}?vista=publicacion`)

  /*
    Con el ancla `#tipo-<id>` (el mismo id que la fila lleva en `page.tsx`), el
    navegador scrollea solo hasta ahí al aterrizar. Sin esto, guardar la fila
    23 de 23 devolvía al principio de la página y el aviso de "Guardado"
    quedaba a una pantalla y media de distancia de lo que se acababa de
    editar — parecía que no había pasado nada.
  */
  const volver = `${DESTINO}?vista=publicacion`
  const ancla = `#tipo-${tipoId}`

  if (!codigo) redirect(`${volver}&error=mapeo_codigo${ancla}`)

  const topeCrudo = String(formData.get('tope_cupo') ?? '').trim()
  const minimoCrudo = String(formData.get('minimo_noches') ?? '').trim()
  const tope = topeCrudo === '' ? null : Number(topeCrudo)
  const minimo = minimoCrudo === '' ? null : Number(minimoCrudo)

  if (tope !== null && (!Number.isInteger(tope) || tope < 0)) {
    redirect(`${volver}&error=mapeo_tope${ancla}`)
  }
  if (minimo !== null && (!Number.isInteger(minimo) || minimo < 1)) {
    redirect(`${volver}&error=mapeo_minimo${ancla}`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canal_tipos').upsert(
    {
      canal: 'booking',
      tipo_unidad_id: tipoId,
      codigo_canal: codigo,
      tope_cupo: tope,
      minimo_noches: minimo,
      cerrado: String(formData.get('cerrado') ?? '') === 'on',
      activo: true,
      actualizado_por: sesion.userId,
    },
    { onConflict: 'canal,tipo_unidad_id' },
  )

  // 23505 acá sólo puede ser el otro único: dos tipos con el mismo código del
  // canal. Se traduce, porque el mensaje de Postgres no dice qué hacer.
  if (error?.code === '23505') {
    redirect(`${volver}&error=mapeo_codigo_repetido${ancla}`)
  }
  cortarSiFalla(error, volver, 'mapeo')

  revalidatePath(DESTINO)
  redirect(`${volver}&ok=mapeo${ancla}`)
}

/**
 * Publica ahora la disponibilidad al canal, sin esperar al cron.
 *
 * ⚠️ Con los proveedores disponibles hoy —informe CSV y feed iCal, los dos de
 * solo lectura— esto calcula las filas y el proveedor responde `noSoportado`. La
 * pantalla lo dice con esas palabras: **no es un error**, es la limitación del
 * ADR 0021, y la corrida queda registrada igual para que se vea que se intentó.
 */
export async function publicarAhora(): Promise<void> {
  const sesion = await requerirAcceso('canales')

  if (!esDireccion(sesion.rol)) {
    redirect(`${DESTINO}?vista=publicacion&error=mapeo_rol`)
  }

  const r = await publicarAri('booking', { corridaPor: sesion.userId })

  revalidatePath(DESTINO)
  // El resultado ya quedó en `canal_sincronizaciones`, que es lo que la pantalla
  // muestra: no hace falta arrastrarlo por la URL.
  redirect(`${DESTINO}?vista=publicacion&ok=${r.ok ? 'publicado' : 'publicado_sin_efecto'}`)
}

/* ─────────────────────────────── restricciones por fecha (0087) ────────── */

/**
 * Carga una restricción de venta para un rango de fechas.
 *
 * ── Por qué es de gerencia ──────────────────────────────────────────────────
 *
 * Cerrar fechas en una OTA es decidir cuánto inventario se le deja al canal y
 * cuándo: es una decisión comercial, no una tarea de mostrador. Mismo criterio
 * que `guardarMapeoCanal`, aunque el área `canales` sí alcance a recepción para
 * lo operativo. La política RLS de la 0087 declara los mismos dos roles.
 */
export async function guardarRestriccionCanal(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('canales')

  if (!esDireccion(sesion.rol)) {
    redirect(`${DESTINO}?vista=publicacion&error=restriccion_rol`)
  }

  const desde = String(formData.get('desde') ?? '')
  const hasta = String(formData.get('hasta') ?? '')
  const tipoUnidadId = String(formData.get('tipo_unidad_id') ?? '')
  const minimoCrudo = String(formData.get('minimo_noches') ?? '').trim()
  const cerrado = formData.get('cerrado') === 'on'
  const cerradoLlegada = formData.get('cerrado_llegada') === 'on'
  const cerradoSalida = formData.get('cerrado_salida') === 'on'
  const nota = String(formData.get('nota') ?? '').trim().slice(0, 200)

  if (!desde || !hasta) redirect(`${DESTINO}?vista=publicacion&error=restriccion_fechas`)

  /*
    El fin es EXCLUIDO, igual que en estadías y temporadas. Se valida `hasta >
    desde` y no `>=`: un rango vacío no restringe nada, y la base además lo
    rechaza con el `check` de `isempty`.
  */
  if (hasta <= desde) redirect(`${DESTINO}?vista=publicacion&error=restriccion_fechas`)

  const minimoNoches = minimoCrudo ? Number(minimoCrudo) : null
  if (minimoNoches !== null && (!Number.isInteger(minimoNoches) || minimoNoches < 1)) {
    redirect(`${DESTINO}?vista=publicacion&error=restriccion_minimo`)
  }

  /*
    Una fila que no restringe nada parece una restricción activa en la pantalla y
    no restringe nada: el síntoma sería «cargué el bloqueo y el canal siguió
    vendiendo». La base tiene el mismo `check`; acá se comprueba antes para poder
    explicarlo en español en vez de mostrar un error de Postgres.
  */
  if (minimoNoches === null && !cerrado && !cerradoLlegada && !cerradoSalida) {
    redirect(`${DESTINO}?vista=publicacion&error=restriccion_vacia`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canal_restricciones').insert({
    canal: 'booking',
    // Vacío = todos los tipos, que es el caso más común.
    tipo_unidad_id: tipoUnidadId || null,
    periodo: `[${desde},${hasta})`,
    minimo_noches: minimoNoches,
    cerrado,
    cerrado_llegada: cerradoLlegada,
    cerrado_salida: cerradoSalida,
    nota,
    creado_por: sesion.userId,
  })

  cortarSiFalla(error, `${DESTINO}?vista=publicacion`, 'restriccion')

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=publicacion&ok=restriccion`)
}

/**
 * Levanta una restricción.
 *
 * Se borra en vez de desactivarse: una restricción vencida o levantada no aporta
 * nada al historial —lo que importa es qué rige hoy— y una lista que acumula
 * fechas viejas se vuelve ilegible justo cuando hay que revisarla rápido.
 */
export async function borrarRestriccionCanal(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('canales')

  if (!esDireccion(sesion.rol)) {
    redirect(`${DESTINO}?vista=publicacion&error=restriccion_rol`)
  }

  const id = String(formData.get('id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.from('canal_restricciones').delete().eq('id', id)
    cortarSiFalla(error, `${DESTINO}?vista=publicacion`, 'restriccion_borrar')
  }

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=publicacion&ok=restriccion_borrada`)
}
