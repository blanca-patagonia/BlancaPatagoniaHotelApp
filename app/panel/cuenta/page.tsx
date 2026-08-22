import { requerirSesion } from '@/lib/auth/session'
import { ETIQUETAS_ROL } from '@/lib/domain/roles'
import { Encabezado, Pagina, Tarjeta } from '../_components/ui'
import { FormularioCuenta } from './formulario'

export const metadata = { title: 'Mi cuenta — Blanca Patagonia' }

/**
 * Mi cuenta.
 *
 * No lleva `requerirAcceso(area)` a propósito: no opera sobre datos del hotel
 * sino sobre la cuenta de quien entra, así que la tiene que poder abrir
 * cualquier rol. `requerirSesion` es la barrera correcta acá, y la acción vuelve
 * a exigirla por su cuenta (una Server Action es un endpoint público).
 *
 * Existe porque hasta ahora **no había forma de cambiarse la contraseña desde el
 * sistema**: el avatar no abría nada y la única salida era pedirle a un
 * administrador que rehiciera el usuario. Para un hotel con rotación de
 * temporada eso significa contraseñas que no se rotan nunca.
 */
export default async function CuentaPage() {
  const sesion = await requerirSesion()

  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo="Mi cuenta"
        descripcion="Tus datos y tu contraseña. Solo afecta a tu usuario."
        icono="usuarios"
      />

      <Tarjeta titulo="Tus datos" className="mb-5">
        <dl className="grid gap-4 p-5 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-stone-600">Nombre</dt>
            <dd className="mt-0.5 font-medium text-stone-900">{sesion.nombre}</dd>
          </div>
          <div>
            <dt className="text-sm text-stone-600">Email</dt>
            <dd className="mt-0.5 font-medium break-all text-stone-900">{sesion.email}</dd>
          </div>
          <div>
            <dt className="text-sm text-stone-600">Rol</dt>
            <dd className="mt-0.5 font-medium text-stone-900">{ETIQUETAS_ROL[sesion.rol]}</dd>
          </div>
        </dl>
        {/* Que el rol no se cambie solo no es una limitación: es la regla. Se
            aclara acá para que nadie busque el botón que no está. */}
        <p className="border-t border-stone-100 px-5 py-3 text-sm text-stone-600">
          El nombre y el rol los administra un usuario con permisos sobre Usuarios.
        </p>
      </Tarjeta>

      <Tarjeta titulo="Cambiar mi contraseña">
        <div className="p-5">
          <FormularioCuenta />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
