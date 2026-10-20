import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'
import { FormularioUsuario } from '../formulario'

/**
 * Alta de un usuario del panel, en su propia pantalla.
 *
 * El acceso al área ya está restringido a `admin` por `requerirAcceso`: crear
 * usuarios es la operación más delicada del sistema.
 */
export default async function NuevoUsuarioPage() {
  await requerirAcceso('usuarios')

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/usuarios"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a usuarios
      </Link>

      <Encabezado
        titulo="Dar de alta un usuario"
        descripcion="Va a poder entrar al panel con el email y la contraseña que cargues."
        icono="usuarios"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioUsuario />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
