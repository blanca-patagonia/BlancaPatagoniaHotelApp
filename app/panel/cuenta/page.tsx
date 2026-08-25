import { requerirSesion } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_ROL } from '@/lib/domain/roles'
import { Encabezado, Pagina, Tarjeta } from '../_components/ui'
import { FormularioCuenta } from './formulario'
import { FormularioMisDatos } from './formulario-datos'

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

  // El teléfono no está en la sesión —que se arma para autorizar, no para
  // mostrar—, así que se lee acá. Si la consulta falla se muestra vacío: no
  // vale la pena romper la pantalla entera, y el resto sigue funcionando.
  const supabase = await crearClienteServidor()
  const { data: perfil } = await supabase
    .from('perfiles')
    .select('telefono')
    .eq('id', sesion.userId)
    .maybeSingle()

  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo="Mi cuenta"
        descripcion="Tus datos y tu contraseña. Solo afecta a tu usuario."
        icono="usuarios"
      />

      <Tarjeta
        titulo="Tus datos"
        descripcion="Lo que podés corregir vos mismo, sin pedírselo a nadie."
        className="mb-5"
      >
        <div className="p-5">
          <FormularioMisDatos
            nombre={sesion.nombre}
            telefono={(perfil?.telefono as string | undefined) ?? ''}
          />
        </div>

        {/*
          Lo que NO se edita, con el motivo al lado.

          Un campo deshabilitado sin explicación se lee como una falla del
          sistema; con el motivo, se entiende que es una decisión. Y el rol se
          muestra porque saber con qué permisos estás trabajando es información
          útil, no un dato administrativo.
        */}
        <dl className="grid gap-4 border-t border-stone-100 px-5 py-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-sm text-stone-600">Email</dt>
            <dd className="mt-0.5 font-medium wrap-anywhere text-stone-900">{sesion.email}</dd>
            <dd className="mt-0.5 text-xs text-stone-500">
              Es con el que iniciás sesión. Para cambiarlo, pedíselo a un administrador.
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-stone-600">Rol</dt>
            <dd className="mt-0.5 font-medium text-stone-900">{ETIQUETAS_ROL[sesion.rol]}</dd>
            <dd className="mt-0.5 text-xs text-stone-500">
              Define qué secciones ves. Solo lo cambia un administrador.
            </dd>
          </div>
        </dl>
      </Tarjeta>

      <Tarjeta titulo="Cambiar mi contraseña">
        <div className="p-5">
          <FormularioCuenta />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
