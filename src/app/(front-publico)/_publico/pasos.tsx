import Link from 'next/link'
import { rellenar, type Diccionario } from '@/lib/i18n'

/*
  Barra de pasos de la reserva, al estilo del flujo de compra de Aman:
  Fechas → Alojamiento → Tus datos → Confirmación.

  Dos cosas que la hacen útil y no decorativa:

  1. **Dice dónde está uno y cuánto falta.** Quien reserva desde el teléfono
     no ve el recorrido completo; «Paso 3 de 4» le dice que está a un paso.
  2. **Los pasos ya hechos son enlaces.** Es la forma visible de volver atrás
     sin depender del botón del navegador —el pedido explícito del usuario—, y
     vuelven con la búsqueda intacta (fechas y huéspedes en la URL).

  Los pasos que todavía no se alcanzaron NO son enlaces: saltar a «Tus datos»
  sin haber elegido alojamiento no tiene destino posible.
*/

export type Paso = 1 | 2 | 3 | 4

export function Pasos({
  actual,
  t,
  enlaces,
}: {
  actual: Paso
  t: Diccionario['pasos']
  /** Destino de cada paso ya hecho. Un paso sin enlace se muestra como texto. */
  enlaces: Partial<Record<Paso, string>>
}) {
  const nombres: Record<Paso, string> = {
    1: t.fechas,
    2: t.alojamiento,
    3: t.datos,
    4: t.confirmacion,
  }
  const pasos: Paso[] = [1, 2, 3, 4]

  return (
    <nav aria-label={t.progreso} className="mb-8">
      <p className="mb-3 text-xs font-medium tracking-[0.18em] text-tinta-suave uppercase sm:hidden">
        {rellenar(t.paso, { n: actual, total: 4 })} · {nombres[actual]}
      </p>
      <ol className="flex items-center gap-2">
        {pasos.map((p) => {
          const hecho = p < actual
          const esActual = p === actual
          const enlace = hecho ? enlaces[p] : undefined
          const contenido = (
            <>
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition ${
                  esActual
                    ? 'bg-tinta text-white'
                    : hecho
                      ? 'bg-lago-100 text-lago-800'
                      : 'bg-stone-100 text-stone-500'
                }`}
              >
                {/* El tilde es decoración: el nombre del paso dice qué es. */}
                {hecho ? <span aria-hidden="true">✓</span> : p}
              </span>
              {/* `sr-only` y no `hidden` en el teléfono: con `display:none` el
                  enlace para volver a un paso hecho se anunciaba sólo como
                  «marca de verificación». */}
              <span
                className={`sr-only text-sm whitespace-nowrap sm:not-sr-only ${
                  esActual ? 'font-semibold text-tinta' : 'text-tinta-suave'
                }`}
              >
                {nombres[p]}
              </span>
            </>
          )
          return (
            <li key={p} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
              {enlace ? (
                <Link
                  href={enlace}
                  className="toque group flex items-center gap-2 rounded-full transition hover:opacity-80"
                >
                  {contenido}
                </Link>
              ) : (
                <span aria-current={esActual ? 'step' : undefined} className="flex items-center gap-2">
                  {contenido}
                </span>
              )}
              {p < 4 && (
                <span
                  aria-hidden="true"
                  className={`h-px flex-1 ${hecho ? 'bg-lago-300' : 'bg-tinta/10'}`}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
