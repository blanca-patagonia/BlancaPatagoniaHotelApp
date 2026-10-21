import 'server-only'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import type { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { obtenerProveedorCotizacion } from '@/lib/divisas'
import {
  MINUTOS_FRESCURA,
  resolverVigente,
  validarCotizacion,
  type Cotizacion,
  type CotizacionVigente,
  type Fuente,
  type MonedaExtranjera,
  type Origen,
} from '@/lib/domain/divisas'

/**
 * Servicio de cotizaciones: la cadena de caída completa.
 *
 * ── El requisito que manda ──────────────────────────────────────────────────
 *
 * **Una caída de la API externa no puede bloquear la creación de una reserva.**
 * Es pedido explícito del usuario y la razón por la que este módulo tiene tres
 * niveles de respaldo en vez de uno:
 *
 *     1. caché en memoria del proceso  (evita golpear la base en cada render)
 *     2. fuente externa               (DolarAPI / ArgentinaDatos)
 *     3. última guardada en la base   (sirve aunque tenga horas)
 *     4. → si nada de eso hay: `null`, y la pantalla muestra USD
 *
 * El paso 4 es el que cierra la garantía: `null` no es un error, es «no hay
 * conversión disponible». El USD es la moneda real del sistema (ADR 0003), así
 * que mostrar USD nunca es incorrecto — es apenas menos cómodo.
 *
 * Quién decide qué valor gana no es este módulo: es `resolverVigente` en el
 * dominio, que ya está probado sin base ni red.
 */

/* ────────────────────────────────────────────────── caché en memoria ──── */

interface Entrada {
  vigente: CotizacionVigente
  /** Cuándo se resolvió, para medir la vida de la entrada del caché. */
  resueltaEn: number
}

/**
 * Caché por proceso.
 *
 * Es best-effort a propósito: en serverless cada instancia tiene la suya y no se
 * comparten. No importa — el respaldo real es la tabla `cotizaciones`, que sí es
 * compartida. Esto sólo evita que diez renders seguidos del panel disparen diez
 * llamadas a un servicio gratuito de un tercero, que además de lento sería
 * abusivo.
 */
const cache = new Map<MonedaExtranjera, Entrada>()

/** Vida de la entrada del caché, alineada con la frescura del dominio. */
const CACHE_MS = MINUTOS_FRESCURA * 60_000

/** Vacía el caché. Existe para los tests y para el botón de refresco manual. */
export function limpiarCacheCotizaciones(): void {
  cache.clear()
}

/* ─────────────────────────────────────────────────────────── lectura ──── */

interface FilaCotizacion {
  moneda: string
  compra: number | string
  venta: number | string
  fuente: string
  obtenida_en: string
}

/** Convierte una fila de la base al tipo del dominio, o `null` si no sirve. */
function desdeFila(f: FilaCotizacion): Cotizacion | null {
  const c: Cotizacion = {
    moneda: f.moneda as MonedaExtranjera,
    // `numeric` de Postgres llega como string por el driver: si no se convierte,
    // `venta` sería texto y las multiplicaciones darían concatenaciones.
    compra: Number(f.compra),
    venta: Number(f.venta),
    fuente: f.fuente as Fuente,
    obtenidaEn: new Date(f.obtenida_en).toISOString(),
  }
  return validarCotizacion(c).length === 0 ? c : null
}

/**
 * Última cotización guardada de cada fuente para una moneda.
 *
 * Se traen las más recientes de todas las fuentes y no sólo la última absoluta,
 * porque `resolverVigente` necesita las candidatas para poder elegir: un valor
 * manual de hace diez minutos tiene que poder ganarle a uno automático de hace
 * dos horas.
 */
async function guardadas(
  moneda: MonedaExtranjera,
): Promise<{ cotizacion: Cotizacion; origen: Origen }[]> {
  const admin = crearClienteAdmin()

  const { data, error } = await admin
    .from('cotizaciones')
    .select('moneda, compra, venta, fuente, obtenida_en')
    .eq('moneda', moneda)
    .order('obtenida_en', { ascending: false })
    // Alcanza para tener la última de cada fuente (hay tres). Se piden unas
    // cuantas más por si una fuente publicó varias veces seguidas.
    .limit(12)

  if (error) {
    // No corta: quedarse sin el respaldo de la base es grave, pero menos que
    // frenar un cobro. Queda en el log del servidor.
    registrarFalla(error, `leer cotizaciones guardadas de ${moneda}`)
    return []
  }

  const vistas = new Set<string>()
  const salida: { cotizacion: Cotizacion; origen: Origen }[] = []

  for (const f of (data ?? []) as FilaCotizacion[]) {
    if (vistas.has(f.fuente)) continue
    const c = desdeFila(f)
    if (!c) continue
    vistas.add(f.fuente)
    salida.push({ cotizacion: c, origen: c.fuente === 'manual' ? 'manual' : 'almacenada' })
  }

  return salida
}

/* ─────────────────────────────────────────────────────────── escritura ──── */

/**
 * Guarda una cotización recién traída de una fuente externa.
 *
 * Va por el cliente admin (`service_role`) y no por el del usuario a propósito:
 * es una **escritura del sistema**, disparada por un refresco automático, no una
 * acción de quien está mirando la pantalla. La política RLS reserva el `insert`
 * a `admin`/`gerencia` porque fijar la cotización a mano define a qué precio
 * cobra el hotel; si el refresco automático fuera por el cliente del usuario,
 * recepción no podría ni ver el widget.
 *
 * El duplicado no es un error: la restricción `cotizaciones_sin_duplicados` hace
 * que reinsertar el mismo valor publicado no haga nada. Se detecta por el código
 * `23505` y se ignora en silencio.
 */
async function guardar(c: Cotizacion): Promise<void> {
  const admin = crearClienteAdmin()

  const { error } = await admin.from('cotizaciones').insert({
    moneda: c.moneda,
    compra: c.compra,
    venta: c.venta,
    fuente: c.fuente,
    obtenida_en: c.obtenidaEn,
  })

  // 23505 = unique_violation. Es el camino esperado mientras la fuente no
  // publique un valor nuevo, así que no se registra como falla.
  if (error && error.code !== '23505') {
    registrarFalla(error, `guardar cotización de ${c.moneda} (${c.fuente})`)
  }
}

/* ────────────────────────────────────────────────────────── resolución ──── */

/**
 * Cotización vigente de una moneda, con toda la cadena de respaldo.
 *
 * Nunca lanza. Devuelve `null` sólo cuando no hay ningún valor utilizable en
 * ninguna parte, y en ese caso quien llama muestra USD.
 *
 * @param forzar salta el caché en memoria. Lo usa el botón de refresco.
 */
export async function cotizacionVigente(
  moneda: MonedaExtranjera,
  { forzar = false }: { forzar?: boolean } = {},
): Promise<CotizacionVigente | null> {
  const ahora = new Date()

  if (!forzar) {
    const enCache = cache.get(moneda)
    if (enCache && ahora.getTime() - enCache.resueltaEn < CACHE_MS) return enCache.vigente
  }

  const candidatas: { cotizacion: Cotizacion; origen: Origen }[] = []

  // 1. La fuente externa. `traer` ya está blindado: devuelve `null` ante red
  //    caída, timeout, JSON raro o valor que no pasa la validación del dominio.
  //    El try/catch es por si una implementación futura rompiera ese contrato.
  try {
    const viva = await obtenerProveedorCotizacion().traer(moneda)
    if (viva) {
      candidatas.push({ cotizacion: viva, origen: 'vivo' })
      // Se guarda antes de responder: si el proceso se cae o la API se cae
      // después, este valor ya quedó disponible para el resto del sistema.
      await guardar(viva)
    }
  } catch (e) {
    // `registrarFalla` espera algo con `.message`; de un `catch` puede venir
    // cualquier cosa, incluido un string lanzado a mano.
    registrarFalla(
      { message: e instanceof Error ? e.message : String(e) },
      `consultar la fuente de cotización de ${moneda}`,
    )
  }

  // 2. Lo guardado, siempre. No sólo cuando la fuente falló: puede haber un
  //    valor manual más reciente que el automático, y ése tiene que poder ganar.
  candidatas.push(...(await guardadas(moneda)))

  const vigente = resolverVigente(candidatas, ahora)
  if (vigente) cache.set(moneda, { vigente, resueltaEn: ahora.getTime() })

  return vigente
}

/**
 * Registra una cotización cargada a mano.
 *
 * Se hace con el cliente del usuario y no con el admin, justamente para que la
 * política RLS decida: sólo `admin` y `gerencia` pueden fijar a qué precio cobra
 * el hotel. Devuelve el error para que la pantalla lo muestre, según la regla de
 * la Fase 20.
 */
export async function registrarCotizacionManual(
  cliente: Awaited<ReturnType<typeof crearClienteServidor>>,
  datos: { moneda: MonedaExtranjera; compra: number; venta: number; perfilId: string },
): Promise<{ error?: string }> {
  const { error } = await cliente.from('cotizaciones').insert({
    moneda: datos.moneda,
    compra: datos.compra,
    venta: datos.venta,
    fuente: 'manual',
    // La carga manual vale desde ahora: es lo que hace que le gane a un valor
    // automático viejo en `resolverVigente`.
    obtenida_en: new Date().toISOString(),
    cargada_por: datos.perfilId,
  })

  if (error) {
    registrarFalla(error, `cargar cotización manual de ${datos.moneda}`)
    return { error: 'No se pudo guardar la cotización. Probá de nuevo.' }
  }

  // El caché quedó con el valor anterior: sin esto, el número nuevo no aparece
  // hasta que venza la ventana y quien lo cargó cree que no se guardó.
  limpiarCacheCotizaciones()
  return {}
}
