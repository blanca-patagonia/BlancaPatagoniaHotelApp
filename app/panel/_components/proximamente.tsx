export function Proximamente({ titulo, paso }: { titulo: string; paso: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{titulo}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-stone-300 bg-white p-12 text-center">
        <p className="text-stone-500">Sección en construcción.</p>
        <p className="mt-1 text-sm text-stone-400">Se implementa en el {paso} de la Fase 2.</p>
      </div>
    </div>
  )
}
