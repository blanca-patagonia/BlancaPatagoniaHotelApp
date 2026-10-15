'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  IDIOMAS,
  NOMBRE_IDIOMA,
  CODIGO_CORTO,
  ETIQUETA_BCP47,
  rutaConIdioma,
  type Idioma,
} from '@/lib/i18n/idiomas'

/*
  Selector de idioma del portal.

  ── Se queda en la misma pantalla ───────────────────────────────────────────
  Cambiar de idioma no manda a la portada: `/es/reservar?check_in=…` pasa a
  `/en/reservar?check_in=…`, con la búsqueda intacta. Quien estaba mirando los
  resultados y no entendía una palabra no tiene que volver a cargar las fechas.

  ── Cada idioma, escrito en su idioma ───────────────────────────────────────
  «English», no «Inglés»: quien necesita cambiar es justamente quien no lee el
  idioma en el que está la página. Y sin banderas (ver `CODIGO_CORTO`).

  ── Por qué el `Suspense` ───────────────────────────────────────────────────
  `useSearchParams` en una página estática hace que Next renderice el
  componente sólo en el cliente. Con el `Suspense`, el HTML del servidor trae
  los enlaces sin la búsqueda —que igual funcionan— y el cliente los completa.
*/

interface Props {
  idioma: Idioma
  /** `fila`: enlaces a la vista (pie). `menu`: lista desplegable nativa (encabezado). */
  variante?: 'fila' | 'menu'
  /** `claro` sobre fondo oscuro o sobre una foto. */
  tono?: 'claro' | 'oscuro'
  etiqueta: string
}

export function SelectorIdioma(props: Props) {
  return (
    <Suspense fallback={<Selector {...props} consulta="" />}>
      <SelectorConConsulta {...props} />
    </Suspense>
  )
}

function SelectorConConsulta(props: Props) {
  const consulta = useSearchParams().toString()
  return <Selector {...props} consulta={consulta} />
}

function Selector({
  idioma,
  variante = 'fila',
  tono = 'oscuro',
  etiqueta,
  consulta,
}: Props & { consulta: string }) {
  const ruta = usePathname() || '/'
  const router = useRouter()
  const destino = (i: Idioma) => `${rutaConIdioma(ruta, i)}${consulta ? `?${consulta}` : ''}`

  if (variante === 'menu') {
    return (
      <label
        className={`toque relative inline-flex items-center gap-1.5 text-sm font-medium ${
          tono === 'claro' ? 'text-white/90 hover:text-white' : 'text-tinta-suave hover:text-tinta'
        }`}
      >
        <Globo />
        <span className="sr-only">{etiqueta}</span>
        {/* Nativo y no un menú propio: en el teléfono abre el selector del
            sistema, que la persona ya sabe usar, y funciona con teclado y
            lector de pantalla sin escribir nada. */}
        <select
          value={idioma}
          onChange={(e) => router.push(destino(e.target.value as Idioma))}
          className="cursor-pointer appearance-none bg-transparent pr-1 font-medium outline-none focus-visible:underline"
        >
          {IDIOMAS.map((i) => (
            <option key={i} value={i} lang={ETIQUETA_BCP47[i]} className="text-tinta">
              {CODIGO_CORTO[i]} · {NOMBRE_IDIOMA[i]}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <nav aria-label={etiqueta} className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      <Globo />
      {IDIOMAS.map((i) => {
        const actual = i === idioma
        return (
          <Link
            key={i}
            href={destino(i)}
            lang={ETIQUETA_BCP47[i]}
            hrefLang={ETIQUETA_BCP47[i]}
            aria-current={actual ? 'true' : undefined}
            className={`toque inline-flex items-center rounded-full px-2.5 transition ${
              tono === 'claro'
                ? actual
                  ? 'bg-white/15 text-white'
                  : 'text-stone-400 hover:text-white'
                : actual
                  ? 'bg-tinta/[0.07] text-tinta'
                  : 'text-tinta-suave hover:text-tinta'
            }`}
          >
            {NOMBRE_IDIOMA[i]}
          </Link>
        )
      })}
    </nav>
  )
}

function Globo() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0 opacity-80"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  )
}
