'use client'

export function BotonImprimir() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800 print:hidden"
    >
      Imprimir / Guardar PDF
    </button>
  )
}
