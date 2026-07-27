import type { ReactNode } from 'react'
import { requerirSesion } from '@/lib/auth/session'
import { ETIQUETAS_ROL } from '@/lib/domain/roles'
import { cerrarSesion } from '@/app/login/actions'
import { Sidebar } from './_components/sidebar'

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const sesion = await requerirSesion()

  return (
    <div className="flex flex-1 bg-stone-50">
      <Sidebar rol={sesion.rol} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center border-b border-stone-200 bg-white px-6 py-3">
          <div className="text-sm font-semibold text-sky-700 sm:hidden">
            Blanca Patagonia
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-stone-800">{sesion.nombre}</p>
              <p className="text-xs text-stone-500">{ETIQUETAS_ROL[sesion.rol]}</p>
            </div>
            <form action={cerrarSesion}>
              <button className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-100">
                Salir
              </button>
            </form>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
