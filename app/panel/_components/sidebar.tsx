'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { areasDe, ETIQUETAS_AREA, type Area } from '@/lib/domain/permisos'
import type { Rol } from '@/lib/domain/roles'

const HREF: Record<Area, string> = {
  dashboard: '/panel',
  ocupacion: '/panel/ocupacion',
  reservas: '/panel/reservas',
  huespedes: '/panel/huespedes',
  housekeeping: '/panel/housekeeping',
  reportes: '/panel/reportes',
  config: '/panel/config',
  usuarios: '/panel/usuarios',
}

export function Sidebar({ rol }: { rol: Rol }) {
  const pathname = usePathname()
  const areas = areasDe(rol)

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-white sm:flex">
      <div className="border-b border-stone-200 px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-widest text-sky-700">
          Blanca Patagonia
        </p>
        <p className="text-sm font-semibold text-stone-800">Gestión hotelera</p>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {areas.map((area) => {
          const href = HREF[area]
          const activo =
            area === 'dashboard' ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={area}
              href={href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                activo
                  ? 'bg-sky-50 text-sky-800'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              {ETIQUETAS_AREA[area]}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-stone-200 px-5 py-3 text-xs text-stone-400">
        El Calafate · Santa Cruz
      </div>
    </aside>
  )
}
