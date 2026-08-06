'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { crearProveedor, type EstadoProveedor } from './actions'
import {
  CAMPO,
  Campo,
  ExitoConPasos,
  Mensaje,
  PieDeFormulario,
  botonClases,
} from '../_components/ui'

const ESTADO_INICIAL: EstadoProveedor = {}

/** Alta de proveedor: quien nos factura a nosotros (cuentas por pagar). */
export function FormularioProveedor() {
  const [estado, accion, pendiente] = useActionState(crearProveedor, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
      <Campo etiqueta="Nombre" requerido>
        <input name="nombre" required className={CAMPO} />
      </Campo>

      <Campo etiqueta="Rubro" ayuda="Con qué nos provee. Sirve para agrupar los gastos.">
        <input name="rubro" className={CAMPO} placeholder="Lavandería, mantenimiento, insumos…" />
      </Campo>

      <Campo etiqueta="CUIT">
        <input name="cuit" className={CAMPO} placeholder="30-71234567-1" />
      </Campo>

      <Campo etiqueta="Email">
        <input name="email" type="email" className={CAMPO} />
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
                ? [{ href: `/panel/proveedores/${estado.id}`, texto: 'Ver su cuenta' }]
                : []),
              { href: '/panel/proveedores/nuevo', texto: 'Registrar otro' },
              { href: '/panel/proveedores', texto: 'Volver al listado' },
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
          {pendiente ? 'Guardando…' : 'Registrar proveedor'}
        </button>
        <Link href="/panel/proveedores" className={botonClases('secundario', 'w-full sm:w-auto')}>
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
