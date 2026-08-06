'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { crearAgencia, type EstadoAgencia } from './actions'
import { TIPOS_CUENTA, ETIQUETAS_TIPO_CUENTA } from '@/lib/domain/cuentas'
import {
  CAMPO,
  Campo,
  ExitoConPasos,
  Mensaje,
  PieDeFormulario,
  botonClases,
} from '../_components/ui'

const ESTADO_INICIAL: EstadoAgencia = {}

/**
 * Alta de una cuenta corriente: agencia de viajes o empresa con convenio.
 *
 * El descuento no es cosmético: define la **tarifa neta** que se le aplica a
 * cada reserva vendida por esa cuenta (ADR 0004), así que el campo lo explica
 * en lugar de pedir un número a secas.
 */
export function FormularioAgencia() {
  const [estado, accion, pendiente] = useActionState(crearAgencia, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
      <Campo etiqueta="Nombre" requerido>
        <input name="nombre" required className={CAMPO} />
      </Campo>

      <Campo etiqueta="Tipo de cuenta">
        <select name="tipo" defaultValue="agencia" className={CAMPO}>
          {TIPOS_CUENTA.map((t) => (
            <option key={t} value={t}>
              {ETIQUETAS_TIPO_CUENTA[t]}
            </option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="CUIT" ayuda="Necesario para facturarle a nombre de la empresa.">
        <input name="cuit" className={CAMPO} placeholder="30-71234567-1" />
      </Campo>

      <Campo etiqueta="Email" ayuda="A esta dirección llegan los contratos a firmar.">
        <input name="email" type="email" className={CAMPO} />
      </Campo>

      <Campo
        etiqueta="Descuento sobre la tarifa"
        ayuda="Porcentaje de descuento del convenio. Las reservas de esta cuenta se cotizan con tarifa neta."
      >
        <div className="flex items-center gap-2">
          <input
            name="descuento_pct"
            type="number"
            min={0}
            max={100}
            step="0.5"
            defaultValue={0}
            className={CAMPO}
          />
          <span className="text-sm text-stone-500">%</span>
        </div>
      </Campo>

      {estado.error && (
        <div className="sm:col-span-2">
          <Mensaje tono="error">{estado.error}</Mensaje>
        </div>
      )}
      {estado.ok && (
        <div className="sm:col-span-2">
          <ExitoConPasos
            mensaje={estado.ok}
            pasos={[
              ...(estado.id
                ? [{ href: `/panel/agencias/${estado.id}`, texto: 'Ver su cuenta' }]
                : []),
              { href: '/panel/agencias/nueva', texto: 'Registrar otra' },
              { href: '/panel/agencias', texto: 'Volver al listado' },
            ]}
          />
        </div>
      )}

      <PieDeFormulario>
        <button
          type="submit"
          disabled={pendiente}
          className={botonClases('primario', 'w-full disabled:cursor-wait sm:w-auto')}
        >
          {pendiente ? 'Guardando…' : 'Registrar cuenta'}
        </button>
        <Link href="/panel/agencias" className={botonClases('secundario', 'w-full sm:w-auto')}>
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
