'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Las secciones de la bandeja, siempre a la vista (en Chatwoot son las pestañas
 * de su barra lateral: conversaciones, contactos, informes, configuración).
 *
 * Reemplaza una fila de botones sueltos en el encabezado: con seis destinos,
 * quien no usa mucho la computadora no sabe cuáles son «pantallas» y cuáles
 * «acciones». Acá todos son lugares, y el activo se marca.
 */
const SECCIONES = [
  { href: '/panel/bandeja', texto: 'Conversaciones', exacto: true },
  { href: '/panel/bandeja/contactos', texto: 'Contactos' },
  { href: '/panel/bandeja/informes', texto: 'Informes' },
  { href: '/panel/bandeja/conectar', texto: 'Canales' },
  { href: '/panel/bandeja/respuestas', texto: 'Respuestas guardadas' },
  { href: '/panel/bandeja/etiquetas', texto: 'Etiquetas', soloDireccion: true },
] as const

export function SubNavBandeja({ direccion = false }: { direccion?: boolean }) {
  const ruta = usePathname()
  return (
    <nav aria-label="Secciones de la bandeja" className="mb-5 -mt-2 overflow-x-auto border-b border-stone-200">
      <ul className="flex min-w-max gap-1">
        {SECCIONES.filter((s) => !('soloDireccion' in s) || direccion).map((s) => {
          const activa = 'exacto' in s ? ruta === s.href : ruta.startsWith(s.href)
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={activa ? 'page' : undefined}
                className={`toque inline-flex items-center border-b-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition ${
                  activa ? 'border-lago-700 text-lago-800' : 'border-transparent text-stone-600 hover:border-stone-300 hover:text-stone-900'
                }`}
              >
                {s.texto}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
