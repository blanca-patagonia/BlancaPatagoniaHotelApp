'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { crearContrato, type EstadoContratoForm } from './actions'
import {
  CAMPO,
  Campo,
  ExitoConPasos,
  Mensaje,
  PieDeFormulario,
  botonClases,
} from '../_components/ui'

const ESTADO_INICIAL: EstadoContratoForm = {}

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

/**
 * Redacción de un contrato. Nace como **borrador**: recién cuando se lo envía a
 * firmar se congela el texto y se calcula su hash, así que acá todavía se puede
 * escribir con tranquilidad (ADR 0010).
 */
export function FormularioContrato({ agencias, proveedores, empleados }: Props) {
  const [estado, accion, pendiente] = useActionState(crearContrato, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
      <Campo etiqueta="Título del contrato" requerido>
        <input name="titulo" required className={CAMPO} placeholder="Convenio de tarifas 2026" />
      </Campo>

      {/* Un único selector con el tipo codificado en el valor: así el formulario
          funciona sin JavaScript, sin selects encadenados. */}
      <Campo etiqueta="¿Con quién se firma?" requerido>
        <select name="entidad" required defaultValue="" className={CAMPO}>
          <option value="" disabled>
            Elegí la contraparte…
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
      </Campo>

      <Campo etiqueta="Vigencia desde">
        <input name="vigencia_desde" type="date" className={CAMPO} />
      </Campo>
      <Campo etiqueta="Vigencia hasta" ayuda="Dejalo vacío si no tiene fecha de fin.">
        <input name="vigencia_hasta" type="date" className={CAMPO} />
      </Campo>

      <Campo
        etiqueta="Texto del contrato"
        requerido
        ayuda="Es lo que va a leer y aceptar la otra parte. Se guarda como borrador: podés seguir editándolo hasta enviarlo a firmar."
        anchoCompleto
      >
        <textarea name="contenido" rows={10} required className={CAMPO} />
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
              ...(estado.id ? [{ href: `/panel/contratos/${estado.id}`, texto: 'Abrir el borrador' }] : []),
              { href: '/panel/contratos/nuevo', texto: 'Redactar otro' },
              { href: '/panel/contratos', texto: 'Volver al listado' },
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
          {pendiente ? 'Guardando…' : 'Guardar borrador'}
        </button>
        <Link href="/panel/contratos" className={botonClases('secundario', 'w-full sm:w-auto')}>
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
