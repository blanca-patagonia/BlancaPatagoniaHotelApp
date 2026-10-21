'use client'

import { useActionState } from 'react'
import { conectarBotTelegram, probar, type EstadoPrueba } from './actions'
import { botonClases } from '../../_components/ui'

function Resultado({ estado }: { estado: EstadoPrueba }) {
  if (!estado.resultado) return null
  return (
    <p
      role="status"
      className={`mt-2 rounded-lg px-3 py-2 text-sm ring-1 ${
        estado.resultado.ok ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-red-50 text-red-800 ring-red-200'
      }`}
    >
      {estado.resultado.ok ? '✓ ' : '✗ '}
      {estado.resultado.detalle}
    </p>
  )
}

/** «Probar la conexión»: una consulta de sólo lectura al proveedor. */
export function BotonProbar({ id }: { id: string }) {
  const [estado, accion, probando] = useActionState<EstadoPrueba, FormData>(probar, {})
  return (
    <form action={accion}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={probando} className={botonClases('secundario', 'w-full sm:w-auto')}>
        {probando ? 'Probando…' : 'Probar la conexión'}
      </button>
      <Resultado estado={estado} />
    </form>
  )
}

/** Registra el webhook del bot en Telegram. */
export function BotonConectarTelegram() {
  const [estado, accion, conectando] = useActionState<EstadoPrueba, FormData>(conectarBotTelegram, {})
  return (
    <form action={accion}>
      <button type="submit" disabled={conectando} className={botonClases('primario', 'w-full sm:w-auto')}>
        {conectando ? 'Conectando…' : 'Conectar el bot'}
      </button>
      <Resultado estado={estado} />
    </form>
  )
}
