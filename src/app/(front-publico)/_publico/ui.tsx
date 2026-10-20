import Link from 'next/link'
import type { ReactNode } from 'react'

/*
  Componentes del portal público (huésped, agencia, proveedor).

  Por qué son distintos de los del panel: cambia quién está del otro lado. El
  staff usa el sistema todos los días y tiene sesión iniciada; acá entra alguien
  que no fue entrenado, que llegó por un enlace de un email, muchas veces desde
  el teléfono y a veces con apuro. Eso se traduce en decisiones concretas:
  tipografía más grande, menos densidad, y el nombre del hotel presente en todas
  las pantallas para que se sepa dónde está parado.

  Antes cada pantalla del portal se dibujaba su propio encabezado: buscar,
  reservar y confirmar se veían como tres sitios distintos.
*/

/* --------------------------------------------------------------- marco -- */

/*
  El `Marco` (cabecera, contenido y pie de toda pantalla pública) vive en
  `./marco.tsx`. Se separó porque lee los diccionarios de idioma, y este
  archivo lo importan componentes de cliente (`buscador`, el formulario del
  checkout): dejarlo acá arrastraría los cinco idiomas al navegador.
*/

/** Silueta de montaña: la marca del hotel, en SVG propio. */
export function Montana() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-7 text-lago-700"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 19.5 9 8l3.5 6 2-3.4 7 8.9z" />
      <path d="M9 8l2.2 3.9" />
    </svg>
  )
}

/* ------------------------------------------------------------- titulo -- */

/** Título de la pantalla, con una bajada que explique qué se espera del lector. */
export function Titulo({
  titulo,
  descripcion,
}: {
  titulo: string
  descripcion?: string
}) {
  return (
    <div data-revelar className="mb-8">
      <h1 className="font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-tinta sm:text-5xl">
        {titulo}
      </h1>
      {descripcion && (
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-tinta-suave sm:text-lg">
          {descripcion}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ tarjeta -- */

export function Tarjeta({
  titulo,
  descripcion,
  children,
  className = '',
}: {
  titulo?: string
  descripcion?: string
  children: ReactNode
  className?: string
}) {
  return (
    /* `min-w-0` por el mismo motivo que en la `Tarjeta` del panel, donde el
       problema sí se manifestó: ver el comentario de `app/panel/_components/ui.tsx`.
       Hoy acá es inerte —las siete tarjetas públicas son hijas de bloque—, pero la
       primera que se ponga en un `grid` con un `truncate` adentro repetiría el
       desbordamiento. Son dos componentes distintos con el mismo nombre; conviene
       que no diverjan. */
    /*
      Radio chico, línea fina y sombra apenas perceptible.

      La versión anterior era `rounded-2xl` + borde gris + sombra: la caja
      blanca flotante que trae por omisión cualquier plantilla, y que hace que
      seis pantallas distintas se vean iguales. Las referencias de hotelería
      alta no apoyan el contenido sobre tarjetas —usan tipografía, aire y
      filetes— así que acá se baja el peso de la caja para que mande el
      contenido.

      El título va en VERSALITAS con interletrado ancho, que es el recurso con
      el que esos sitios rotulan sin gritar.
    */
    <section className={`min-w-0 rounded-lg bg-white/70 ring-1 ring-tinta/10 ${className}`}>
      {titulo && (
        <header className="border-b border-tinta/10 px-5 py-4 sm:px-6">
          <h2 className="text-[11px] font-semibold tracking-[0.18em] text-tinta-suave uppercase">
            {titulo}
          </h2>
          {descripcion && <p className="mt-1.5 text-sm text-tinta-suave">{descripcion}</p>}
        </header>
      )}
      {children}
    </section>
  )
}

/* -------------------------------------------------------------- chips -- */

/**
 * Dato corto y no accionable: una comodidad, la capacidad, la categoría.
 *
 * No es un botón ni lo parece: sin sombra ni cursor, para que nadie pierda el
 * tiempo intentando tocarlo.
 */
export function Etiqueta({ children }: { children: ReactNode }) {
  return (
    /* Filete a la izquierda en vez de píldora rellena: la píldora gris es el
       recurso por omisión y satura la tarjeta cuando hay cinco comodidades. */
    <span className="inline-flex items-center gap-1.5 border-l-2 border-lago-600/30 py-0.5 pl-2.5 text-sm text-tinta-suave">
      {children}
    </span>
  )
}

/**
 * Chip de filtro: es un enlace, así que el estado queda en la URL y se puede
 * compartir o volver con el botón «atrás» del navegador.
 */
export function ChipEnlace({
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
      /* El activo se marca con una línea gruesa abajo, no con un relleno azul:
         se lee como pestaña —que es lo que es— y no como botón a presionar. */
      className={`toque inline-flex items-center border-b-2 px-1 pb-1.5 text-sm font-medium tracking-tight transition ${
        activo
          ? 'border-lago-700 text-tinta'
          : 'border-transparent text-tinta-suave hover:border-tinta/25 hover:text-tinta'
      }`}
    >
      {children}
    </Link>
  )
}

/**
 * Insignia: un dato corto que **cambia la decisión**, resaltado.
 *
 * Se distingue de `Etiqueta` en el peso visual y en el propósito. `Etiqueta` es
 * un dato de ficha —la categoría, la capacidad— y no compite por la atención.
 * `Insignia` es lo que en Booking va sobre la tarjeta: quedan pocas, es la más
 * elegida, incluye desayuno. Por eso lleva color, y por eso hay pocas: si todo
 * está resaltado, nada lo está.
 */
export function Insignia({
  tono = 'lago',
  children,
}: {
  tono?: 'lago' | 'urgente' | 'atencion' | 'neutro'
  children: ReactNode
}) {
  const estilo = {
    // `lenga` es el naranja de marca para pendientes y alertas (ADR 0009). No
    // se usa rojo: quedan pocas habitaciones no es un error ni un peligro.
    urgente: 'bg-lenga-100 text-lenga-900 ring-lenga-200',
    atencion: 'bg-lenga-50 text-lenga-800 ring-lenga-200',
    lago: 'bg-lago-50 text-lago-800 ring-lago-200',
    neutro: 'bg-stone-100 text-stone-700 ring-stone-200',
  }[tono]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${estilo}`}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------- precios -- */

/**
 * Precio, con la jerarquía que el huésped necesita para comparar.
 *
 * Patrón de Booking: el número grande es el que se paga y arriba va, chiquito,
 * a qué corresponde. La aclaración de IVA no es decorativa —en este sistema el
 * precio se guarda sin IVA y se suma al cotizar (ADR 0004), así que decir que
 * el número mostrado ya lo incluye es parte de que no haya sorpresa al pagar—.
 *
 * `tamano` existe porque el mismo componente se usa en la tarjeta de un listado
 * y en la ficha de detalle, donde el precio es el protagonista.
 */
export function Precio({
  monto,
  encabezado,
  detalle,
  tamano = 'normal',
  alineado = 'izquierda',
}: {
  /** Importe ya formateado, p. ej. `USD 145,20`. */
  monto: string
  /** Qué es ese número: «Desde», «Total», «Por noche». */
  encabezado?: string
  /** Aclaración al pie: «con IVA», «3 noches». */
  detalle?: string
  tamano?: 'normal' | 'grande'
  alineado?: 'izquierda' | 'derecha'
}) {
  const clases = tamano === 'grande' ? 'text-3xl' : 'text-2xl'
  return (
    // `min-w-0`: dentro de un flex, el detalle («USD 435,60 por 3 noches, con
    // IVA») es una línea larga, y un hijo de flex no se encoge por debajo de su
    // contenido mínimo salvo que se le diga.
    <div className={`min-w-0 ${alineado === 'derecha' ? 'text-right' : ''}`}>
      {encabezado && (
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">{encabezado}</p>
      )}
      <p className={`tabular font-display leading-none font-semibold text-stone-900 ${clases}`}>
        {monto}
      </p>
      {detalle && <p className="mt-1 text-sm text-stone-500">{detalle}</p>}
    </div>
  )
}

/* ------------------------------------------------------------- botones -- */

export type VarianteBoton = 'primario' | 'secundario'

const BOTON: Record<VarianteBoton, string> = {
  primario: 'bg-lago-700 text-white shadow-sm hover:bg-lago-800 active:bg-lago-900',
  secundario: 'border border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50',
}

/**
 * Clases de botón del portal. Más grande que el del panel a propósito: se toca
 * con el pulgar y, muchas veces, una sola vez en toda la visita.
 */
export function botonPublico(variante: VarianteBoton = 'primario', extra = ''): string {
  return `toque inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 text-base font-medium tracking-tight transition disabled:cursor-not-allowed disabled:opacity-60 ${BOTON[variante]} ${extra}`.trim()
}

/* ------------------------------------------------------------- campos -- */

export const CAMPO_PUBLICO =
  'w-full rounded-xl border border-stone-500 bg-white px-4 py-3 text-base text-stone-800 outline-none transition placeholder:text-stone-400 focus:border-lago-600'

/** Campo con etiqueta visible y ayuda opcional. */
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
      <span className="font-medium text-stone-800">
        {etiqueta}
        {requerido && (
          <span className="ml-1 text-red-600" aria-hidden="true" title="Obligatorio">
            *
          </span>
        )}
      </span>
      {children}
      {ayuda && <span className="text-sm leading-snug text-stone-500">{ayuda}</span>}
    </label>
  )
}

/* ------------------------------------------------------------- avisos -- */

export function Mensaje({
  tono,
  children,
}: {
  tono: 'error' | 'ok' | 'aviso'
  children: ReactNode
}) {
  const estilo = {
    error: 'bg-red-50 text-red-800 ring-red-200',
    ok: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
    aviso: 'bg-lenga-50 text-lenga-900 ring-lenga-200',
  }[tono]

  return (
    <div
      role={tono === 'error' ? 'alert' : 'status'}
      className={`rounded-xl px-4 py-3 leading-relaxed ring-1 ${estilo}`}
    >
      {children}
    </div>
  )
}

