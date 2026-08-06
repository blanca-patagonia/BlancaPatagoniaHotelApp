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

interface MarcoProps {
  children: ReactNode
  /** `angosto` para formularios y pantallas de un solo objetivo. */
  ancho?: 'normal' | 'angosto'
  /** Enlace de vuelta, cuando la pantalla es parte de un flujo. */
  volver?: { href: string; texto: string }
}

/**
 * Estructura de toda pantalla pública: cabecera de marca, contenido y pie.
 *
 * La cabecera no es decorativa. Quien abre un enlace de firma o de encuesta
 * desde su correo necesita reconocer de inmediato de quién es la página; sin
 * eso, lo razonable de su parte es desconfiar y no completarla.
 */
export function Marco({ children, ancho = 'normal', volver }: MarcoProps) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Montana />
            <span className="font-display text-lg leading-none font-semibold text-lago-800">
              Blanca Patagonia
            </span>
          </Link>
          <span className="hidden text-sm text-stone-500 sm:block">El Calafate · Santa Cruz</span>
        </div>
      </header>

      <main
        className={`mx-auto w-full flex-1 px-5 py-8 sm:px-6 sm:py-10 ${
          ancho === 'angosto' ? 'max-w-2xl' : 'max-w-5xl'
        }`}
      >
        {volver && (
          <Link
            href={volver.href}
            className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
          >
            ‹ {volver.texto}
          </Link>
        )}
        {children}
      </main>

      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-5 py-5 text-sm text-stone-500 sm:px-6">
          <span>Hostería y cabañas · El Calafate, Santa Cruz</span>
          <span className="text-stone-400">Check-in 15:00 · Check-out 10:00</span>
        </div>
      </footer>
    </div>
  )
}

/** Silueta de montaña: la marca del hotel, en SVG propio. */
function Montana() {
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
    <div className="mb-6">
      <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-stone-900">
        {titulo}
      </h1>
      {descripcion && (
        <p className="mt-2 text-base leading-relaxed text-stone-600">{descripcion}</p>
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
    <section className={`rounded-2xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {titulo && (
        <header className="border-b border-stone-100 px-5 py-4 sm:px-6">
          <h2 className="font-display text-lg font-semibold text-stone-900">{titulo}</h2>
          {descripcion && <p className="mt-0.5 text-sm text-stone-500">{descripcion}</p>}
        </header>
      )}
      {children}
    </section>
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
  return `toque inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${BOTON[variante]} ${extra}`.trim()
}

/* ------------------------------------------------------------- campos -- */

export const CAMPO_PUBLICO =
  'w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-800 outline-none transition placeholder:text-stone-400 focus:border-lago-600'

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

/**
 * Pantalla completa de un solo mensaje: enlace vencido, token inválido,
 * encuesta ya respondida.
 *
 * Existe porque estos casos son **frecuentes y no son errores del huésped**: un
 * enlace de firma que ya se usó, una encuesta contestada la semana pasada. Que
 * aparezca una pantalla en blanco o un 404 en inglés hace sentir que uno se
 * equivocó en algo.
 */
export function Aviso({
  titulo,
  children,
  accion,
}: {
  titulo: string
  children: ReactNode
  accion?: ReactNode
}) {
  return (
    <Marco ancho="angosto">
      <Tarjeta>
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
            <Montana />
          </span>
          <h1 className="font-display text-2xl font-semibold text-stone-900">{titulo}</h1>
          <div className="max-w-md leading-relaxed text-stone-600">{children}</div>
          {accion && <div className="mt-2">{accion}</div>}
        </div>
      </Tarjeta>
    </Marco>
  )
}
