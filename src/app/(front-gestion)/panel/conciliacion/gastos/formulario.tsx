'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { crearGasto, type EstadoGasto } from './actions'
import { CATEGORIAS_GASTO, ETIQUETAS_CATEGORIA_GASTO } from '@/lib/domain/gastos'
import { hoyISO } from '@/lib/fechas'
import {
  CAMPO,
  Campo,
  ExitoConPasos,
  Mensaje,
  PieDeFormulario,
  botonClases,
} from '../../_components/ui'

const ESTADO_INICIAL: EstadoGasto = {}

export function FormularioGasto() {
  const [estado, accion, pendiente] = useActionState(crearGasto, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
      <Campo etiqueta="Categoría" requerido>
        <select name="categoria" required defaultValue="" className={CAMPO}>
          <option value="" disabled>
            Elegí una categoría
          </option>
          {CATEGORIAS_GASTO.map((c) => (
            <option key={c} value={c}>
              {ETIQUETAS_CATEGORIA_GASTO[c]}
            </option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="Fecha" requerido>
        <input type="date" name="fecha" required defaultValue={hoyISO()} className={CAMPO} />
      </Campo>

      <Campo etiqueta="Descripción" requerido anchoCompleto>
        <input
          name="descripcion"
          required
          className={CAMPO}
          placeholder="Sueldo de septiembre, factura de luz, arreglo de la bomba de agua…"
        />
      </Campo>

      <Campo etiqueta="Monto (USD)" requerido>
        <input name="monto" type="number" min={0.01} step="0.01" required className={CAMPO} />
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
              { href: '/panel/conciliacion/gastos/nuevo', texto: 'Registrar otro' },
              { href: '/panel/conciliacion/gastos', texto: 'Volver al listado' },
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
          {pendiente ? 'Guardando…' : 'Registrar gasto'}
        </button>
        <Link href="/panel/conciliacion/gastos" className={botonClases('secundario', 'w-full sm:w-auto')}>
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
