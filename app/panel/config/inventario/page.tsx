import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { llevaStock, faltantes as articulosFaltantes } from '@/lib/domain/inventario'
import { CATEGORIAS_PRODUCTO, ETIQUETAS_CATEGORIA_PRODUCTO } from '@/lib/domain/consumos'
import { registrarFalla } from '@/lib/acciones'
import { crearProducto } from '../actions'
import { FilaProducto } from '../fila-producto'
import {
  CAMPO,
  Campo,
  Encabezado,
  EstadoVacio,
  Kpi,
  Mensaje,
  TH,
  Tabla,
  Tarjeta,
  Pagina,
} from '../../_components/ui'
import { Icono } from '../../_components/iconos'
import { BotonEnvio } from '../../_components/boton-envio'

interface ProductoStock {
  id: string
  nombre: string
  categoria: string
  precio: number | string
  stock: number | null
  stock_minimo: number | null
  activo: boolean
}

const MENSAJES_ERROR: Record<string, string> = {
  producto: 'Revisá el nombre y el precio del producto.',
  producto_estado: 'No se pudo activar ni desactivar el producto. Quedó como estaba.',
  stock: 'No se pudo registrar la reposición. El stock quedó con el valor anterior.',
}

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const supabase = await crearClienteServidor()

  const { data: productosData, error: eProductos } = await supabase
    .from('productos_servicios')
    .select('id, nombre, categoria, precio, stock, stock_minimo, activo')
    .order('categoria')
    .order('nombre')
  // Un catálogo vacío por lectura fallida se ve igual que "no hay faltantes":
  // el peor caso posible es no reponer algo que sí está por agotarse.
  if (eProductos) registrarFalla(eProductos, 'config:inventario')

  const inventario = (productosData ?? []) as ProductoStock[]
  const conStock = inventario.filter(llevaStock)
  const bajos = articulosFaltantes(inventario)

  return (
    <Pagina>
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Inventario"
        descripcion="Stock de frigobar y amenities; se descuenta solo al cargar un consumo."
        icono="config"
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}</Mensaje>}
      {sp.ok === 'producto' && <Mensaje tono="ok">Producto agregado al catálogo.</Mensaje>}
      {eProductos && (
        <Mensaje tono="error">
          No se pudo leer el inventario completo — puede haber artículos con stock bajo que no se
          ven acá. Revisá antes de dar por hecho que no falta nada.
        </Mensaje>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-2">
        <Kpi titulo="Productos" valor={String(conStock.length)} detalle="con control de stock" icono="objetos" />
        <Kpi
          titulo="Stock bajo"
          valor={String(bajos.length)}
          detalle="requieren reposición"
          icono="alerta"
          tono={bajos.length > 0 ? 'peligro' : 'exito'}
        />
      </div>

      <Tarjeta className="overflow-hidden">
        {inventario.length === 0 ? (
          <EstadoVacio titulo="Sin productos con control de stock" icono="objetos" />
        ) : (
          <Tabla resumen="Productos con su stock actual, mínimo y reposición">
            <thead>
              <tr>
                <th className={TH}>Producto</th>
                <th className={TH}>Categoría</th>
                <th className={`${TH} text-right`}>Precio</th>
                <th className={`${TH} text-right`}>Stock</th>
                <th className={TH}>Estado</th>
                {puedeEditar && <th className={TH}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {inventario.map((p) => (
                <FilaProducto key={p.id} producto={p} puedeEditar={puedeEditar} />
              ))}
            </tbody>
          </Tabla>
        )}

        {puedeEditar && (
          <form
            action={crearProducto}
            className="grid gap-x-4 gap-y-4 border-t border-stone-100 p-5 sm:grid-cols-6"
          >
            <div className="sm:col-span-3">
              <Campo etiqueta="Nombre del producto" requerido>
                <input name="nombre" required className={CAMPO} />
              </Campo>
            </div>
            <div className="sm:col-span-3">
              <Campo etiqueta="Categoría">
                <select name="categoria" defaultValue="frigobar" className={CAMPO}>
                  {CATEGORIAS_PRODUCTO.map((c) => (
                    <option key={c} value={c}>
                      {ETIQUETAS_CATEGORIA_PRODUCTO[c]}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <div className="sm:col-span-2">
              <Campo etiqueta="Precio (USD)" requerido>
                <input
                  name="precio"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  className={`tabular ${CAMPO}`}
                />
              </Campo>
            </div>
            <div className="sm:col-span-2">
              <Campo etiqueta="Stock inicial">
                <input
                  name="stock"
                  type="number"
                  min="0"
                  defaultValue={0}
                  className={`tabular ${CAMPO}`}
                />
              </Campo>
            </div>
            <div className="sm:col-span-2">
              <Campo
                etiqueta="Stock mínimo"
                ayuda="Por debajo de esto, el tablero avisa que hay que reponer."
              >
                <input
                  name="stock_minimo"
                  type="number"
                  min="0"
                  defaultValue={0}
                  className={`tabular ${CAMPO}`}
                />
              </Campo>
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-700 sm:col-span-6">
              <input
                type="checkbox"
                name="controla_stock"
                value="1"
                defaultChecked
                className="size-4 accent-lago-600"
              />
              Lleva control de stock
              <span className="text-stone-500">(desmarcá si es un servicio)</span>
            </label>
            <div className="sm:col-span-6">
              <BotonEnvio variante="secundario" cargando="Agregando…">
                <Icono nombre="mas" tam={16} />
                Agregar al catálogo
              </BotonEnvio>
            </div>
          </form>
        )}
      </Tarjeta>
    </Pagina>
  )
}
