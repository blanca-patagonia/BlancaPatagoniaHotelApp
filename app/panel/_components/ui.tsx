import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icono, type NombreIcono } from './iconos'
import { construirQuery, resumenRango, totalPaginas } from '@/lib/listados'

/*
  Componentes de interfaz compartidos por todo el panel.

  Son deliberadamente de servidor (sin estado ni eventos): así cualquier página
  puede usarlos sin arrastrar JavaScript al cliente. Centralizarlos evita que
  cada pantalla repita las mismas clases de Tailwind a mano.
*/

export type Tono = 'neutro' | 'lago' | 'exito' | 'alerta' | 'peligro' | 'calafate'

const TONO_ETIQUETA: Record<Tono, string> = {
  neutro: 'bg-stone-100 text-stone-700 ring-stone-200',
  lago: 'bg-lago-50 text-lago-800 ring-lago-200',
  exito: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  alerta: 'bg-lenga-50 text-lenga-800 ring-lenga-200',
  peligro: 'bg-red-50 text-red-700 ring-red-200',
  calafate: 'bg-calafate-50 text-calafate-800 ring-calafate-200',
}

/* ---------------------------------------------------------------- botones -- */

export type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro'

const BOTON: Record<VarianteBoton, string> = {
  primario:
    'bg-lago-700 text-white shadow-sm hover:bg-lago-800 active:bg-lago-900 disabled:bg-stone-300',
  secundario:
    'border border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50 disabled:text-stone-400',
  fantasma: 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
  peligro: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
}

/** Clases de botón, para reutilizar en `<button>`, `<Link>` o `<a>`. */
export function botonClases(variante: VarianteBoton = 'secundario', extra = ''): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${BOTON[variante]} ${extra}`.trim()
}

/* ------------------------------------------------------------ encabezado -- */

interface EncabezadoProps {
  titulo: string
  descripcion?: string
  icono?: NombreIcono
  /** Botones o enlaces alineados a la derecha. */
  acciones?: ReactNode
}

/** Encabezado estándar de cada pantalla del panel. */
export function Encabezado({ titulo, descripcion, icono, acciones }: EncabezadoProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-4">
      <div className="flex items-start gap-3">
        {icono && (
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-lago-50 text-lago-700 ring-1 ring-lago-100">
            <Icono nombre={icono} tam={20} />
          </span>
        )}
        <div>
          <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-stone-900">
            {titulo}
          </h1>
          {descripcion && <p className="mt-0.5 text-sm text-stone-500">{descripcion}</p>}
        </div>
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  )
}

/* --------------------------------------------------------------- tarjeta -- */

interface TarjetaProps {
  titulo?: string
  descripcion?: string
  acciones?: ReactNode
  children: ReactNode
  className?: string
}

/** Contenedor blanco con borde suave, unidad visual básica del panel. */
export function Tarjeta({ titulo, descripcion, acciones, children, className = '' }: TarjetaProps) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-3.5">
          <div>
            {titulo && <h2 className="font-display text-base font-semibold text-stone-900">{titulo}</h2>}
            {descripcion && <p className="text-xs text-stone-500">{descripcion}</p>}
          </div>
          {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------- kpi -- */

interface KpiProps {
  titulo: string
  valor: string
  detalle?: string
  icono?: NombreIcono
  tono?: Tono
  /** Si se indica, toda la tarjeta se vuelve un enlace. */
  href?: string
}

/** Tarjeta de indicador para los tableros. */
export function Kpi({ titulo, valor, detalle, icono, tono = 'lago', href }: KpiProps) {
  const contenido = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">{titulo}</p>
        {icono && (
          <span
            className={`flex size-7 items-center justify-center rounded-lg ring-1 ${TONO_ETIQUETA[tono]}`}
          >
            <Icono nombre={icono} tam={15} />
          </span>
        )}
      </div>
      <p className="tabular mt-2 font-display text-3xl leading-none font-semibold text-stone-900">
        {valor}
      </p>
      {detalle && <p className="mt-1.5 text-xs text-stone-400">{detalle}</p>}
    </>
  )

  const clases = 'rounded-2xl border border-stone-200 bg-white p-4 shadow-sm'
  if (href) {
    return (
      <Link href={href} className={`${clases} block transition hover:border-lago-300 hover:shadow`}>
        {contenido}
      </Link>
    )
  }
  return <div className={clases}>{contenido}</div>
}

/* -------------------------------------------------------------- etiqueta -- */

/** Píldora de estado (badge). */
export function Etiqueta({
  children,
  tono = 'neutro',
}: {
  children: ReactNode
  tono?: Tono
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONO_ETIQUETA[tono]}`}
    >
      {children}
    </span>
  )
}

/* ---------------------------------------------------------- estado vacío -- */

/** Mensaje para listados sin resultados, con una acción sugerida opcional. */
export function EstadoVacio({
  titulo,
  descripcion,
  icono = 'buscar',
  accion,
}: {
  titulo: string
  descripcion?: string
  icono?: NombreIcono
  accion?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
        <Icono nombre={icono} tam={22} />
      </span>
      <p className="font-medium text-stone-700">{titulo}</p>
      {descripcion && <p className="max-w-sm text-sm text-stone-500">{descripcion}</p>}
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  )
}

/* ----------------------------------------------------------------- tabla -- */

/**
 * Envoltorio de tabla con scroll horizontal propio: en pantallas chicas la
 * tabla se desplaza sola en lugar de desbordar la página entera.
 */
export function Tabla({ children, resumen }: { children: ReactNode; resumen: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <caption className="sr-only">{resumen}</caption>
        {children}
      </table>
    </div>
  )
}

export const TH = 'px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-stone-500 uppercase'
export const TD = 'px-4 py-2.5 align-middle'
export const FILA = 'border-t border-stone-100 transition hover:bg-lago-50/40'

/* ------------------------------------------------------------- buscador -- */

interface BuscadorProps {
  /** Ruta del listado (destino del formulario). */
  accion: string
  valor?: string
  etiqueta: string
  placeholder?: string
  /** Filtros vigentes que hay que conservar al buscar. */
  ocultos?: Record<string, string | undefined>
}

/**
 * Buscador por GET: funciona sin JavaScript y deja la búsqueda en la URL, así
 * el usuario puede compartirla o guardarla en favoritos.
 */
export function Buscador({ accion, valor, etiqueta, placeholder, ocultos = {} }: BuscadorProps) {
  return (
    <form method="get" action={accion} className="flex items-center gap-2" role="search">
      {Object.entries(ocultos).map(([clave, val]) =>
        val ? <input key={clave} type="hidden" name={clave} value={val} /> : null,
      )}
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-stone-400">
          <Icono nombre="buscar" tam={16} />
        </span>
        <input
          type="search"
          name="q"
          defaultValue={valor ?? ''}
          placeholder={placeholder}
          aria-label={etiqueta}
          className="w-56 rounded-lg border border-stone-300 bg-white py-2 pr-3 pl-8 text-sm text-stone-800 placeholder:text-stone-400 focus:border-lago-500 focus:outline-none"
        />
      </div>
      <button type="submit" className={botonClases('secundario')}>
        Buscar
      </button>
    </form>
  )
}

/* ----------------------------------------------------------- paginación -- */

interface PaginacionProps {
  base: string
  params: Record<string, string | undefined>
  pagina: number
  total: number
  tamanio?: number
}

/** Controles de página con el detalle de cuántos resultados se están viendo. */
export function Paginacion({ base, params, pagina, total, tamanio }: PaginacionProps) {
  const paginas = totalPaginas(total, tamanio)
  const hayAnterior = pagina > 1
  const haySiguiente = pagina < paginas

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-4 py-3 text-sm">
      <p className="tabular text-stone-500">{resumenRango(pagina, total, tamanio)}</p>
      {paginas > 1 && (
        <nav className="flex items-center gap-1" aria-label="Paginación">
          {hayAnterior ? (
            <Link
              href={`${base}${construirQuery(params, { pagina: pagina - 1 === 1 ? undefined : pagina - 1 })}`}
              className={botonClases('secundario', 'px-2')}
              aria-label="Página anterior"
              rel="prev"
            >
              <Icono nombre="anterior" tam={16} />
            </Link>
          ) : (
            <span className={`${botonClases('secundario', 'px-2')} opacity-40`} aria-hidden="true">
              <Icono nombre="anterior" tam={16} />
            </span>
          )}
          <span className="tabular px-2 text-stone-600">
            {pagina} / {paginas}
          </span>
          {haySiguiente ? (
            <Link
              href={`${base}${construirQuery(params, { pagina: pagina + 1 })}`}
              className={botonClases('secundario', 'px-2')}
              aria-label="Página siguiente"
              rel="next"
            >
              <Icono nombre="siguiente" tam={16} />
            </Link>
          ) : (
            <span className={`${botonClases('secundario', 'px-2')} opacity-40`} aria-hidden="true">
              <Icono nombre="siguiente" tam={16} />
            </span>
          )}
        </nav>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- filtros -- */

/** Enlace de filtro con forma de píldora (activo / inactivo). */
export function Chip({
  href,
  activo,
  children,
}: {
  href: string
  activo: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={activo ? 'page' : undefined}
      className={`rounded-full px-3 py-1 text-sm font-medium transition ${
        activo
          ? 'bg-lago-700 text-white shadow-sm'
          : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50 hover:text-stone-900'
      }`}
    >
      {children}
    </Link>
  )
}

/** Barra superior de un listado: buscador + filtros + acciones. */
export function BarraHerramientas({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
      {children}
    </div>
  )
}

/* ------------------------------------------------------------- exportar -- */

/** Enlace de descarga del listado en CSV. */
export function BotonExportar({ href, titulo = 'Exportar CSV' }: { href: string; titulo?: string }) {
  return (
    <a href={href} className={botonClases('secundario')} download>
      <Icono nombre="descargar" tam={16} />
      {titulo}
    </a>
  )
}

/* ---------------------------------------------------------------- avisos -- */

/** Banner de error o de confirmación por encima del contenido. */
export function Mensaje({ tono, children }: { tono: 'error' | 'ok'; children: ReactNode }) {
  const esError = tono === 'error'
  return (
    <div
      role={esError ? 'alert' : 'status'}
      className={`mb-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ring-1 ${
        esError
          ? 'bg-red-50 text-red-800 ring-red-200'
          : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      }`}
    >
      <span className="mt-0.5 shrink-0">
        <Icono nombre={esError ? 'alerta' : 'ok'} tam={16} />
      </span>
      <span>{children}</span>
    </div>
  )
}
