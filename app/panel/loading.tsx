/**
 * Esqueleto de carga del panel.
 *
 * Next lo muestra mientras el componente de servidor espera a la base, así la
 * navegación entre secciones deja de sentirse trabada.
 */
export default function Cargando() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="mb-6 flex items-end justify-between gap-4 border-b border-stone-200 pb-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-stone-200" />
          <div className="space-y-2">
            <div className="h-5 w-44 rounded bg-stone-200" />
            <div className="h-3 w-64 rounded bg-stone-100" />
          </div>
        </div>
        <div className="h-9 w-32 rounded-lg bg-stone-200" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-stone-200 bg-white" />
        ))}
      </div>
      <div className="mt-6 h-72 rounded-2xl border border-stone-200 bg-white" />
    </div>
  )
}
