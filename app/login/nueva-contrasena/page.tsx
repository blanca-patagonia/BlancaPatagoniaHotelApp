import { LARGO_MINIMO_PASSWORD } from '@/lib/domain/cuenta'
import { FormularioNuevaPassword } from './formulario'

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
    <main className="flex flex-1 items-center justify-center bg-stone-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-lago-700">
            Blanca Patagonia
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">
            Contraseña nueva
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Elegí una contraseña y entrás directo al panel.
          </p>
        </div>
        <FormularioNuevaPassword largoMinimo={LARGO_MINIMO_PASSWORD} />
      </div>
    </main>
  )
}
