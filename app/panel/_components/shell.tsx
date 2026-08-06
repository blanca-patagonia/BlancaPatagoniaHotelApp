'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { areasDe, ETIQUETAS_AREA, type Area } from '@/lib/domain/permisos'
import type { Rol } from '@/lib/domain/roles'
import { Icono, Logotipo, type NombreIcono } from './iconos'

/** Ruta e icono de cada área del panel. */
const NAV: Record<Area, { href: string; icono: NombreIcono }> = {
  dashboard: { href: '/panel', icono: 'inicio' },
  ocupacion: { href: '/panel/ocupacion', icono: 'ocupacion' },
  reservas: { href: '/panel/reservas', icono: 'reservas' },
  huespedes: { href: '/panel/huespedes', icono: 'huespedes' },
  housekeeping: { href: '/panel/housekeeping', icono: 'housekeeping' },
  mantenimiento: { href: '/panel/mantenimiento', icono: 'mantenimiento' },
  objetos_perdidos: { href: '/panel/objetos-perdidos', icono: 'objetos' },
  avisos: { href: '/panel/avisos', icono: 'avisos' },
  conversaciones: { href: '/panel/conversaciones', icono: 'chat' },
  agencias: { href: '/panel/agencias', icono: 'agencias' },
  proveedores: { href: '/panel/proveedores', icono: 'proveedores' },
  contratos: { href: '/panel/contratos', icono: 'contratos' },
  auditoria: { href: '/panel/auditoria', icono: 'auditoria' },
  reportes: { href: '/panel/reportes', icono: 'reportes' },
  config: { href: '/panel/config', icono: 'config' },
  usuarios: { href: '/panel/usuarios', icono: 'usuarios' },
  ayuda: { href: '/panel/ayuda', icono: 'ayuda' },
}

/** El área está activa si es la ruta exacta (Inicio) o un prefijo (el resto). */
function estaActivo(pathname: string, area: Area, href: string): boolean {
  return area === 'dashboard' ? pathname === href : pathname.startsWith(href)
}

function Enlaces({ rol, pathname, alNavegar }: { rol: Rol; pathname: string; alNavegar?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3" aria-label="Secciones del panel">
      {areasDe(rol).map((area) => {
        const { href, icono } = NAV[area]
        const activo = estaActivo(pathname, area, href)
        return (
          <Link
            key={area}
            href={href}
            onClick={alNavegar}
            aria-current={activo ? 'page' : undefined}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              activo
                ? 'bg-white/15 text-white'
                : 'text-lago-100/80 hover:bg-white/10 hover:text-white'
            }`}
          >
            {activo && (
              <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-lenga-400" aria-hidden="true" />
            )}
            <span className={activo ? 'text-lenga-300' : 'text-lago-300/70 group-hover:text-lago-200'}>
              <Icono nombre={icono} tam={18} />
            </span>
            {ETIQUETAS_AREA[area]}
          </Link>
        )
      })}
    </nav>
  )
}

function Marca() {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
      <Logotipo tam={34} />
      <div className="min-w-0">
        <p className="font-display truncate text-base leading-tight font-semibold text-white">
          Blanca Patagonia
        </p>
        <p className="truncate text-[11px] tracking-wide text-lago-200/80 uppercase">
          Gestión hotelera
        </p>
      </div>
    </div>
  )
}

const FONDO_LATERAL = 'bg-gradient-to-b from-lago-800 via-lago-900 to-lago-950'

interface Props {
  rol: Rol
  nombre: string
  rolEtiqueta: string
  /** Formulario de cierre de sesión (viene del layout, que es de servidor). */
  salir: ReactNode
  children: ReactNode
}

/**
 * Estructura del panel: barra lateral fija en escritorio y cajón deslizable en
 * móvil. Antes la barra simplemente se ocultaba por debajo de `sm`, con lo cual
 * desde un teléfono no había manera de cambiar de sección.
 */
export function PanelShell({ rol, nombre, rolEtiqueta, salir, children }: Props) {
  const pathname = usePathname()
  const [abierto, setAbierto] = useState(false)

  // El cajón se cierra desde el `onClick` de cada enlace (ver `alNavegar`), no
  // con un efecto sobre `pathname`: así se evita un render en cascada.

  // Con el cajón abierto se bloquea el scroll del fondo.
  useEffect(() => {
    document.body.style.overflow = abierto ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [abierto])

  // Escape cierra el cajón (accesibilidad por teclado).
  useEffect(() => {
    if (!abierto) return
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  }, [abierto])

  return (
    <div className="flex flex-1 bg-stone-50">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Saltar al contenido
      </a>

      {/* Barra lateral — escritorio */}
      <aside className={`hidden w-60 shrink-0 flex-col lg:flex ${FONDO_LATERAL}`}>
        <Marca />
        <Enlaces rol={rol} pathname={pathname} />
        <p className="border-t border-white/10 px-4 py-3 text-[11px] text-lago-200/70">
          El Calafate · Santa Cruz
        </p>
      </aside>

      {/* Cajón — móvil */}
      {abierto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
            onClick={() => setAbierto(false)}
            aria-label="Cerrar el menú"
          />
          <div
            className={`absolute inset-y-0 left-0 flex w-64 flex-col shadow-2xl ${FONDO_LATERAL}`}
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
          >
            <div className="flex items-center justify-between border-b border-white/10 pr-2">
              <div className="min-w-0 flex-1">
                <Marca />
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded-lg p-2 text-lago-100 transition hover:bg-white/10"
                aria-label="Cerrar el menú"
              >
                <Icono nombre="cerrar" tam={20} />
              </button>
            </div>
            <Enlaces rol={rol} pathname={pathname} alNavegar={() => setAbierto(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-stone-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="rounded-lg p-2 text-stone-600 transition hover:bg-stone-100 lg:hidden"
            aria-label="Abrir el menú"
            aria-expanded={abierto}
          >
            <Icono nombre="menu" tam={20} />
          </button>
          <span className="font-display text-base font-semibold text-lago-800 lg:hidden">
            Blanca Patagonia
          </span>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium text-stone-800">{nombre}</p>
              <p className="text-xs text-stone-500">{rolEtiqueta}</p>
            </div>
            <span
              className="flex size-9 items-center justify-center rounded-full bg-lago-100 text-sm font-semibold text-lago-800 ring-1 ring-lago-200"
              aria-hidden="true"
            >
              {nombre.slice(0, 1).toUpperCase()}
            </span>
            {salir}
          </div>
        </header>

        <main id="contenido" className="min-w-0 flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
