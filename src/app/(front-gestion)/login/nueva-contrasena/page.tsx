import { LARGO_MINIMO_PASSWORD } from '@/lib/domain/cuenta'
import { FormularioNuevaPassword } from './formulario'
import { EscenarioLogin } from '../escenario'

/**
 * Fijar la contraseña nueva, después de entrar por el enlace del correo.
 *
 * ⚠️ Esta pantalla **no comprueba la sesión acá arriba**, a diferencia de
 * `/login` y `/login/recuperar` que redirigen si ya hay una. Es deliberado:
 * quien llega desde el enlace de recuperación **sí tiene** una sesión —la que
 * creó el propio enlace—, y redirigirla al panel le impediría hacer justamente
 * lo que vino a hacer.
 *
 * Quien la validez del enlace sí verifica es la acción: sin sesión no hay
 * usuario que actualizar, y ahí se explica que el enlace venció.
 */
export default function NuevaPasswordPage() {
  return (
    <EscenarioLogin titulo="Contraseña nueva" bajada="Elegí una contraseña y entrás directo al panel.">
      <FormularioNuevaPassword largoMinimo={LARGO_MINIMO_PASSWORD} />
    </EscenarioLogin>
  )
}
