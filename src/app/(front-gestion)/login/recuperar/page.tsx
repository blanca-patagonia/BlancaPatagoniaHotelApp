import { redirect } from 'next/navigation'
import { obtenerSesion } from '@/lib/auth/session'
import { FormularioRecuperar } from './formulario'
import { EscenarioLogin } from '../escenario'

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
    <EscenarioLogin titulo="Recuperar el acceso" bajada="Te mandamos un enlace para que puedas poner una contraseña nueva.">
      <FormularioRecuperar />
    </EscenarioLogin>
  )
}
