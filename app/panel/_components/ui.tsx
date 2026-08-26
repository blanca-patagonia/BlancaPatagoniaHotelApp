import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icono, type NombreIcono } from './iconos'
import { construirQuery, resumenRango, totalPaginas } from '@/lib/listados'
import { ETIQUETAS_ESTADO_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { PUNTO_HK, SIMBOLO_HK } from './estilos'

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

/*
  Las CUATRO variantes llevan borde, y las dos que no lo necesitan lo llevan
  transparente. Es lo que hace que midan todas lo mismo.

  Antes `secundario` y `peligro` tenían `border` y `primario` y `fantasma` no.
  Con el mismo `px-3 py-2`, eso son 38 px contra 36: medido en el navegador,
  «+ Nueva reserva» daba 36 px al lado de «Ver ocupación» con 38, en la misma fila
  del `Encabezado` y alineados al centro, así que el botón principal quedaba 1 px
  más bajo arriba y abajo que sus vecinos. Pasaba en seis pantallas, y además
  `canales` alterna la variante según el estado: el botón cambiaba de alto solo.

  Un borde transparente no se ve —`background-clip` es `border-box`, así que el
  fondo propio del botón se pinta por debajo— y no toca el contraste ni el foco.
*/
const BOTON: Record<VarianteBoton, string> = {
  primario:
    'border border-transparent bg-lago-700 text-white shadow-sm hover:bg-lago-800 active:bg-lago-900 disabled:bg-stone-300',
  secundario:
    'border border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50 disabled:text-stone-400',
  fantasma:
    'border border-transparent text-stone-600 hover:bg-stone-100 hover:text-stone-900',
  peligro: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
}

/**
 * Clases de botón, para reutilizar en `<button>`, `<Link>` o `<a>`.
 *
 * Lleva `toque` porque un `<Link>` se renderiza como `<a>` y la regla de altura
 * mínima táctil de `globals.css` solo alcanza a `button`: sin esta clase, los
 * botones que en realidad son enlaces quedaban por debajo del área mínima.
 */
export function botonClases(variante: VarianteBoton = 'secundario', extra = ''): string {
  return `toque inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${BOTON[variante]} ${extra}`.trim()
}

/* ----------------------------------------------------------- contenedor -- */

/**
 * Contenedor de una pantalla del panel.
 *
 * Cada pantalla elegía su propio ancho (`max-w-2xl`, `3xl`, `5xl`, `6xl`,
 * `7xl`): al navegar, el contenido saltaba de lugar y la aplicación se sentía
 * inestable. Un único ancho hace que el encabezado, la barra de herramientas y
 * las tarjetas queden siempre alineados en el mismo eje.
 *
 * Hay tres anchos y cada uno responde a una razón, no al gusto de cada
 * pantalla:
 * · `angosto` para formularios de una columna, donde una línea de texto
 *   demasiado larga cansa la lectura.
 * · `normal` para todo lo demás.
 * · `ancho` solo para la grilla de ocupación, que es un calendario y necesita
 *   mostrar la mayor cantidad de días posible.
 */
export function Pagina({
  children,
  ancho = 'normal',
}: {
  children: ReactNode
  ancho?: 'normal' | 'angosto' | 'ancho'
}) {
  const MAX = { angosto: 'max-w-3xl', normal: 'max-w-6xl', ancho: 'max-w-7xl' } as const
  return <div className={`mx-auto w-full ${MAX[ancho]}`}>{children}</div>
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
    /*
      `min-w-0` no es decorativo: es lo que impide que una tarjeta ensanche a su
      contenedor.

      Una tarjeta casi siempre es ítem de una grilla o de un flex, y ahí rige
      `min-width: auto`: la caja no baja del ancho mínimo de su contenido. Basta
      con un `truncate` adentro —que incluye `white-space: nowrap`— para que ese
      mínimo sea la línea ENTERA. En el hub, «Fernández de la Vega Etchegoyen,
      María de los Ángeles Guadalupe» daba 515 px de mínimo y estiraba la tarjeta a
      557 px dentro de una pantalla de 320: la página entera se iba de lado y el
      `truncate`, que estaba justamente para evitarlo, no llegaba a activarse nunca.

      Poniéndolo acá y no en cada llamador, la regla vale para las ~90 tarjetas del
      panel. Solo relaja una restricción: una tarjeta que hoy entra, sigue entrando.
    */
    <section className={`min-w-0 rounded-2xl border border-stone-200 bg-white shadow-sm ${className}`}>
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
      {detalle && <p className="mt-1.5 text-xs text-stone-600">{detalle}</p>}
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
      <span className="flex size-11 items-center justify-center rounded-2xl bg-stone-100 text-stone-600">
        <Icono nombre={icono} tam={22} />
      </span>
      <p className="font-medium text-stone-700">{titulo}</p>
      {descripcion && <p className="max-w-sm text-sm text-stone-500">{descripcion}</p>}
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  )
}

/* ------------------------------------------------------- estado de unidad -- */

/**
 * Indicador del estado de limpieza de una unidad: color **y** símbolo.
 *
 * Reemplaza al punto de color suelto que había en las tres pantallas que lo
 * mostraban (inicio, ocupación y housekeeping). El color solo no alcanza —ver
 * `SIMBOLO_HK` en `estilos.ts`—, así que acá van juntos, más el nombre del
 * estado accesible.
 *
 * `conTexto` para cuando al lado no hay una etiqueta que ya lo diga; si la hay,
 * el nombre viaja igual por `title` y por el texto solo-lectores.
 */
export function EstadoUnidad({
  estado,
  conTexto = false,
}: {
  estado: EstadoHousekeeping
  conTexto?: boolean
}) {
  const etiqueta = ETIQUETAS_ESTADO_HK[estado]
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5" title={etiqueta}>
      <span
        aria-hidden="true"
        className={`flex size-4 items-center justify-center rounded-full text-[9px] leading-none font-bold text-white ${PUNTO_HK[estado]}`}
      >
        {SIMBOLO_HK[estado]}
      </span>
      {conTexto ? (
        <span className="text-sm text-stone-700">{etiqueta}</span>
      ) : (
        <span className="sr-only">{etiqueta}</span>
      )}
    </span>
  )
}

/* ----------------------------------------------------------------- tabla -- */

/**
 * Envoltorio de tabla con scroll horizontal propio: en pantallas chicas la
 * tabla se desplaza sola en lugar de desbordar la página entera.
 *
 * `overscroll-x-contain` está por un motivo concreto. Un contenedor con scroll
 * propio **atrapa la rueda del mouse**: al llegar a su borde horizontal, el
 * navegador seguía aplicando el gesto al contenedor en vez de devolvérselo a la
 * página, así que bajar la pantalla con el cursor sobre una tabla ancha —el
 * tarifario de Configuración es la peor— se trababa. `contain` corta esa
 * propagación hacia adentro y deja que el scroll vertical siga siendo de la
 * página.
 */
export function Tabla({ children, resumen }: { children: ReactNode; resumen: string }) {
  return (
    <div className="overflow-x-auto overscroll-x-contain">
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

/**
 * Columna secundaria: se oculta en pantallas chicas.
 *
 * Un listado de siete columnas en un teléfono obliga a arrastrar la tabla de
 * lado para leer una fila, y así no se puede trabajar. En vez de eso, en el
 * móvil se muestran solo las columnas que identifican y deciden (quién, cuándo,
 * en qué estado) y el resto aparece a partir de `sm`. El dato completo sigue
 * estando en el detalle de cada fila, a un toque.
 *
 * Se aplica al `<th>` **y** al `<td>` de la misma columna: si se olvida uno, la
 * tabla se desalinea.
 */
export const COL_SECUNDARIA = 'hidden sm:table-cell'

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
    <form
      method="get"
      action={accion}
      className="flex w-full items-center gap-2 sm:w-auto"
      role="search"
    >
      {Object.entries(ocultos).map(([clave, val]) =>
        val ? <input key={clave} type="hidden" name={clave} value={val} /> : null,
      )}
      {/* En el teléfono el campo ocupa lo que sobra; en escritorio vuelve a su
          ancho fijo, que era lo único contemplado antes. */}
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-stone-600">
          <Icono nombre="buscar" tam={16} />
        </span>
        <input
          type="search"
          name="q"
          defaultValue={valor ?? ''}
          placeholder={placeholder}
          aria-label={etiqueta}
          className="toque w-full rounded-lg border border-stone-300 bg-white py-2 pr-3 pl-8 text-sm text-stone-800 placeholder:text-stone-500 focus:border-lago-500 focus:outline-none sm:w-56"
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
      className={`toque inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
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

/* ----------------------------------------------------------- formulario -- */

/** Clases de un campo de formulario. Una sola definición para todo el panel. */
export const CAMPO =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-800 outline-none transition placeholder:text-stone-500 focus:border-lago-600 disabled:bg-stone-100'

/**
 * Campo con etiqueta **visible** y ayuda opcional.
 *
 * Antes varios campos se identificaban solo por su `placeholder`, que
 * desaparece apenas se empieza a escribir: quien se distrae ya no sabe qué
 * estaba cargando, y el lector de pantalla no siempre lo anuncia. La etiqueta
 * visible resuelve las dos cosas.
 *
 * `ayuda` es para explicar el porqué de un dato cuando no es evidente —por
 * ejemplo que la condición frente al IVA define la letra de la factura—, que es
 * justo lo que necesita quien no usa la computadora todos los días.
 */
export function Campo({
  etiqueta,
  ayuda,
  requerido,
  anchoCompleto,
  children,
}: {
  etiqueta: string
  ayuda?: string
  requerido?: boolean
  anchoCompleto?: boolean
  children: ReactNode
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${anchoCompleto ? 'sm:col-span-2' : ''}`}>
      <span className="text-sm font-medium text-stone-700">
        {etiqueta}
        {requerido && (
          <span className="ml-1 text-red-600" aria-hidden="true" title="Obligatorio">
            *
          </span>
        )}
      </span>
      {children}
      {ayuda && <span className="text-xs leading-snug text-stone-500">{ayuda}</span>}
    </label>
  )
}

/* ---------------------------------------------------------------- avisos -- */

/**
 * Confirmación de que algo salió bien, con los pasos siguientes a la vista.
 *
 * Después de dar de alta algo, la aplicación **no** salta sola a otra pantalla:
 * que la vista cambie sin aviso desorienta a quien no usa la computadora todos
 * los días. Se confirma qué pasó y se ofrecen las continuaciones como botones,
 * para que elija la persona.
 */
export function ExitoConPasos({
  mensaje,
  pasos,
}: {
  mensaje: string
  pasos: { href: string; texto: string }[]
}) {
  return (
    <Mensaje tono="ok">
      <span className="block font-medium">{mensaje}</span>
      {pasos.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-2">
          {pasos.map((p) => (
            <Link key={p.href} href={p.href} className={botonClases('secundario')}>
              {p.texto}
            </Link>
          ))}
        </span>
      )}
    </Mensaje>
  )
}

/**
 * Barra de acciones al pie de un formulario: guardar, cancelar y la nota de
 * campos obligatorios. Una sola definición para que todos los formularios
 * terminen igual.
 */
export function PieDeFormulario({
  children,
  hayObligatorios = true,
}: {
  children: ReactNode
  hayObligatorios?: boolean
}) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:items-center">
      {children}
      {hayObligatorios && (
        <p className="text-xs text-stone-500 sm:ml-auto">
          Los campos con <span className="text-red-600">*</span> son obligatorios.
        </p>
      )}
    </div>
  )
}

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
