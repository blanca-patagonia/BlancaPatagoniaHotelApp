'use client'

import { useActionState } from 'react'
import { crearContrato, type EstadoContratoForm } from './actions'

const ESTADO_INICIAL: EstadoContratoForm = {}

const CAMPO = 'rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600'

export interface OpcionEntidad {
  /** Valor combinado `tipo:id` (ver `crearContrato`). */
  valor: string
  nombre: string
}

interface Props {
  agencias: OpcionEntidad[]
  proveedores: OpcionEntidad[]
  empleados: OpcionEntidad[]
}

export function FormularioContrato({ agencias, proveedores, empleados }: Props) {
  const [estado, accion, pendiente] = useActionState(crearContrato, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      <input name="titulo" placeholder="Título del contrato" required className={CAMPO} />

      {/* Un único selector con el tipo codificado en el valor: así el formulario
          funciona sin JavaScript, sin selects encadenados. */}
      <select name="entidad" required defaultValue="" className={CAMPO}>
        <option value="" disabled>
          ¿Con quién se firma?
        </option>
        <optgroup label="Agencias">
          {agencias.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.nombre}
            </option>
          ))}
        </optgroup>
        <optgroup label="Proveedores">
          {proveedores.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.nombre}
            </option>
          ))}
        </optgroup>
        <optgroup label="Empleados">
          {empleados.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.nombre}
            </option>
          ))}
        </optgroup>
      </select>

      <label className="flex flex-col gap-1 text-xs text-stone-500">
        Vigencia desde
        <input name="vigencia_desde" type="date" className={CAMPO} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-stone-500">
        Vigencia hasta
        <input name="vigencia_hasta" type="date" className={CAMPO} />
      </label>

      <textarea
        name="contenido"
        rows={6}
        required
        placeholder="Texto del contrato. Es lo que va a leer y aceptar la otra parte."
        className={`${CAMPO} sm:col-span-2`}
      />

      {estado.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 sm:col-span-2">
          {estado.ok}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="self-start rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800 disabled:opacity-60 sm:col-span-2"
      >
        {pendiente ? 'Creando…' : 'Crear borrador'}
      </button>
    </form>
  )
}
