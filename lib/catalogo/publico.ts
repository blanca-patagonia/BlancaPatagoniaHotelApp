import 'server-only'
import { unstable_cache } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { envServidor } from '@/lib/env'

/**
 * Catálogo público cacheado (Fase 5 de la auditoría — deuda de rendimiento).
 *
 * ── El problema ──────────────────────────────────────────────────────────────
 *
 * Las pantallas de `/alojamientos` leen `tipos_unidad`, `tarifas` y `temporadas`
 * en **cada visita**. No hay una sola primitiva de caché en todo el borde
 * público: `crearClienteServidor()` llama a `cookies()`, que es una API dinámica,
 * así que Next renderiza esas rutas por pedido aunque su contenido cambie una vez
 * por mes. La primera temporada alta, con el catálogo indexado desde Google, eso
 * es tráfico contra la base que no hacía falta.
 *
 * ── Por qué se puede cachear esto y NO la disponibilidad ─────────────────────
 *
 * El catálogo cambia cuando un admin edita una tarifa o una temporada: es raro y
 * tiene un momento puntual. La **disponibilidad** cambia con cada reserva, y
 * publicar una vencida es vender una unidad ya vendida —el mismo daño que el
 * ADR 0022 evita en el feed iCal—. Por eso la disponibilidad y las cotizaciones
 * viven en `/reservar`, que este módulo no toca, y siguen siendo por pedido.
 *
 * ── Invalidación ────────────────────────────────────────────────────────────
 *
 * Etiqueta `catalogo-publico`, que las acciones de `/panel/config` disparan con
 * `revalidateTag` al guardar. El `revalidate: 300` es la red de seguridad: si
 * alguien cambia el catálogo por fuera del panel (el dashboard de Supabase), la
 * web se pone al día sola en cinco minutos.
 *
 * ── Cliente sin cookies ─────────────────────────────────────────────────────
 *
 * `unstable_cache` no admite `cookies()` adentro. Este cliente va con la
 * publishable key y sin sesión: ve exactamente lo que ve `anon`, que es todo lo
 * que el catálogo necesita. La `service_role` NO se usa acá —sería leer con
 * privilegio algo que se publica—.
 */

export const ETIQUETA_CATALOGO = 'catalogo-publico'
const VIGENCIA_S = 300

function clienteCatalogo() {
  const env = envServidor()
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export interface TipoUnidadPublico {
  id: string
  codigo: string
  nombre: string
  categoria: string
  capacidad_max: number
  descripcion: string | null
  amenities: unknown
}

export interface TarifaPublica {
  tipo_unidad_id: string
  precio_rack: number | string
  iva_pct: number | string
}

/** Tipos de unidad activos. Cacheado. */
export const tiposUnidadPublicos = unstable_cache(
  async (): Promise<TipoUnidadPublico[]> => {
    const { data, error } = await clienteCatalogo()
      .from('tipos_unidad')
      .select('id, codigo, nombre, categoria, capacidad_max, descripcion, amenities')
      .eq('activo', true)
    if (error) throw new Error(`Catálogo: no se pudieron leer los tipos de unidad: ${error.message}`)
    return (data ?? []) as TipoUnidadPublico[]
  },
  ['catalogo-tipos-unidad'],
  { tags: [ETIQUETA_CATALOGO], revalidate: VIGENCIA_S },
)

/**
 * Tarifas vigentes, **solo `precio_rack`** — el neto es de agencia y `anon` no
 * tiene privilegio sobre esa columna (migración 0031). Cacheado.
 */
export const tarifasPublicas = unstable_cache(
  async (): Promise<TarifaPublica[]> => {
    const { data, error } = await clienteCatalogo()
      .from('tarifas')
      .select('tipo_unidad_id, precio_rack, iva_pct')
      .eq('vigente', true)
    if (error) throw new Error(`Catálogo: no se pudieron leer las tarifas: ${error.message}`)
    return (data ?? []) as TarifaPublica[]
  },
  ['catalogo-tarifas'],
  { tags: [ETIQUETA_CATALOGO], revalidate: VIGENCIA_S },
)
