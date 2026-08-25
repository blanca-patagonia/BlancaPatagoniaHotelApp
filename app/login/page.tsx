import { redirect } from 'next/navigation'
import { obtenerSesion } from '@/lib/auth/session'
import { FormularioLogin } from './formulario'
import { BotonGoogle } from './boton-google'
import { googleHabilitado } from './actions'

/**
 * Mensajes de los caminos que pueden fallar antes de tener sesión.
 *
 * El de `google_sin_acceso` es el que más importa: alguien se autenticó bien con
 * Google pero su cuenta no está habilitada en el sistema. Sin explicarlo,
 * rebotaría entre el login y el panel sin entender qué pasa.
 */
const MENSAJES_ERROR: Record<string, string> = {
  google:
    'No se pudo completar el ingreso con Google. Probá de nuevo o entrá con tu email y contraseña.',
  google_cancelado: 'Cancelaste el ingreso con Google.',
  google_sin_codigo: 'Google no devolvió la confirmación. Probá de nuevo.',
  google_no_configurado:
    'El ingreso con Google todavía no está configurado en este sistema.',
  google_sin_acceso:
    'Tu cuenta de Google es válida, pero todavía no tiene acceso al panel. Pedile a un administrador que te dé de alta desde Usuarios.',
  demasiados_intentos: 'Demasiados intentos seguidos. Esperá unos minutos y volvé a probar.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const sesion = await obtenerSesion()
  if (sesion) redirect('/panel')

  const { error } = await searchParams
  const conGoogle = await googleHabilitado()

  return (
    <main className="flex flex-1 items-center justify-center bg-stone-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-lago-700">
            Blanca Patagonia
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">
            Panel de gestión
          </h1>
          <p className="mt-1 text-sm text-stone-500">Ingresá con tu cuenta de staff</p>
        </div>
        {error && MENSAJES_ERROR[error] && (
          <p
            className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {MENSAJES_ERROR[error]}
          </p>
        )}

        <FormularioLogin />

        {/* Solo si está configurado: ver `BotonGoogle`. */}
        {conGoogle && (
          <>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-stone-200" />
              <span className="text-xs text-stone-500">o</span>
              <span className="h-px flex-1 bg-stone-200" />
            </div>
            <BotonGoogle />
            <p className="mt-3 text-center text-xs text-stone-500">
              Solo para cuentas ya dadas de alta por un administrador.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
