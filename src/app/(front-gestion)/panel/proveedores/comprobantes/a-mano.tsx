'use client'

import { useActionState } from 'react'
import { cargarComprobanteAMano, type EstadoComprobante } from './actions'
import { CAMPO, Campo, Mensaje, botonClases } from '../../_components/ui'
import { TIPOS_COMPROBANTE_ARCA } from '@/lib/domain/comprobante-qr'

const ESTADO_INICIAL: EstadoComprobante = {}

/**
 * Carga manual de un comprobante.
 *
 * Es la salida para lo que el QR no cubre: una factura anterior a 2021, un papel
 * arrugado cuyo código no se deja leer, o un navegador sin `BarcodeDetector`.
 *
 * Se guarda con `origen_dato = 'manual'`, y esa distinción se muestra en la lista:
 * un número tipeado puede estar mal y uno leído del QR no. Quien revise el cierre
 * del mes tiene que poder saber cuál es cuál sin preguntarle a nadie.
 */
export function CargarAMano({
  proveedores,
  monedas,
}: {
  proveedores: readonly { id: string; nombre: string }[]
  monedas: readonly string[]
}) {
  const [estado, accion, pendiente] = useActionState(cargarComprobanteAMano, ESTADO_INICIAL)
  const v = estado.valores ?? {}

  const tipos = Object.entries(TIPOS_COMPROBANTE_ARCA)

  return (
    <form action={accion} className="grid gap-3 p-5 sm:grid-cols-3">
      <Campo etiqueta="CUIT del emisor" requerido>
        <input
          name="cuit_emisor" defaultValue={v.cuit_emisor ?? ''}
          required
          inputMode="numeric"
          placeholder="30712345678"
          className={CAMPO}
        />
      </Campo>

      <Campo etiqueta="Tipo" requerido>
        <select
          name="tipo_codigo"
          key={`tipo_codigo-${v.tipo_codigo ?? '1'}`}
          defaultValue={v.tipo_codigo ?? '1'}
          className={CAMPO}
        >
          {tipos.map(([codigo, t]) => (
            <option key={codigo} value={codigo}>
              {t.nombre}
            </option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="Razón social">
        <input name="razon_social" defaultValue={v.razon_social ?? ''} maxLength={120} className={CAMPO} />
      </Campo>

      <Campo etiqueta="Punto de venta" requerido>
        <input
          name="punto_venta"
          type="number"
          min="0"
          required
          defaultValue={v.punto_venta ?? 1}
          className={CAMPO}
        />
      </Campo>

      <Campo etiqueta="Número" requerido>
        <input name="numero" defaultValue={v.numero ?? ''} type="number" min="1" required className={CAMPO} />
      </Campo>

      <Campo etiqueta="Fecha" requerido>
        <input name="fecha" defaultValue={v.fecha ?? ''} type="date" required className={CAMPO} />
      </Campo>

      <Campo etiqueta="Moneda">
        <select
          name="moneda"
          key={`moneda-${v.moneda ?? 'ARS'}`}
          defaultValue={v.moneda ?? 'ARS'}
          className={CAMPO}
        >
          {monedas.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="Total" requerido>
        <input name="total" defaultValue={v.total ?? ''} type="number" step="0.01" min="0" required className={CAMPO} />
      </Campo>

      <Campo etiqueta="CAE" requerido ayuda="Los 14 dígitos que figuran al pie del comprobante.">
        <input name="cae" defaultValue={v.cae ?? ''} required maxLength={20} className={CAMPO} />
      </Campo>

      <div className="sm:col-span-2">
        <Campo etiqueta="Proveedor" ayuda="Opcional: se puede vincular después.">
          <select
          name="proveedor_id"
          key={`proveedor_id-${v.proveedor_id ?? ''}`}
          defaultValue={v.proveedor_id ?? ''}
          className={CAMPO}
        >
            <option value="">Sin vincular</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <div className="sm:col-span-3">
        {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
        {estado.ok && (
          <Mensaje tono="ok">
            {estado.ok} {estado.resumen}
          </Mensaje>
        )}
        <button
          type="submit"
          disabled={pendiente}
          className={botonClases('secundario', 'w-full disabled:cursor-wait sm:w-auto')}
        >
          {pendiente ? 'Guardando…' : 'Cargar a mano'}
        </button>
      </div>
    </form>
  )
}
