'use client'

import { useActionState, useMemo, useState } from 'react'
import { cerrarComanda, type EstadoComanda } from './actions'
import { filtrarCatalogo, subtotalLinea } from '@/lib/domain/punto-venta'
import { ETIQUETAS_FOLIO, FOLIOS, type Folio } from '@/lib/domain/folios'
import { ETIQUETAS_CATEGORIA_PRODUCTO, type CategoriaProducto } from '@/lib/domain/consumos'
import { CAMPO, Campo, Mensaje, Tabla, botonClases } from '../_components/ui'
import { formatearUSD } from '@/lib/domain/moneda'

export interface ProductoPos {
  id: string
  codigo: string
  nombre: string
  categoria: CategoriaProducto
  precio: number
  stock: number | null
}

export interface ReservaPos {
  id: string
  codigo: string
  huesped: string
  unidad: string
}

const ESTADO_INICIAL: EstadoComanda = {}

/**
 * Grilla del punto de venta.
 *
 * ── Por qué una grilla y no un `<select>` ───────────────────────────────────
 *
 * Cerrar un frigobar es contar cinco cosas de un vistazo y escribir cinco números.
 * Con un `<select>` eso son cinco ciclos de elegir-cantidad-guardar, y las cinco
 * líneas quedan sueltas. La grilla muestra el catálogo entero con un campo de
 * cantidad al lado, se cargan los números que hagan falta y se cierra una vez.
 *
 * ── Decisiones de interfaz ──────────────────────────────────────────────────
 *
 * · **El total se calcula mientras se escribe.** Quien cobra necesita ver el
 *   número antes de decirlo en voz alta, no después de guardar.
 * · **Los precios NO viajan al servidor.** La acción los lee del catálogo. Acá se
 *   muestran para poder sumar en pantalla; si alguien edita el HTML, el importe que
 *   se cobra no cambia.
 * · **El buscador filtra sin acentos.** Nadie escribe «café» cuando busca rápido.
 * · **Sólo se envían las líneas con cantidad.** El resto del catálogo no viaja.
 */
export function GrillaPos({
  productos,
  reservas,
}: {
  productos: ProductoPos[]
  reservas: ReservaPos[]
}) {
  const [estado, accion, pendiente] = useActionState(cerrarComanda, ESTADO_INICIAL)

  const [folio, setFolio] = useState<Folio>('A')
  const [busqueda, setBusqueda] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, number>>({})

  const visibles = useMemo(() => filtrarCatalogo(productos, busqueda), [productos, busqueda])

  const lineas = useMemo(
    () =>
      productos
        .filter((p) => (cantidades[p.id] ?? 0) > 0)
        .map((p) => ({
          ...p,
          cantidad: cantidades[p.id],
          subtotal: subtotalLinea({ cantidad: cantidades[p.id], precioUnitario: p.precio }),
        })),
    [productos, cantidades],
  )

  const total = lineas.reduce((acc, l) => acc + l.subtotal, 0)

  /** Agrupado por categoría: es el «departamento» de la grilla de WinPAX. */
  const porCategoria = useMemo(() => {
    const mapa = new Map<CategoriaProducto, ProductoPos[]>()
    for (const p of visibles) {
      const lista = mapa.get(p.categoria) ?? []
      lista.push(p)
      mapa.set(p.categoria, lista)
    }
    return [...mapa.entries()]
  }, [visibles])

  function cambiar(id: string, valor: string) {
    const n = Number(valor)
    setCantidades((prev) => ({ ...prev, [id]: Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0 }))
  }

  return (
    <form action={accion} className="flex flex-col gap-4">
      {/* Sólo viajan las líneas con cantidad. */}
      {lineas.map((l) => (
        <div key={l.id}>
          <input type="hidden" name="producto_id" value={l.id} />
          <input type="hidden" name={`cantidad_${l.id}`} value={l.cantidad} />
        </div>
      ))}

      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-3">
        <Campo etiqueta="Habitación / reserva" requerido>
          <select name="reserva_id" required defaultValue="" className={CAMPO}>
            <option value="" disabled>
              Elegí a quién se le carga
            </option>
            {reservas.map((r) => (
              <option key={r.id} value={r.id}>
                {r.unidad} — {r.huesped} ({r.codigo})
              </option>
            ))}
          </select>
        </Campo>

        {/* Folio, no «punto de venta». El departamento de cada línea sale del
            producto y se copia solo; lo que hay que preguntar es a quién se le
            cobra. Antes todo iba al folio A y había que moverlo después desde la
            cuenta, que para el caso inverso al típico —la empresa paga los
            consumos— eran dos pasos por comanda. */}
        <Campo etiqueta="Cobrar al folio" ayuda="El departamento lo pone cada producto.">
          <select
            name="folio"
            value={folio}
            onChange={(e) => setFolio(e.target.value as Folio)}
            className={CAMPO}
          >
            {FOLIOS.map((f) => (
              <option key={f} value={f}>
                {ETIQUETAS_FOLIO[f]}
              </option>
            ))}
          </select>
        </Campo>

        <Campo etiqueta="Buscar producto" ayuda="Por nombre o código. No hace falta poner acentos.">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="cerveza, agua, FRI-…"
            className={CAMPO}
          />
        </Campo>
      </div>

      {/* ── La grilla ────────────────────────────────────────────────────────── */}
      {porCategoria.length === 0 ? (
        <p className="rounded-xl border border-stone-200 bg-white px-5 py-8 text-center text-sm text-stone-600">
          Ningún producto coincide con «{busqueda}».
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {porCategoria.map(([categoria, items]) => (
            <div key={categoria} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              <h3 className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-xs font-semibold tracking-wide text-stone-600 uppercase">
                {ETIQUETAS_CATEGORIA_PRODUCTO[categoria]}
              </h3>
              {/*
                El scroll horizontal va acá adentro, envolviendo solo la tabla.

                El `overflow-hidden` del div de arriba no se saca: recorta las esquinas
                redondeadas contra el encabezado gris de la categoría. Pero recortar era
                todo lo que hacía, y sin un scrollport propio la tabla quedaba cortada:
                en un teléfono la fila suma nombre + precio + el input de cantidad +
                subtotal, se pasa del ancho útil, y las dos últimas columnas —cantidad y
                subtotal, o sea la comanda entera— desaparecían sin forma de alcanzarlas.
              */}
              <Tabla
                resumen={`Productos de ${ETIQUETAS_CATEGORIA_PRODUCTO[categoria]} con su precio y la cantidad a cargar`}
              >
                <thead className="sr-only">
                  <tr>
                    <th>Producto</th>
                    <th>Precio</th>
                    <th>Cantidad</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => {
                    const cantidad = cantidades[p.id] ?? 0
                    const sinStock = p.stock != null && p.stock <= 0
                    const excede = p.stock != null && cantidad > p.stock

                    return (
                      <tr
                        key={p.id}
                        className={`border-t border-stone-100 ${cantidad > 0 ? 'bg-lago-50/50' : ''}`}
                      >
                        <td className="px-4 py-2">
                          <label htmlFor={`cant-${p.id}`} className="font-medium text-stone-800">
                            {p.nombre}
                          </label>
                          <span className="block text-xs text-stone-500">
                            {p.codigo}
                            {/* El stock se dice con número, no con un color: quien
                                cobra necesita saber cuántos quedan. */}
                            {p.stock != null && (
                              <span className={sinStock ? 'ml-2 font-medium text-red-700' : 'ml-2'}>
                                {sinStock ? 'sin stock' : `stock ${p.stock}`}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="tabular px-2 py-2 text-right whitespace-nowrap text-stone-600">
                          {formatearUSD(p.precio)}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            id={`cant-${p.id}`}
                            type="number"
                            min={0}
                            max={p.stock ?? 99}
                            value={cantidad || ''}
                            onChange={(e) => cambiar(p.id, e.target.value)}
                            disabled={sinStock}
                            aria-label={`Cantidad de ${p.nombre}`}
                            aria-invalid={excede || undefined}
                            className={`w-16 rounded-md border px-2 py-1.5 text-center text-sm ${
                              excede ? 'border-red-400 bg-red-50' : 'border-stone-300'
                            } disabled:bg-stone-100`}
                          />
                        </td>
                        <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                          {cantidad > 0 ? (
                            <span className="font-semibold text-stone-900">
                              {formatearUSD(
                                subtotalLinea({ cantidad, precioUnitario: p.precio }),
                              )}
                            </span>
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Tabla>
            </div>
          ))}
        </div>
      )}

      <Campo etiqueta="Nota de la comanda" ayuda="Opcional. Queda en todas las líneas.">
        <input name="nota" placeholder="Recuento del 15/09, sin hielo…" className={CAMPO} />
      </Campo>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
      {estado.ok && <Mensaje tono="ok">{estado.ok}</Mensaje>}

      {/* Resumen pegado abajo: el total tiene que estar visible sin scrollear
          hasta el final de una grilla de veinte productos. */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-300 bg-white px-5 py-3 shadow-lg">
        <div className="text-sm">
          <p className="text-stone-600">
            {lineas.length === 0
              ? 'Ninguna línea cargada'
              : `${lineas.length} línea(s) · ${lineas.reduce((a, l) => a + l.cantidad, 0)} artículo(s)`}
          </p>
          <p className="tabular text-xl leading-tight font-semibold text-stone-900">
            {formatearUSD(total)}
          </p>
        </div>

        <div className="flex gap-2">
          {lineas.length > 0 && (
            <button
              type="button"
              onClick={() => setCantidades({})}
              className={botonClases('fantasma')}
            >
              Vaciar
            </button>
          )}
          <button
            type="submit"
            disabled={pendiente || lineas.length === 0}
            className={botonClases('primario', 'disabled:cursor-not-allowed')}
          >
            {pendiente ? 'Cargando…' : 'Cerrar comanda'}
          </button>
        </div>
      </div>
    </form>
  )
}
