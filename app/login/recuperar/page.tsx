import { redirect } from 'next/navigation'
import { obtenerSesion } from '@/lib/auth/session'
import { FormularioRecuperar } from './formulario'

/**
 * Pedir el enlace para volver a entrar.
 *
 * Hasta que existió esta pantalla, quien perdía su contraseña dependía de que un
 * administrador estuviera disponible para cambiársela. Con un solo usuario admin
 * —la situación actual— eso significaba que si esa persona perdía su clave,
 * nadie entraba al sistema.
 */
export default async function RecuperarPage() {
  const sesion = await obtenerSesion()
  if (sesion) redirect('/panel')

  return (
    <main className="flex flex-1 items-center justify-center bg-stone-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-lago-700">
            Blanca Patagonia
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">
            Recuperar el acceso
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Te mandamos un enlace para que puedas poner una contraseña nueva.
          </p>
        </div>
        <FormularioRecuperar />
      </div>
    </main>
  )
}
