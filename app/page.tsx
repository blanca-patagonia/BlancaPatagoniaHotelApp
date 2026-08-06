import Link from 'next/link'
import { HORA_CHECK_IN, HORA_CHECK_OUT, SERVICIOS } from '@/lib/domain/hotel'
import { botonPublico } from './_publico/ui'

export const metadata = {
  title: 'Blanca Patagonia — Hostería y cabañas en El Calafate',
  description:
    'Hostería boutique y cabañas frente al Lago Argentino, en El Calafate. Reservá tu estadía en línea.',
}

/**
 * Portada del sitio.
 *
 * Es lo primero que ve alguien que llega buscando dónde alojarse, así que tiene
 * una sola tarea: llevarlo a reservar. Todo lo demás —servicios, horarios— está
 * para responder las dudas que frenan esa decisión, no para lucirse.
 */
export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <section className="flex flex-1 flex-col items-center justify-center gap-6 bg-gradient-to-b from-lago-50 to-stone-100 px-5 py-20 text-center sm:px-6">
        <p className="text-sm font-medium tracking-[0.2em] text-lago-700 uppercase">
          Hostería boutique &amp; cabañas
        </p>
        <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight text-stone-900 sm:text-6xl">
          Blanca Patagonia
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-stone-600">
          Frente al Lago Argentino, en El Calafate. Habitaciones con vista e hidromasaje y cabañas
          con hogar a leña, a pasos del Parque Nacional Los Glaciares.
        </p>

        <div className="mt-2 flex w-full max-w-md flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center">
          <Link href="/reservar" className={botonPublico('primario', 'text-lg')}>
            Ver disponibilidad
          </Link>
          <a
            href="https://www.blancapatagonia.com"
            target="_blank"
            rel="noopener noreferrer"
            className={botonPublico('secundario')}
          >
            Conocé el hotel
          </a>
        </div>

        {/* Los servicios salen de `lib/domain/hotel.ts`, el mismo lugar del que
            los toma el asistente: si el hotel cambia uno, no quedan dos
            respuestas distintas conviviendo. */}
        <ul className="mt-6 flex max-w-2xl flex-wrap justify-center gap-x-3 gap-y-2 text-sm text-stone-600">
          {SERVICIOS.map((s) => (
            <li
              key={s}
              className="rounded-full bg-white/70 px-3 py-1.5 ring-1 ring-stone-200 ring-inset"
            >
              {s}
            </li>
          ))}
        </ul>

        <p className="text-sm text-stone-500">
          Check-in {HORA_CHECK_IN} · Check-out {HORA_CHECK_OUT}
        </p>
      </section>

      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-5 py-5 text-sm text-stone-500 sm:px-6">
          <span>El Calafate · Santa Cruz · Argentina</span>
          <Link href="/panel" className="transition hover:text-stone-800">
            Acceso del personal →
          </Link>
        </div>
      </footer>
    </div>
  )
}
