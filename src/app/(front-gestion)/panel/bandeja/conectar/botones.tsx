'use client'

import { useActionState } from 'react'
import { conectarCanal, crearWebhookCorreo, verificarCanal, type EstadoConexion } from './actions'
import { CopiarTexto } from './copiar'
import { botonClases } from '../../_components/ui'

/** La lista de pasos que devolvió el proveedor: ✓ salió, ✗ falló, · no se pudo saber. */
export function ListaDePasos({ estado }: { estado: EstadoConexion }) {
  if (!estado.pasos && !estado.error) return null
  return (
    <div role="status" className="mt-3 space-y-1.5 rounded-xl bg-stone-50 p-3 text-sm ring-1 ring-stone-200">
      {estado.error && <p className="font-medium text-red-800">✗ {estado.error}</p>}
      {estado.pasos?.map((p) => (
        <p key={p.titulo} className="flex gap-2">
          <span className={p.ok === true ? 'text-emerald-700' : p.ok === false ? 'text-red-700' : 'text-stone-500'} aria-hidden="true">
            {p.ok === true ? '✓' : p.ok === false ? '✗' : '·'}
          </span>
          <span>
            <span className="font-medium text-stone-800">{p.titulo}.</span> <span className="text-stone-600">{p.detalle}</span>
            <span className="sr-only">{p.ok === true ? ' Salió bien.' : p.ok === false ? ' Falló.' : ' No se pudo saber.'}</span>
          </span>
        </p>
      ))}
    </div>
  )
}

export function BotonConectar({ canal, texto = 'Conectar' }: { canal: string; texto?: string }) {
  const [estado, accion, trabajando] = useActionState<EstadoConexion, FormData>(conectarCanal, {})
  return (
    <form action={accion}>
      <input type="hidden" name="canal" value={canal} />
      <button type="submit" disabled={trabajando} className={botonClases('primario', 'w-full sm:w-auto')}>
        {trabajando ? 'Conectando…' : texto}
      </button>
      <ListaDePasos estado={estado} />
    </form>
  )
}

export function BotonVerificar({ canal }: { canal: string }) {
  const [estado, accion, trabajando] = useActionState<EstadoConexion, FormData>(verificarCanal, {})
  return (
    <form action={accion}>
      <input type="hidden" name="canal" value={canal} />
      <button type="submit" disabled={trabajando} className={botonClases('secundario', 'w-full sm:w-auto')}>
        {trabajando ? 'Verificando…' : 'Verificar que funciona'}
      </button>
      <ListaDePasos estado={estado} />
    </form>
  )
}

/** Crea el webhook de correo en Resend y muestra el secreto UNA vez. */
export function BotonWebhookCorreo() {
  const [estado, accion, trabajando] = useActionState<EstadoConexion, FormData>(crearWebhookCorreo, {})
  return (
    <form action={accion}>
      <button type="submit" disabled={trabajando} className={botonClases('primario', 'w-full sm:w-auto')}>
        {trabajando ? 'Creando…' : 'Crear el webhook en Resend'}
      </button>
      <ListaDePasos estado={estado} />
      {estado.secreto && (
        <div className="mt-3 space-y-1.5 rounded-xl bg-lenga-50 p-3 text-sm ring-1 ring-lenga-200">
          <p className="font-medium text-lenga-900">Guardá este secreto ahora: no se vuelve a mostrar.</p>
          <CopiarTexto texto={`RESEND_WEBHOOK_SECRET=${estado.secreto}`} />
          <p className="text-xs text-lenga-900">
            Pegalo en <code>.env.local</code> (o en Vercel) y reiniciá. Hasta entonces el sistema rechaza los avisos de Resend.
          </p>
        </div>
      )}
    </form>
  )
}
