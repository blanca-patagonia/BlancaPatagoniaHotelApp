import Link from 'next/link'
import type { ReactNode } from 'react'
import { HORA_CHECK_IN, HORA_CHECK_OUT } from '@/lib/domain/hotel'
import { textos, rellenar, rutaConIdioma, idiomaValido } from '@/lib/i18n'
import { Montana, Tarjeta } from './ui'
import { SelectorIdioma } from './selector-idioma'

interface MarcoProps {
  children: ReactNode
  /** `angosto` para formularios y pantallas de un solo objetivo. */
  ancho?: 'normal' | 'angosto'
  /** Enlace de vuelta, cuando la pantalla es parte de un flujo. */
  volver?: { href: string; texto: string }
  /**
   * Idioma de la pantalla. Lo pasan las rutas de `app/[idioma]/`.
   *
   * Las pantallas con token (`/reservar/confirmacion/<token>`, `/firmar/…`) no
   * lo pasan: viven fuera del esquema de idiomas porque esas direcciones ya
   * viajaron por correo (ver `proxy.ts`). Ahí el marco sale en español y sus
   * enlaces van sin prefijo — el proxy los manda al idioma que corresponda.
   */
  idioma?: string
}

/**
 * Estructura de toda pantalla pública: cabecera de marca, contenido y pie.
 *
 * La cabecera no es decorativa. Quien abre un enlace de firma o de encuesta
 * desde su correo necesita reconocer de inmediato de quién es la página; sin
 * eso, lo razonable de su parte es desconfiar y no completarla.
 */
export function Marco({ children, ancho = 'normal', volver, idioma }: MarcoProps) {
  const propio = idioma ? idiomaValido(idioma) : null
  const t = textos(propio ?? undefined)
  // Con idioma, cada enlace lleva el suyo; sin idioma, la ruta pelada.
  const ruta = (r: string) => (propio ? rutaConIdioma(r, propio) : r)

  return (
    <div className="flex min-h-full flex-1 flex-col bg-papel text-tinta">
      {/*
        Encabezado con navegación, no sólo con el logo.

        Antes acá iba la marca y la leyenda «El Calafate · Santa Cruz», y el
        único camino de vuelta era hacer clic en el nombre del hotel —algo que
        funciona pero que nadie descubre: el usuario reportó que «no se puede
        volver atrás»—. Ahora los tres destinos del sitio están siempre a la
        vista, así que desde cualquier pantalla se puede volver al inicio, mirar
        los alojamientos o ir a reservar sin usar el botón del navegador.

        Es pegajoso (`sticky`) para que siga disponible después de scrollear un
        listado largo, que es justo cuando hace falta.
      */}
      <header className="sticky top-0 z-40 border-b border-tinta/10 bg-papel/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
          <Link href={ruta('/')} className="toque flex shrink-0 items-center gap-2.5">
            <Montana />
            <span className="font-display text-base leading-none font-semibold whitespace-nowrap text-tinta sm:text-lg">
              Blanca Patagonia
            </span>
          </Link>
          <nav aria-label={t.nav.navegacion} className="flex items-center gap-4 text-sm font-medium sm:gap-6">
            <Link
              href={ruta('/')}
              className="toque inline-flex items-center text-tinta-suave transition hover:text-tinta"
            >
              {t.nav.inicio}
            </Link>
            <Link
              href={ruta('/alojamientos')}
              className="toque hidden items-center text-tinta-suave transition hover:text-tinta sm:inline-flex"
            >
              {t.nav.alojamientos}
            </Link>
            {propio && (
              <span className="hidden sm:inline-flex">
                <SelectorIdioma idioma={propio} variante="menu" etiqueta={t.nav.idioma} />
              </span>
            )}
            <Link
              href={ruta('/reservar')}
              className="toque inline-flex items-center rounded-full bg-lago-700 px-4 text-white transition hover:bg-lago-800 active:scale-[0.97]"
            >
              {t.nav.reservar}
            </Link>
          </nav>
        </div>
      </header>

      <main
        className={`mx-auto w-full flex-1 px-5 py-8 telefono:px-4 telefono:py-6 sm:px-6 sm:py-10 ${
          ancho === 'angosto' ? 'max-w-2xl' : 'max-w-5xl'
        }`}
      >
        {volver && (
          <Link
            href={volver.href}
            className="toque group mb-4 inline-flex items-center gap-1 text-sm text-tinta-suave transition hover:text-tinta"
          >
            <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5">
              ‹
            </span>{' '}
            {volver.texto}
          </Link>
        )}
        {children}
      </main>

      <footer className="border-t border-tinta/10 bg-hueso">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-5 text-sm text-tinta-suave sm:px-6">
          {/* En el pie, a la vista y en el teléfono también: el encabezado no
              tiene lugar para el selector en 390 px, y un idioma que no se
              puede cambiar desde el teléfono no se puede cambiar. */}
          {propio && <SelectorIdioma idioma={propio} etiqueta={t.nav.idioma} />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{t.comun.hosteriaYCabanas}</span>
            <span className="text-stone-400">
              {rellenar(t.comun.checkInOut, { entrada: HORA_CHECK_IN, salida: HORA_CHECK_OUT })}
            </span>
          </div>
        </div>
      </footer>
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
