'use client'

import { useActionState } from 'react'
import {
  CONDICIONES_IVA,
  ETIQUETAS_CONDICION_IVA,
  type CondicionIva,
} from '@/lib/domain/facturacion'
import { crearHuesped, actualizarHuesped, type EstadoHuesped } from './actions'

const ESTADO_INICIAL: EstadoHuesped = {}
const CAMPO =
  'rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600'

const DOCS = ['DNI', 'Pasaporte', 'CUIT', 'CUIL', 'LC', 'LE']

export interface DatosHuesped {
  id?: string
  apellido?: string
  nombre?: string
  doc_tipo?: string
  doc_numero?: string
  email?: string | null
  telefono?: string | null
  nacionalidad?: string | null
  condicion_iva?: CondicionIva
  notas?: string
}

/**
 * Formulario de huésped, para alta y edición.
 *
 * La condición frente al IVA no es un dato administrativo más: define la letra
 * del comprobante que se emite al facturar (ver ADR 0012), por eso se pide acá
 * y no en el momento de facturar, cuando ya sería tarde.
 */
export function FormularioHuesped({ huesped }: { huesped?: DatosHuesped }) {
  const esEdicion = Boolean(huesped?.id)
  const [estado, accion, pendiente] = useActionState(
    esEdicion ? actualizarHuesped : crearHuesped,
    ESTADO_INICIAL,
  )

  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      {esEdicion && <input type="hidden" name="huesped_id" value={huesped!.id} />}

      <input
        name="apellido"
        required
        placeholder="Apellido"
        defaultValue={huesped?.apellido ?? ''}
        className={CAMPO}
      />
      <input
        name="nombre"
        required
        placeholder="Nombre"
        defaultValue={huesped?.nombre ?? ''}
        className={CAMPO}
      />

      <label className="flex flex-col gap-1 text-xs text-stone-500">
        Tipo de documento
        <select name="doc_tipo" defaultValue={huesped?.doc_tipo ?? 'DNI'} className={CAMPO}>
          {DOCS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-stone-500">
        Número de documento
        <input name="doc_numero" defaultValue={huesped?.doc_numero ?? ''} className={CAMPO} />
      </label>

      <input
        name="email"
        type="email"
        placeholder="Email"
        defaultValue={huesped?.email ?? ''}
        className={CAMPO}
      />
      <input
        name="telefono"
        placeholder="Teléfono"
        defaultValue={huesped?.telefono ?? ''}
        className={CAMPO}
      />
      <input
        name="nacionalidad"
        placeholder="Nacionalidad"
        defaultValue={huesped?.nacionalidad ?? ''}
        className={CAMPO}
      />

      <label className="flex flex-col gap-1 text-xs text-stone-500">
        Condición frente al IVA
        <select
          name="condicion_iva"
          defaultValue={huesped?.condicion_iva ?? 'consumidor_final'}
          className={CAMPO}
        >
          {CONDICIONES_IVA.map((c) => (
            <option key={c} value={c}>
              {ETIQUETAS_CONDICION_IVA[c]}
            </option>
          ))}
        </select>
      </label>

      <textarea
        name="notas"
        rows={2}
        placeholder="Notas internas (preferencias, alergias, observaciones)"
        defaultValue={huesped?.notas ?? ''}
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
        {pendiente ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear huésped'}
      </button>
    </form>
  )
}
