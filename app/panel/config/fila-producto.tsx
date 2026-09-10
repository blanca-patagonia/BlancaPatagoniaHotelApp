'use client'

import { useActionState, useState } from 'react'
import { llevaStock, stockBajo } from '@/lib/domain/inventario'
import { CATEGORIAS_PRODUCTO, ETIQUETAS_CATEGORIA_PRODUCTO } from '@/lib/domain/consumos'
import { importe } from '@/lib/domain/moneda'
import { editarProducto, reponerStock, alternarProducto, type EstadoProducto } from './actions'
import { BotonEnvio } from '../_components/boton-envio'
import { CAMPO, Campo, Etiqueta, FILA, TD, botonClases } from '../_components/ui'

interface ProductoStock {
  id: string
  nombre: string
  categoria: string
  precio: number | string
  stock: number | null
  stock_minimo: number | null
  activo: boolean
}

const ESTADO_INICIAL: EstadoProducto = {}

/**
 * Una fila del inventario, con vista de lectura y edición aparte.
 *
 * Mismo patrón que `FilaTarifario`: un botón «Editar» explícito (no
 * `<details>`), el formulario reemplaza la vista de lectura en el propio
 * `<tr>` en vez de abrir un modal o navegar a otra pantalla, y al guardar
 * bien vuelve sola a la vista de lectura.
 */
export function FilaProducto({
  producto: p,
  puedeEditar,
}: {
  producto: ProductoStock
  puedeEditar: boolean
}) {
  const [editando, setEditando] = useState(false)
  const [estado, accion, pendiente] = useActionState(editarProducto, ESTADO_INICIAL)

  const [estadoPrevio, setEstadoPrevio] = useState(estado)
  if (estado !== estadoPrevio) {
    setEstadoPrevio(estado)
    if (estado.ok) setEditando(false)
  }

  const controla = llevaStock(p)
  const bajo = stockBajo(p)

  if (editando) {
    return (
      <tr className={`${FILA} align-top`}>
        <td colSpan={puedeEditar ? 6 : 5} className={TD}>
          <form action={accion} className="grid gap-x-4 gap-y-3 sm:grid-cols-6">
            <input type="hidden" name="id" value={p.id} />
            <div className="sm:col-span-3">
              <Campo etiqueta="Nombre" requerido>
                <input name="nombre" required defaultValue={p.nombre} className={CAMPO} />
              </Campo>
            </div>
            <div className="sm:col-span-2">
              <Campo etiqueta="Categoría">
                <select name="categoria" defaultValue={p.categoria} className={CAMPO}>
                  {CATEGORIAS_PRODUCTO.map((c) => (
                    <option key={c} value={c}>
                      {ETIQUETAS_CATEGORIA_PRODUCTO[c]}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <div className="sm:col-span-1">
              <Campo etiqueta="Precio (USD)" requerido>
                <input
                  name="precio"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={Number(p.precio)}
                  className={`tabular ${CAMPO}`}
                />
              </Campo>
            </div>
            <div className="flex items-center gap-2 sm:col-span-6">
              <BotonEnvio variante="secundario" cargando="Guardando…">
                Guardar
              </BotonEnvio>
              <button
                type="button"
                onClick={() => setEditando(false)}
                className={botonClases('fantasma')}
              >
                Cancelar
              </button>
              {estado.error && <span className="text-sm text-red-700">{estado.error}</span>}
              {estado.ok && !pendiente && (
                <span className="text-sm text-emerald-700">✓ {estado.ok}</span>
              )}
            </div>
          </form>
        </td>
      </tr>
    )
  }

  return (
    <tr className={`${FILA} ${p.activo ? '' : 'opacity-50'}`}>
      <td className={`${TD} font-medium text-stone-800`}>{p.nombre}</td>
      <td className={`${TD} text-stone-500 capitalize`}>{p.categoria}</td>
      <td className={`${TD} tabular text-right text-stone-700`}>{importe(Number(p.precio))}</td>
      <td className={`${TD} tabular text-right`}>
        {controla ? (
          <>
            <span className={bajo ? 'font-semibold text-red-600' : 'text-stone-800'}>
              {p.stock}
            </span>
            <span className="ml-1 text-xs text-stone-600">/ mín. {p.stock_minimo ?? 0}</span>
            {bajo && (
              <span className="ml-2">
                <Etiqueta tono="peligro">bajo</Etiqueta>
              </span>
            )}
          </>
        ) : (
          <span className="text-stone-600">servicio</span>
        )}
      </td>
      <td className={TD}>
        {p.activo ? (
          <Etiqueta tono="exito">Activo</Etiqueta>
        ) : (
          <Etiqueta tono="neutro">Inactivo</Etiqueta>
        )}
      </td>
      {puedeEditar && (
        <td className={TD}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditando(true)}
              className={botonClases('secundario', 'px-2 py-1 text-xs')}
            >
              Editar
            </button>
            {controla && (
              <form action={reponerStock} className="flex items-center gap-1">
                <input type="hidden" name="producto_id" value={p.id} />
                <input
                  name="cantidad"
                  type="number"
                  min="1"
                  defaultValue={12}
                  aria-label={`Unidades a reponer de ${p.nombre}`}
                  className="tabular w-16 rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                />
                <button className={botonClases('secundario', 'px-2 py-1 text-xs')}>
                  + Reponer
                </button>
              </form>
            )}
            {/* Se desactiva en lugar de borrar: los consumos ya cargados
                siguen apuntando al producto. */}
            <form action={alternarProducto}>
              <input type="hidden" name="producto_id" value={p.id} />
              <input type="hidden" name="activo" value={String(p.activo)} />
              <button className={botonClases('secundario', 'px-2 py-1 text-xs')}>
                {p.activo ? 'Desactivar' : 'Activar'}
              </button>
            </form>
          </div>
        </td>
      )}
    </tr>
  )
}
