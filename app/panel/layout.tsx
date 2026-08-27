import type { ReactNode } from 'react'
import { requerirSesion } from '@/lib/auth/session'
import { ETIQUETAS_ROL } from '@/lib/domain/roles'
import { cerrarSesion } from '@/app/login/actions'
import { PanelShell } from './_components/shell'
import { Icono } from './_components/iconos'
import { SoportePWA } from './_components/pwa'

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const sesion = await requerirSesion()

  return (
    <PanelShell
      rol={sesion.rol}
      nombre={sesion.nombre}
      rolEtiqueta={ETIQUETAS_ROL[sesion.rol]}
      salir={
        <form action={cerrarSesion}>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
            aria-label="Cerrar sesión"
          >
            <Icono nombre="salir" tam={16} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </form>
      }
    >
      {/*
        Van dentro del shell y antes del contenido para que el aviso de «sin
        conexión» y el cartel de instalación aparezcan arriba de la pantalla,
        sin taparla y sin desplazar el menú.
      */}
      <div className="mb-4 flex flex-col gap-3 empty:mb-0">
        <SoportePWA />
      </div>
      {children}
    </PanelShell>
  )
}
