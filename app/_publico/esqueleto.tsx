/**
 * Esqueleto de carga para las pantallas públicas.
 *
 * Por qué un esqueleto y no un spinner: un spinner dice «esperá» y nada más. Un
 * esqueleto que reproduce la forma de lo que viene reduce el salto visual cuando
 * el contenido llega, y le anticipa a la persona qué va a ver. Es el mismo
 * criterio que ya usa el panel (`app/panel/_components/esqueletos.tsx`).
 *
 * `aria-hidden` y el texto para lector de pantalla van juntos a propósito: las
 * cajas grises no significan nada para quien no las ve, así que se ocultan y se
 * anuncia el estado con palabras.
 */
export function EsqueletoPublico({ bloques = 3 }: { bloques?: number }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <span className="sr-only" role="status">
        Cargando…
      </span>

      <div aria-hidden="true" className="animate-pulse space-y-6">
        <div className="h-8 w-2/3 rounded-lg bg-stone-200" />
        <div className="h-4 w-1/2 rounded bg-stone-100" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: bloques }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-2xl border border-stone-200 p-4">
              <div className="h-32 rounded-xl bg-stone-200" />
              <div className="h-4 w-3/4 rounded bg-stone-100" />
              <div className="h-4 w-1/2 rounded bg-stone-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Variante para las pantallas de un solo formulario (firma, encuesta, checkout). */
export function EsqueletoFormularioPublico() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-12">
      <span className="sr-only" role="status">
        Cargando…
      </span>

      <div aria-hidden="true" className="animate-pulse space-y-5 rounded-2xl border border-stone-200 p-6">
        <div className="h-7 w-2/3 rounded-lg bg-stone-200" />
        <div className="h-4 w-full rounded bg-stone-100" />
        <div className="h-4 w-5/6 rounded bg-stone-100" />
        <div className="h-11 w-full rounded-lg bg-stone-200" />
        <div className="h-11 w-full rounded-lg bg-stone-200" />
        <div className="h-11 w-40 rounded-lg bg-stone-300" />
      </div>
    </div>
  )
}
