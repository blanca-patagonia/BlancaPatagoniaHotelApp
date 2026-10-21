import { PausarMovimiento } from '@/app/(front-publico)/_publico/pausar-movimiento'
import Link from 'next/link'
import Image from 'next/image'
import { HORA_CHECK_IN, HORA_CHECK_OUT } from '@/lib/domain/hotel'
import { politicaCancelacionPublica } from '@/lib/catalogo/publico'
import { hoyISO, sumarDias } from '@/lib/fechas'
import { BuscadorEstadia } from '@/app/(front-publico)/_publico/buscador'
import { JsonLdHotel } from '@/app/(front-publico)/_publico/jsonld-hotel'
import { AsistenteFlotante } from '@/app/(front-publico)/_publico/asistente-flotante'
import { SelectorIdioma } from '@/app/(front-publico)/_publico/selector-idioma'
import { es as diccionarioEs } from '@/lib/i18n/diccionarios/es'
import {
  textos,
  rellenar,
  idiomaValido,
  rutaConIdioma,
  alternativasDeIdioma,
  lineasCancelacion,
  IDIOMAS,
  ETIQUETA_BCP47,
  type Idioma,
} from '@/lib/i18n'

const PORTADA = '/hotel/fotos/lobby/ventanal-atardecer.jpg'

/**
 * Metadata por idioma, con `hreflang`.
 *
 * `alternates.languages` es lo que le dice a un buscador que estas cinco URLs
 * son la misma página en idiomas distintos. Sin eso las trata como contenido
 * duplicado y elige una sola para mostrar, que es exactamente lo que se quiere
 * evitar al traducir.
 */
export async function generateMetadata({ params }: { params: Promise<{ idioma: string }> }) {
  const { idioma } = await params
  const t = textos(idioma)
  const titulo = `Blanca Patagonia — ${t.portada.titulo}`

  return {
    title: titulo,
    description: t.portada.bajada,
    alternates: alternativasDeIdioma(idioma, '/'),
    openGraph: {
      title: titulo,
      description: t.portada.bajada,
      images: [PORTADA],
      locale: ETIQUETA_BCP47[idioma as Idioma] ?? ETIQUETA_BCP47.es,
    },
    twitter: { title: titulo, description: t.portada.bajada, images: [PORTADA] },
  }
}

/** Una página por idioma, generadas en el build. */
export function generateStaticParams() {
  return IDIOMAS.map((idioma) => ({ idioma }))
}

/**
 * Portada del hotel.
 *
 * Estructura tomada de los lodges de naturaleza (Explora, Eolo, Awasi) y de la
 * mecánica de reserva de los boutique europeos: video a pantalla completa con el
 * buscador encima, y debajo un recorrido que responde, en orden, las preguntas
 * que frenan una reserva — qué es este lugar, dónde duermo, qué como, qué hago
 * en el día, qué está incluido, cómo llego.
 *
 * Tres decisiones que conviene no deshacer:
 *
 * 1. **El buscador es la portada.** La pregunta que trae a alguien acá es «¿hay
 *    lugar en mis fechas?» y se responde sin scrollear (ADR 0007).
 * 2. **Los números son reales** (15 habitaciones, 25/30/35 m², 38/51/115 m²,
 *    hasta 7 personas) y salen del sitio del hotel. Un metraje inventado se
 *    descubre en el check-in, que es el peor momento posible.
 * 3. **El campo de lavanda tiene sección propia.** Es lo único que este hotel
 *    tiene y los demás de El Calafate no; enterrarlo entre los servicios sería
 *    desperdiciar el diferencial.
 */

/* ── Datos del hotel, en un solo lugar para no repetirlos en el marcado ──── */

/*
  Los textos (nombres, capacidades, preguntas) viven en el diccionario de cada
  idioma (`contenido`). Acá quedan sólo los números y las fotos, que no se
  traducen: se emparejan por posición con las listas del diccionario.
*/
const METROS_HABITACIONES = ['25 m²', '30 m²', '35 m²']
const METROS_CABANAS = ['38 m²', '51 m²', '115 m²']
const FOTOS_EXCURSIONES = [
  '/hotel/fotos/lobby/ventanal-telescopio.jpg',
  '/hotel/fotos/lavanda/campo-lago.jpg',
  '/hotel/fotos/cabanas/living-vista-lago.jpg',
]
const GALERIA = [
  '/hotel/fotos/hosteria/superior-ventanal.jpg',
  '/hotel/fotos/hosteria/cama-detalle.jpg',
  '/hotel/fotos/cabanas/cocina-comedor.jpg',
  '/hotel/fotos/cabanas/dormitorio-piedra.jpg',
]

/** Fotos de la franja en movimiento. Se duplican al renderizar. */
const FRANJA = [
  '/hotel/fotos/lobby/ventanal-pareja.jpg',
  '/hotel/fotos/hosteria/suite-piedra.jpg',
  '/hotel/fotos/lavanda/canasto-cabana.jpg',
  '/hotel/fotos/gastronomia/cena-fogon.jpg',
  '/hotel/fotos/cabanas/cocina-comedor.jpg',
  '/hotel/fotos/lobby/fogon-encendido.jpg',
  '/hotel/fotos/hosteria/cama-detalle.jpg',
  '/hotel/fotos/lavanda/detalle-abeja.jpg',
  '/hotel/fotos/cabanas/dormitorio-piedra.jpg',
  '/hotel/fotos/lobby/ventanal-telescopio.jpg',
]

export default async function Home({ params }: { params: Promise<{ idioma: string }> }) {
  const idioma: Idioma = idiomaValido((await params).idioma)
  const t = textos(idioma)
  const p = t.portada
  const c = t.contenido
  const ruta = (r: string) => rutaConIdioma(r, idioma)
  const hoy = hoyISO()
  const reglasCancelacion = await politicaCancelacionPublica()
  // Una línea por tramo, en el idioma de la página y armada desde las reglas
  // de la base (no desde una frase fija): ver `lineasCancelacion`.
  const lineasCancelacionTexto =
    reglasCancelacion.length > 0 ? lineasCancelacion(reglasCancelacion, t) : []
  const horarios = rellenar(t.comun.checkInOut, { entrada: HORA_CHECK_IN, salida: HORA_CHECK_OUT })

  // Botones con la misma física en toda la portada: píldora, y un apretón
  // breve al tocar (`active:scale`) que confirma el toque antes de navegar.
  const botonClaro =
    'toque inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-tinta shadow-sm transition duration-300 hover:bg-stone-100 active:scale-[0.97]'
  const botonFantasma =
    'toque inline-flex items-center justify-center gap-2 rounded-full px-7 text-sm font-semibold text-white ring-1 ring-white/60 transition duration-300 hover:bg-white/10 active:scale-[0.97]'
  const enlaceFlecha = (tono: string) =>
    `toque group mt-6 inline-flex items-center gap-2 border-b pb-1 text-sm font-semibold transition ${tono}`

  return (
    <div id="inicio" className="flex min-h-screen flex-col bg-papel text-tinta">
      <JsonLdHotel />

      {/* Barra de progreso de lectura: un filete que avanza con el scroll.
          Decorativa, por eso `aria-hidden`; sin soporte no aparece. */}
      <div aria-hidden="true" data-progreso className="fixed inset-x-0 top-0 z-[60] h-0.5 bg-lago-500" />

      {/* El contenido principal, como región: los lectores de pantalla saltan
          directo acá. Sin `<main>`, la portada era una sucesión de `<section>`
          sin punto de entrada. */}
      <main id="contenido">
      {/* ═══════════════════════ HERO: video a pantalla completa ═══════════════════════ */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-papel">
        {/*
          El video y su velo van juntos en `data-hero-medio`: al bajar, el
          bloque se achica y redondea las esquinas, como una tarjeta que se
          aparta para dejar pasar el contenido. Es el gesto de las páginas de
          producto de Apple, hecho con una animación guiada por scroll y sin
          JavaScript (ver `globals.css`).
        */}
        <div data-hero-medio className="absolute inset-0 overflow-hidden">
          <video
            autoPlay
            muted
            loop
            playsInline
            poster="/hotel/fotos/poster-video.jpg"
            className="ken-burns absolute inset-0 size-full object-cover"
          >
            {/* En pantallas chicas, la versión de 540p (6,6 MB contra 18,3): un
                teléfono con datos móviles no necesita 1080p para un fondo que
                además se ve recortado. El navegador elige la PRIMERA que
                cumple su `media`, así que el orden importa. */}
            <source
              src="/hotel/videos/blanca-hero-movil.mp4"
              type="video/mp4"
              media="(max-width: 768px)"
            />
            <source src="/hotel/videos/blanca-hero.mp4" type="video/mp4" />
          </video>
          {/* Degradado y no un velo plano: mantiene el cielo del video limpio y
              oscurece sólo donde apoya el texto. */}
          <div className="absolute inset-0 bg-linear-to-b from-stone-950/55 via-stone-950/35 to-stone-950/55" />
        </div>

        <header
          data-nav-portada
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 px-5 py-4 transition-colors sm:px-8 sm:py-5"
        >
          <Link
            href={ruta('/')}
            className="font-display shrink-0 text-base leading-none font-semibold tracking-tight whitespace-nowrap text-white sm:text-2xl"
          >
            Blanca Patagonia
          </Link>
          {/* Se achica en el teléfono, pero no se esconde detrás de un
              hamburguesa: nada oculto (CLAUDE.md, Fase 15). */}
          {/* `toque` da el área mínima de 44 px con el dedo (`globals.css`). La
              regla de ahí cubre botones, no enlaces: en una landing que es casi
              toda enlaces, hay que ponerla a mano. */}
          <nav
            aria-label={t.nav.navegacion}
            className="flex items-center gap-4 text-sm font-medium text-white/90 sm:gap-7"
          >
            <Link
              href={ruta('/alojamientos')}
              className="toque inline-flex items-center transition hover:text-white"
            >
              {t.nav.alojamientos}
            </Link>
            <a
              href="#experiencias"
              className="toque hidden items-center transition hover:text-white md:inline-flex"
            >
              {t.nav.experiencias}
            </a>
            <a
              href="#ubicacion"
              className="toque hidden items-center transition hover:text-white md:inline-flex"
            >
              {t.nav.ubicacion}
            </a>
            {/* En el teléfono no entra: el selector está entero en el pie. */}
            <span className="hidden sm:inline-flex">
              <SelectorIdioma idioma={idioma} variante="menu" tono="claro" etiqueta={t.nav.idioma} />
            </span>
            <Link
              href={ruta('/reservar')}
              className="toque inline-flex items-center rounded-full bg-white/95 px-4 text-tinta transition duration-300 hover:bg-white active:scale-[0.97]"
            >
              {t.nav.reservar}
            </Link>
          </nav>
        </header>

        <div
          data-hero-texto
          className="hero-entra relative z-10 mx-auto w-full max-w-4xl px-5 pt-20 text-center telefono:px-3 telefono:pt-24 telefono:pb-16 sm:px-6"
        >
          <p className="mb-3 text-[11px] font-medium tracking-[0.3em] text-white/85 uppercase sm:text-xs">
            {p.lugar}
          </p>
          <h1 className="font-display text-[2.75rem] leading-[0.98] font-bold tracking-[-0.035em] text-balance text-white sm:text-7xl lg:text-8xl">
            {p.titulo}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/90 sm:text-lg">
            {p.bajada}
          </p>

          <div className="mx-auto mt-8 max-w-3xl sm:mt-10">
            <BuscadorEstadia
              variante="hero"
              checkIn=""
              checkOut=""
              huespedes={2}
              hoy={hoy}
              salidaPorDefecto={sumarDias(hoy, 2)}
              idioma={idioma}
              t={t.buscador}
            />
          </div>

          <Link
            href={ruta('/alojamientos')}
            className="toque mt-3 inline-flex items-center text-sm font-medium text-white/85 underline underline-offset-4 transition hover:text-white"
          >
            {p.sinFechas}
          </Link>
        </div>

        {/* Todo lo que se mueve solo en la portada se puede detener (WCAG 2.2.2). */}
        <div className="absolute bottom-5 left-5 z-10 telefono:bottom-4 telefono:left-4">
          <PausarMovimiento pausar={t.comun.pausarMovimiento} reanudar={t.comun.reanudarMovimiento} />
        </div>

        <a
          href="#presentacion"
          aria-label={t.nav.irAlContenido}
          className="toque absolute bottom-6 left-1/2 z-10 inline-flex -translate-x-1/2 items-center justify-center text-white/60 transition hover:text-white telefono:hidden"
        >
          <svg className="size-6 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7" />
          </svg>
        </a>
      </section>

      {/* ═══════════════════════ PRESENTACIÓN + CIFRAS ═══════════════════════ */}
      <section id="presentacion" className="scroll-mt-20 bg-papel px-5 py-16 telefono:px-4 sm:px-6 sm:py-24">
        <div data-revelar className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-medium tracking-[0.25em] text-lago-700 uppercase">
            {p.presentacionEtiqueta}
          </p>
          <h2 className="mt-3 font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-tinta sm:text-5xl">
            {p.presentacionTitulo}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-tinta-suave sm:text-lg">
            {p.presentacionTexto}
          </p>
        </div>

        {/*
          Las cifras cuentan desde cero al entrar en pantalla.

          ⚠️ El número real está SIEMPRE en el marcado (`cifra-texto`): es lo
          que leen el lector de pantalla y el buscador, y lo que ve un
          navegador sin animaciones guiadas por scroll. La cuenta es un
          `::before` que sólo existe cuando el navegador la soporta, y en ese
          caso el texto queda oculto a la vista pero no al lector.
        */}
        <dl className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-x-6 gap-y-8 text-center lg:grid-cols-4">
          {[
            { n: 15, sufijo: '', t: p.cifraHabitaciones, d: p.cifraHabitacionesPie },
            { n: 4, sufijo: '★', t: p.cifraCategoria, d: p.cifraCategoriaPie },
            { n: 7, sufijo: '', t: p.cifraPersonas, d: p.cifraPersonasPie },
            { n: 80, sufijo: ' km', t: p.cifraDistancia, d: p.cifraDistanciaPie },
          ].map((cifra) => (
            <div key={cifra.t} data-revelar>
              <dt className="font-display text-4xl font-semibold text-lago-700 tabular-nums sm:text-5xl">
                <span
                  data-cifra
                  data-sufijo={cifra.sufijo}
                  style={{ '--hasta': cifra.n } as React.CSSProperties}
                >
                  <span className="cifra-texto">
                    {cifra.n}
                    {cifra.sufijo}
                  </span>
                </span>
              </dt>
              <dd className="mt-1.5 text-sm font-medium text-stone-800">{cifra.t}</dd>
              <dd className="text-xs leading-snug text-stone-500">{cifra.d}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ═══════════════════════ EL VENTANAL (imagen ancha) ═══════════════════════ */}
      <section className="relative isolate flex min-h-[26rem] items-end overflow-hidden sm:min-h-[34rem]">
        <Image
          src={PORTADA}
          alt={c.alt.ventanal}
          fill
          sizes="100vw"
          data-parallax
          className="-z-10 object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-linear-to-t from-stone-950/85 via-stone-950/30 to-transparent" />
        <div className="w-full px-5 pb-10 sm:px-8 sm:pb-14">
          <div data-revelar className="mx-auto max-w-5xl">
            <h2 className="font-display text-[2.1rem] leading-[1.05] font-semibold tracking-[-0.025em] text-white sm:text-5xl">
              {p.ventanalTitulo}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/90 sm:text-base">
              {p.ventanalTexto}
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ MANIFIESTO (escena fija) ═══════════════════════ */}
      {/*
        Escena fija, al estilo de las páginas de producto de Apple.

        La sección es más alta que la pantalla y su contenido queda clavado
        (`sticky`) mientras se scrollea por ella. En ese recorrido pasan tres
        cosas, en orden y al ritmo de quien lee:

        1. La frase se enciende palabra por palabra (de gris a tinta).
        2. Aparecen tres datos concretos debajo, de a uno.
        3. La frase se aparta y una foto del lago sube desde abajo y se abre
           hasta ocupar la pantalla: «un lago turquesa» y después, el lago.

        Todas las piezas comparten UNA línea de tiempo con nombre
        (`--manifiesto`, la de la sección), y cada palabra lleva su propio
        tramo calculado acá por posición. Por eso el orden es exacto: con una
        línea de tiempo por palabra —la primera versión— las de un mismo
        renglón se encendían juntas y el efecto casi no se notaba.

        ⚠️ Sin soporte o con movimiento reducido, nada de esto existe: la
        sección mide lo que su contenido, la frase se ve entera y la foto
        aparece debajo, quieta (ver `globals.css`). Para el lector de pantalla
        es una sola frase (`aria-label`), no veinte palabras sueltas.
      */}
      {(() => {
        // El chino no separa palabras con espacios: se enciende por carácter.
        const piezas = idioma === 'zh' ? Array.from(c.manifiesto) : c.manifiesto.split(' ')
        // Las palabras se reparten entre el 4 % y el 42 % del recorrido; los
        // datos, entre el 40 % y el 52 %. La foto toma de ahí al final.
        const tramo = (desde: number, hasta: number) =>
          ({ animationRange: `contain ${desde.toFixed(1)}% contain ${hasta.toFixed(1)}%` }) as React.CSSProperties
        return (
          <section data-manifiesto className="relative bg-papel">
            <div data-manifiesto-fijo className="px-5 py-24 telefono:px-4 sm:px-6 sm:py-36">
              <div data-manifiesto-texto className="relative z-10 mx-auto w-full max-w-4xl">
                <p className="flex items-center gap-3 text-[11px] font-medium tracking-[0.25em] text-lago-700 uppercase">
                  <span aria-hidden="true" className="h-px w-8 bg-lago-700/50" />
                  {c.manifiestoEtiqueta}
                </p>
                {/* La frase va entera en un texto oculto: las palabras animadas
                    son `aria-hidden`, y un `aria-label` en un párrafo no lo lee
                    ningún lector de pantalla (ARIA 1.2 lo prohíbe). */}
                <p
                  className="mt-5 font-display text-[1.9rem] leading-[1.15] font-semibold tracking-[-0.025em] text-balance text-tinta sm:text-5xl lg:text-6xl"
                >
                  <span className="sr-only">{c.manifiesto}</span>
                  {piezas.map((palabra, i) => {
                    const desde = 4 + (i / piezas.length) * 36
                    return (
                      <span key={i} aria-hidden="true" data-palabra style={tramo(desde, desde + 6)}>
                        {palabra}
                        {idioma === 'zh' ? '' : ' '}
                      </span>
                    )
                  })}
                </p>
                <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm font-medium text-tinta-suave">
                  {c.manifiestoDatos.map((dato, i) => (
                    <li key={dato} data-dato style={tramo(40 + i * 4, 46 + i * 4)} className="flex items-center gap-2.5">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-lago-500" />
                      {dato}
                    </li>
                  ))}
                </ul>
                <p data-seguir aria-hidden="true" className="mt-12 hidden items-center gap-2 text-xs text-stone-400">
                  <span className="inline-block h-6 w-px animate-pulse bg-stone-300" />
                  {c.manifiestoSeguir}
                </p>
              </div>

              <figure
                data-manifiesto-foto
                className="relative mx-auto mt-12 aspect-video w-full max-w-5xl overflow-hidden rounded-3xl"
              >
                {/* `alt` vacío: el `figcaption` ya la describe y el lector la
                    leería dos veces. */}
                <Image
                  src="/hotel/fotos/poster-video.jpg"
                  alt=""
                  fill
                  sizes="100vw"
                  data-manifiesto-imagen
                  className="object-cover"
                />
                <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-stone-950/60 via-transparent to-transparent" />
                <figcaption
                  data-manifiesto-pie
                  className="absolute inset-x-0 bottom-0 px-5 pb-24 text-center text-sm font-medium tracking-wide text-white/90 sm:px-10 sm:pb-28 sm:text-base"
                >
                  {c.manifiestoFoto}
                </figcaption>
              </figure>
            </div>
          </section>
        )
      })()}

      {/* ═══════════════════════ ALOJAMIENTOS ═══════════════════════ */}
      <section id="alojamientos" className="scroll-mt-20 bg-hueso px-5 py-16 telefono:px-4 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div data-revelar className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-medium tracking-[0.25em] text-lago-700 uppercase">
              {p.dondeDormir}
            </p>
            <h2 className="mt-3 font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-tinta sm:text-5xl">
              {p.dosFormas}
            </h2>
            <p className="mt-4 text-tinta-suave">{p.dosFormasTexto}</p>
          </div>

          {/* ── Hostería ── */}
          <article data-revelar className="mt-12 grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
            <div className="group relative aspect-4/3 overflow-hidden rounded-2xl shadow-lg lg:aspect-3/2">
              <Image
                src="/hotel/fotos/hosteria/suite-hidromasaje.jpg"
                alt={c.alt.hosteria}
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                data-cortina
                className="object-cover transition-transform duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
              />
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-[0.2em] text-lago-700 uppercase">
                {p.hosteriaEtiqueta}
              </p>
              <h3 className="mt-2 font-display text-[1.6rem] leading-[1.12] font-semibold tracking-[-0.02em] text-tinta sm:text-4xl">
                {p.hosteriaTitulo}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-tinta-suave sm:text-base">
                {p.hosteriaTexto}
              </p>

              <dl className="mt-6 divide-y divide-tinta/10 border-y border-tinta/10">
                {c.habitaciones.map((h, i) => (
                  <div key={h.nombre} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                    <dt className="font-medium text-tinta">{h.nombre}</dt>
                    <dd className="rounded-full bg-lago-50 px-2 py-0.5 text-xs font-medium text-lago-700">
                      {METROS_HABITACIONES[i]}
                    </dd>
                    <dd className="text-xs text-stone-500">{h.capacidad}</dd>
                    <dd className="w-full text-xs leading-snug text-stone-500">{h.detalle}</dd>
                  </div>
                ))}
              </dl>

              <Link
                href={ruta('/alojamientos?categoria=hosteria')}
                className={enlaceFlecha('border-lago-700/40 text-lago-700 hover:border-lago-700')}
              >
                {p.hosteriaEnlace}
                <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1">
                  →
                </span>
              </Link>
            </div>
          </article>

          {/* ── Cabañas (imagen a la derecha: alterna el ritmo) ── */}
          <article data-revelar className="mt-14 grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
            <div className="lg:order-2">
              <div className="group relative aspect-4/3 overflow-hidden rounded-2xl shadow-lg lg:aspect-3/2">
                <Image
                  src="/hotel/fotos/cabanas/living-vista-lago.jpg"
                  alt={c.alt.cabana}
                  fill
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  data-cortina
                  className="object-cover transition-transform duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
                />
              </div>
            </div>
            <div className="lg:order-1">
              <p className="text-[11px] font-medium tracking-[0.2em] text-lenga-700 uppercase">
                {p.cabanasEtiqueta}
              </p>
              <h3 className="mt-2 font-display text-[1.6rem] leading-[1.12] font-semibold tracking-[-0.02em] text-tinta sm:text-4xl">
                {p.cabanasTitulo}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-tinta-suave sm:text-base">
                {p.cabanasTexto}
              </p>

              <dl className="mt-6 divide-y divide-tinta/10 border-y border-tinta/10">
                {c.cabanas.map((cab, i) => (
                  <div key={cab.nombre} className="flex flex-wrap items-baseline gap-x-3 py-3">
                    <dt className="font-medium text-tinta">{cab.nombre}</dt>
                    <dd className="rounded-full bg-lenga-50 px-2 py-0.5 text-xs font-medium text-lenga-800">
                      {METROS_CABANAS[i]}
                    </dd>
                    <dd className="text-xs text-stone-500">{cab.capacidad}</dd>
                  </div>
                ))}
              </dl>

              <Link
                href={ruta('/alojamientos?categoria=cabana')}
                className={enlaceFlecha('border-lenga-700/40 text-lenga-800 hover:border-lenga-700')}
              >
                {p.cabanasEnlace}
                <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1">
                  →
                </span>
              </Link>
            </div>
          </article>

          {/* Galería corta */}
          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {GALERIA.map((src, i) => (
              <div key={src} data-revelar className="relative aspect-square overflow-hidden rounded-xl">
                <Image
                  src={src}
                  alt={c.alt.galeria[i]}
                  fill
                  sizes="(min-width: 640px) 25vw, 50vw"
                  className="object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.06]"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ CAMPO DE LAVANDA ═══════════════════════ */}
      <section className="bg-papel px-5 py-16 telefono:px-4 sm:px-6 sm:py-24">
        <div data-revelar className="mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-2 lg:gap-14">
          <div className="grid grid-cols-2 gap-3">
            <div className="relative col-span-2 aspect-2/1 overflow-hidden rounded-2xl">
              <Image
                src="/hotel/fotos/lavanda/campo-lago.jpg"
                alt={c.alt.lavandaCampo}
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                data-cortina
                className="object-cover"
              />
            </div>
            <div className="relative aspect-4/3 overflow-hidden rounded-xl">
              <Image
                src="/hotel/fotos/lavanda/canasto-cabana.jpg"
                alt={c.alt.lavandaCanasto}
                fill
                sizes="(min-width: 1024px) 25vw, 50vw"
                className="object-cover"
              />
            </div>
            <div className="relative aspect-4/3 overflow-hidden rounded-xl">
              <Image
                src="/hotel/fotos/lavanda/detalle-abeja.jpg"
                alt={c.alt.lavandaDetalle}
                fill
                sizes="(min-width: 1024px) 25vw, 50vw"
                className="object-cover"
              />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium tracking-[0.25em] text-lago-700 uppercase">
              {p.lavandaEtiqueta}
            </p>
            <h2 className="mt-3 font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-tinta sm:text-5xl">
              {p.lavandaTitulo}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-tinta-suave">{p.lavandaTexto1}</p>
            <p className="mt-3 text-base leading-relaxed text-tinta-suave">{p.lavandaTexto2}</p>
            <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-t border-tinta/10 pt-5">
              <div>
                <dt className="text-xs text-stone-500">{p.lavandaFlorece}</dt>
                <dd className="font-display text-lg font-semibold text-tinta">
                  {p.lavandaFloreceValor}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">{p.lavandaDistancia}</dt>
                <dd className="font-display text-lg font-semibold text-tinta">
                  {p.lavandaDistanciaValor}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ GASTRONOMÍA ═══════════════════════ */}
      <section className="bg-stone-900 px-5 py-16 text-white sm:px-6 sm:py-24">
        <div data-revelar className="mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-[11px] font-medium tracking-[0.25em] text-lenga-300 uppercase">
              {p.gastronomiaEtiqueta}
            </p>
            <h2 className="mt-3 font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance sm:text-5xl">
              {p.gastronomiaTitulo}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-stone-300">{p.gastronomiaTexto}</p>
            <ul className="mt-6 space-y-2 text-sm text-stone-300">
              {p.gastronomiaLista.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-0.5 text-lenga-400">
                    ·
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="relative aspect-4/5 overflow-hidden rounded-2xl">
              <Image
                src="/hotel/fotos/gastronomia/cena-fogon.jpg"
                alt={c.alt.cena}
                fill
                sizes="(min-width: 640px) 25vw, 100vw"
                data-cortina
                className="object-cover"
              />
            </div>
            <div className="relative aspect-4/5 overflow-hidden rounded-2xl sm:mt-8">
              <Image
                src="/hotel/fotos/gastronomia/picada-vino.jpg"
                alt={c.alt.picada}
                fill
                sizes="(min-width: 640px) 25vw, 100vw"
                data-cortina
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ EXPERIENCIAS ═══════════════════════ */}
      <section id="experiencias" className="scroll-mt-20 bg-papel px-5 py-16 telefono:px-4 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div data-revelar className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-medium tracking-[0.25em] text-lago-700 uppercase">
              {p.experienciasEtiqueta}
            </p>
            <h2 className="mt-3 font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-tinta sm:text-5xl">
              {p.experienciasTitulo}
            </h2>
            <p className="mt-4 text-tinta-suave">{p.experienciasTexto}</p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {c.excursiones.map((e, i) => (
              <article key={e.nombre} data-revelar className="group">
                {/* Se levanta apenas al pasar el mouse: la sombra crece y la
                    foto se acerca. Dos movimientos chicos y sincronizados, que
                    es lo que hace que una tarjeta se sienta física. */}
                <div className="relative aspect-4/3 overflow-hidden rounded-xl shadow-sm transition duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1 group-hover:shadow-xl">
                  <Image
                    src={FOTOS_EXCURSIONES[i]}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 33vw, 100vw"
                    className="object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06]"
                  />
                </div>
                <h3 className="mt-4 font-display text-lg leading-snug font-semibold text-tinta">
                  {e.nombre}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-tinta-suave">{e.detalle}</p>
              </article>
            ))}
          </div>

          <p className="mt-8 text-center text-sm text-stone-500">{p.experienciasPie}</p>
        </div>
      </section>

      {/* ═══════════════════════ QUÉ INCLUYE ═══════════════════════ */}
      <section className="bg-hueso px-5 py-16 telefono:px-4 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <div data-revelar>
            <h2 className="text-center font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-tinta sm:text-5xl">
              {p.incluyeTitulo}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-tinta-suave">{p.incluyeTexto}</p>
          </div>

          <div data-revelar className="mt-10 grid gap-6 md:grid-cols-[1.4fr_1fr]">
            <div className="rounded-3xl bg-white/70 p-6 ring-1 ring-tinta/10 backdrop-blur-sm sm:p-7">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-tinta">
                <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-lago-100 text-xs text-lago-800">
                  ✓
                </span>
                {p.incluido}
              </h3>
              <ul className="grid gap-x-6 gap-y-2.5 text-sm text-stone-700 sm:grid-cols-2">
                {c.incluido.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-lago-600">
                      ✓
                    </span>
                    <span className="leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl bg-white/70 p-6 ring-1 ring-tinta/10 backdrop-blur-sm sm:p-7">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-tinta">
                <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-stone-200 text-xs text-stone-700">
                  +
                </span>
                {p.conCargo}
              </h3>
              <ul className="space-y-2.5 text-sm text-stone-700">
                {c.conCargo.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-stone-400">
                      +
                    </span>
                    <span className="leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 border-t border-tinta/10 pt-4 text-xs leading-relaxed text-stone-500">
                {rellenar(p.horarios, { entrada: HORA_CHECK_IN, salida: HORA_CHECK_OUT })}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ UBICACIÓN ═══════════════════════ */}
      <section id="ubicacion" className="scroll-mt-20 bg-papel px-5 py-16 telefono:px-4 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div data-revelar className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-medium tracking-[0.25em] text-lago-700 uppercase">
              {p.comoLlegarEtiqueta}
            </p>
            <h2 className="mt-3 font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-tinta sm:text-5xl">
              {p.comoLlegarTitulo}
            </h2>
            <p className="mt-4 text-tinta-suave">{p.direccion}</p>
          </div>

          {/*
            Asimétrico, y sin tarjetas.

            Antes eran tres cajas iguales en fila —distancias, contacto y una
            foto—, que es el layout por omisión de cualquier plantilla: tres
            cosas distintas con el mismo peso visual y ninguna jerarquía. Ahora
            la foto ocupa más y los datos se leen como una ficha, separados por
            filetes en lugar de por bordes de caja.

            ⚠️ También cambió la foto. Estaba el primer plano del lavandín, que
            es lindo y **no dice dónde queda el hotel**: una sección titulada
            «cómo llegar» ilustrada con flores no orienta a nadie. La nueva
            muestra el lago y el pueblo abajo, que es la información que la
            sección promete.
          */}
          <div data-revelar className="mt-10 grid items-start gap-8 lg:grid-cols-5 lg:gap-12">
            <div className="relative aspect-4/3 overflow-hidden rounded-2xl lg:col-span-3 lg:aspect-3/2">
              <Image
                src="/hotel/fotos/poster-video.jpg"
                alt={c.alt.entorno}
                fill
                sizes="(min-width: 1024px) 60vw, 100vw"
                data-cortina
                className="object-cover"
              />
            </div>

            <div className="lg:col-span-2">
              {/*
                Distancia Y tiempo.

                Los kilómetros solos no responden la pregunta que el huésped se
                hace, que es si llega y vuelve en el día. «80 km» al Perito
                Moreno suena cerca hasta que se maneja por ruta de montaña.
              */}
              <dl className="divide-y divide-tinta/10 border-y border-tinta/10">
                {[
                  [p.distanciaCentro, '2 km', '5 min'],
                  [p.distanciaAeropuerto, '23 km', '20 min'],
                  [p.distanciaGlaciar, '80 km', '1 h 20'],
                  [p.distanciaChalten, '215 km', '3 h'],
                ].map(([lugar, km, tiempo]) => (
                  <div key={lugar} className="flex items-baseline justify-between gap-4 py-3">
                    <dt className="text-sm text-tinta-suave">{lugar}</dt>
                    <dd className="flex shrink-0 items-baseline gap-3 tabular-nums">
                      <span className="text-sm font-medium text-tinta">{km}</span>
                      <span className="text-xs text-tinta-suave">{tiempo}</span>
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-8 space-y-4 text-sm">
                <div>
                  <span className="block text-[10px] font-semibold tracking-[0.18em] text-tinta-suave uppercase">
                    {p.telefono}
                  </span>
                  <a
                    href="tel:+542902493370"
                    className="toque inline-flex items-center font-medium text-tinta hover:text-lago-700"
                  >
                    +54 (2902) 493370
                  </a>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold tracking-[0.18em] text-tinta-suave uppercase">
                    {p.email}
                  </span>
                  <a
                    href="mailto:blancapatagonia@cotecal.com.ar"
                    className="toque inline-flex items-center font-medium break-all text-tinta hover:text-lago-700"
                  >
                    blancapatagonia@cotecal.com.ar
                  </a>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold tracking-[0.18em] text-tinta-suave uppercase">
                    {p.horariosEtiqueta}
                  </span>
                  <span className="font-medium text-tinta">{horarios}</span>
                </div>
              </div>

              {/* El enlace al mapa va con el resto de los datos y ya no tapando
                  una foto: así se entiende que abre un mapa y no la galería. */}
              <a
                href="https://www.google.com/maps/search/?api=1&query=Charles+Fuhr+149,+El+Calafate,+Santa+Cruz"
                target="_blank"
                rel="noopener noreferrer"
                className={enlaceFlecha('border-lago-700/40 text-lago-700 hover:border-lago-700')}
              >
                {p.abrirEnMapas}
                <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1">
                  ↗
                </span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FRANJA DE FOTOS ═══════════════════════ */}
      {/*
        Desplazamiento continuo, patrón `marquee` de Tengile MalaMala. La lista
        va DUPLICADA a propósito: la animación corre media anchura y vuelve a
        cero, y como la segunda mitad es idéntica el salto es invisible.
        `aria-hidden` porque es decorativa y las mismas fotos ya aparecen, con
        texto alternativo, en las secciones de arriba.
      */}
      <section aria-hidden="true" className="overflow-hidden">
        <div className="franja-fotos flex w-max">
          {[...FRANJA, ...FRANJA].map((src, i) => (
            <div
              key={`${src}-${i}`}
              className="relative h-52 w-72 shrink-0 overflow-hidden sm:h-80 sm:w-[26rem]"
            >
              <Image src={src} alt="" fill sizes="(min-width: 640px) 416px, 288px" className="object-cover" />
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════ ANTES DE RESERVAR ═══════════════════════ */}
      <section className="bg-hueso px-5 py-16 telefono:px-4 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <div data-revelar className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-medium tracking-[0.25em] text-lago-700 uppercase">
              {p.antesDeReservar}
            </p>
            <h2 className="mt-3 font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-tinta sm:text-5xl">
              {p.loQueConvieneSaber}
            </h2>
          </div>

          {/*
            Lista numerada, no dos columnas de texto.

            En dos columnas las seis preguntas se leían como un bloque gris: no
            hay dónde apoyar la vista y ninguna se destaca. Numeradas y en una
            sola columna se recorren de arriba abajo, el número da el ritmo, y
            como cada fila entra en pantalla por separado, la aparición se
            escalona sola —sin retardos escritos a mano.

            ⚠️ La línea divisoria lleva `data-linea`, que anima `scaleX`. Tiene
            que ir sobre un elemento que SEA la línea: puesto sobre el contenido
            —como estuvo un momento— no dibuja nada, comprime el texto y lo deja
            ilegible mientras dura la animación.
          */}
          <ol className="mx-auto mt-12 max-w-3xl">
            {c.preguntas.map((q, i) => (
              <li
                key={q.p}
                className="relative grid gap-x-6 gap-y-1.5 py-7 sm:grid-cols-[2.5rem_1fr]"
              >
                <span
                  data-linea
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-px bg-tinta/15"
                />
                <span
                  aria-hidden="true"
                  className="font-display text-sm font-semibold text-lago-700/60 tabular-nums"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div data-revelar-lado>
                  <h3 className="font-display text-lg leading-snug font-semibold text-tinta">
                    {q.p}
                  </h3>
                  <p className="mt-2 leading-relaxed text-tinta-suave">{q.r}</p>
                </div>
              </li>
            ))}
          </ol>

          {/*
            Política de cancelación.

            Se muestra sólo si se pudo leer de la base: un texto por defecto
            podría anunciar condiciones que ya no son las del hotel, y es una
            promesa de plata. La redacción sale de `lineasCancelacion`, que en
            español produce lo mismo que `describirPoliticaCancelacion` —la que
            usa el asistente— y en los otros idiomas traduce las mismas reglas.
          */}
          {lineasCancelacionTexto.length > 0 && (
            <div data-revelar className="mt-12 rounded-3xl bg-white/70 p-6 ring-1 ring-tinta/10 sm:p-8">
              <h3 className="font-display text-xl font-semibold text-tinta">{p.siTenesQueCancelar}</h3>
              <p className="mt-2 text-sm text-tinta-suave">{p.cancelarTexto}</p>
              <ul className="mt-4 space-y-2.5">
                {lineasCancelacionTexto.map((linea) => (
                  <li key={linea} className="flex items-start gap-2.5 text-sm text-stone-700">
                    <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-lago-600" />
                    <span className="leading-snug">{linea}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-tinta/10 pt-4 text-xs text-stone-500">{p.noShow}</p>
            </div>
          )}
        </div>
      </section>

      {/* ═══════════════════════ CIERRE ═══════════════════════ */}
      <section className="relative isolate overflow-hidden px-5 py-20 text-center telefono:px-4 sm:px-6 sm:py-28">
        <Image
          src="/hotel/fotos/lobby/ventanal-pareja.jpg"
          alt=""
          fill
          sizes="100vw"
          data-parallax
          className="-z-10 object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-stone-950/60" />
        <div data-revelar>
          <h2 className="mx-auto max-w-2xl font-display text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.03em] text-balance text-white sm:text-5xl">
            {p.cierreTitulo}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-white/85">{p.cierreTexto}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href={ruta('/reservar')} className={botonClaro}>
              {p.cierreBoton}
            </Link>
            <Link href={ruta('/alojamientos')} className={botonFantasma}>
              {p.cierreSecundario}
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOOTER ═══════════════════════ */}
      </main>

      <footer className="bg-stone-950 text-white">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-14">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <h2 className="font-display text-xl font-semibold">Blanca Patagonia</h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-stone-400">{p.pieDescripcion}</p>
            </div>

            <div>
              <h2 className="text-xs font-semibold tracking-[0.15em] text-stone-400 uppercase">
                {p.pieElHotel}
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link href={ruta('/alojamientos')} className="toque inline-flex items-center text-stone-300 transition hover:text-white">
                    {t.nav.alojamientos}
                  </Link>
                </li>
                <li>
                  <Link href={ruta('/reservar')} className="toque inline-flex items-center text-stone-300 transition hover:text-white">
                    {t.nav.reservar}
                  </Link>
                </li>
                <li>
                  <a href="#experiencias" className="toque inline-flex items-center text-stone-300 transition hover:text-white">
                    {t.nav.experiencias}
                  </a>
                </li>
                <li>
                  <a href="#ubicacion" className="toque inline-flex items-center text-stone-300 transition hover:text-white">
                    {p.comoLlegarEtiqueta}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h2 className="text-xs font-semibold tracking-[0.15em] text-stone-400 uppercase">
                {p.contacto}
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <a href="tel:+542902493370" className="toque inline-flex items-center text-stone-300 transition hover:text-white">
                    +54 (2902) 493370
                  </a>
                </li>
                <li>
                  <a
                    href="mailto:blancapatagonia@cotecal.com.ar"
                    className="toque inline-flex items-center break-all text-stone-300 transition hover:text-white"
                  >
                    blancapatagonia@cotecal.com.ar
                  </a>
                </li>
              </ul>
              <div className="mt-4 flex gap-2.5" aria-label={p.pieRedes}>
                <a
                  href="https://www.facebook.com/blancapatagonia"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Facebook"
                  className="toque flex size-11 items-center justify-center rounded-full bg-stone-800 text-stone-300 transition hover:bg-stone-700 hover:text-white"
                >
                  <svg className="size-4.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                </a>
                <a
                  href="https://www.instagram.com/blancapatagonia"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                  className="toque flex size-11 items-center justify-center rounded-full bg-stone-800 text-stone-300 transition hover:bg-stone-700 hover:text-white"
                >
                  <svg className="size-4.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          {/* Selector de idioma, entero y a la vista: es el único lugar donde
              está en el teléfono, así que no puede ir plegado. */}
          <div className="mt-10 border-t border-stone-800 pt-6">
            <SelectorIdioma idioma={idioma} tono="claro" etiqueta={t.nav.idioma} />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-stone-500">
            <span>© {new Date().getFullYear()} Blanca Patagonia · El Calafate, Santa Cruz</span>
            {/* Entrada del personal al panel de gestión. Discreta pero visible:
                quien trabaja acá la usa todos los días. */}
            <Link href="/panel" className="toque inline-flex items-center text-stone-400 transition hover:text-stone-200">
              {p.pieAccesoPersonal} →
            </Link>
          </div>
        </div>
      </footer>

      {/*
        «Volver arriba». Aparece recién cuando se bajó más de una pantalla (con
        una animación guiada por scroll) y lleva al principio con el
        desplazamiento suave de la página. Va a la izquierda: a la derecha
        está el asistente, y dos botones flotantes juntos se tocan por error.
      */}
      <a
        href="#inicio"
        data-volver-arriba
        aria-label={t.nav.volverArriba}
        className="toque fixed bottom-4 left-4 z-40 flex size-12 items-center justify-center rounded-full bg-white/80 text-tinta shadow-lg ring-1 ring-tinta/10 backdrop-blur-xl transition hover:bg-white active:scale-95 sm:bottom-6 sm:left-6"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-6 6m6-6 6 6" />
        </svg>
      </a>

      {/* Asistente por reglas (ADR 0011). Resuelve horarios, cancelación y
          servicios sin ocupar a recepción. */}
      <AsistenteFlotante
        t={t.asistente}
        consultasEs={[
          diccionarioEs.asistente.sugerencia1,
          diccionarioEs.asistente.sugerencia2,
          diccionarioEs.asistente.sugerencia3,
        ]}
      />
    </div>
  )
}
