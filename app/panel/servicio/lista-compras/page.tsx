import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { fechaHotel } from '@/lib/fechas'
import { formatearLocal } from '@/lib/domain/divisas'
import { totalPendiente, totalComprado, cantidadPendiente } from '@/lib/domain/lista-compras'
import {
  Campo,
  CAMPO,
  Encabezado,
  EstadoVacio,
  FILA,
  Kpi,
  Mensaje,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'
import { BotonImprimir } from '../imprimir'
import { agregarItemCompra, editarItemCompra, alternarCompradoItem, eliminarItemCompra } from './actions'

/**
 * Lista de compras de cocina: una hoja de trabajo para ir anotando, día a día,
 * qué hay que comprarle al supermercado para el restaurante, con precio
 * estimado, y se imprime para llevarla en papel.
 *
 * "Una fila, un guardado" (mismo criterio que el tarifario): cada línea está
 * siempre editable, no hay un modo de edición aparte que abrir. Tildar
 * "comprado" es la acción que más se usa, así que tiene su propio botón que
 * guarda solo eso — no hace falta tocar el resto de la fila para marcar que
 * ya se compró.
 */

interface FilaCompra {
  id: string
  nombre: string
  cantidad: string
  precio_estimado: number | string | null
  comprado: boolean
  nota: string
}

const MENSAJES_ERROR: Record<string, string> = {
  lista_compras_nombre: 'El nombre del artículo no puede quedar vacío.',
  lista_compras_guardar: 'No se pudo guardar. Probá de nuevo.',
  lista_compras_eliminar: 'No se pudo eliminar. Probá de nuevo.',
}

export default async function ListaComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  await requerirAcceso('servicio')
  const sp = await searchParams

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('lista_compras_cocina')
    .select('id, nombre, cantidad, precio_estimado, comprado, nota')
    // Pendientes primero, y entre ellos el más viejo primero: lo que lleva más
    // tiempo esperando se ve arriba. Lo ya comprado queda al final, de referencia.
    .order('comprado', { ascending: true })
    .order('creado_en', { ascending: true })
  registrarFalla(error, 'servicio:lista_compras')

  const items: FilaCompra[] = (data ?? []) as FilaCompra[]
  const itemsParaTotales = items.map((i) => ({
    precioEstimado: i.precio_estimado === null ? null : Number(i.precio_estimado),
    comprado: i.comprado,
  }))
  const pendiente = totalPendiente(itemsParaTotales)
  const comprado = totalComprado(itemsParaTotales)
  const faltan = cantidadPendiente(itemsParaTotales)

  return (
    <Pagina>
      <div className="print:hidden">
        <Link
          href="/panel/servicio"
          className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
        >
          ‹ Volver a servicio de cocina
        </Link>

        <Encabezado
          titulo="Lista de compras"
          descripcion="Qué hay que comprarle al supermercado para el restaurante, con precio estimado."
          icono="reportes"
          acciones={<BotonImprimir texto="Imprimir lista" />}
        />
      </div>

      {error && (
        <Mensaje tono="error">
          No se pudo leer la lista completa. Puede estar incompleta — no significa que no haya
          nada cargado.
        </Mensaje>
      )}
      {sp.error && (
        <div className="print:hidden">
          <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}</Mensaje>
        </div>
      )}
      {sp.ok === 'agregado' && (
        <div className="print:hidden">
          <Mensaje tono="ok">Se agregó a la lista.</Mensaje>
        </div>
      )}

      {/* ── Resumen que SÍ se imprime ─────────────────────────────────── */}
      <div className="hidden print:block">
        <h1 className="text-lg font-semibold">Hotel Blanca Patagonia — Lista de compras de cocina</h1>
        <p className="text-sm">Impresa el {fechaHotel(new Date())}</p>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3 print:hidden">
        <Kpi titulo="Falta comprar" valor={String(faltan)} detalle="artículos" icono="objetos" tono="alerta" />
        <Kpi titulo="Estimado pendiente" valor={formatearLocal(pendiente, 'ARS')} icono="divisas" tono="lago" />
        <Kpi titulo="Ya comprado" valor={formatearLocal(comprado, 'ARS')} detalle="esta tanda" icono="ok" />
      </div>

      {/* ── Alta: siempre visible, no hay pantalla aparte para esto ──────── */}
      <Tarjeta titulo="Agregar a la lista" className="mb-5 print:hidden">
        <form action={agregarItemCompra} className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-4">
          <Campo etiqueta="Artículo" requerido anchoCompleto={false}>
            <input name="nombre" required className={CAMPO} placeholder="Harina 0000" />
          </Campo>
          <Campo etiqueta="Cantidad" ayuda="Como se anota en el súper.">
            <input name="cantidad" className={CAMPO} placeholder="2 kg" />
          </Campo>
          <Campo etiqueta="Precio estimado" ayuda="En pesos. Se puede dejar en blanco.">
            <input name="precio_estimado" inputMode="decimal" className={CAMPO} placeholder="1500" />
          </Campo>
          <Campo etiqueta="Nota" ayuda="Marca, dónde conseguirlo, lo que haga falta.">
            <input name="nota" className={CAMPO} placeholder="La marca que usamos siempre" />
          </Campo>
          <div className="sm:col-span-4">
            <BotonEnvio cargando="Agregando…" extra="w-full sm:w-auto">
              Agregar
            </BotonEnvio>
          </div>
        </form>
      </Tarjeta>

      {/* ── Interactiva: no se imprime ────────────────────────────────── */}
      <div className="print:hidden">
        {items.length === 0 ? (
          <EstadoVacio
            titulo="La lista está vacía"
            descripcion="Agregá el primer artículo arriba."
            icono="objetos"
          />
        ) : (
          <Tabla resumen="Lista de compras de cocina, con comprado, cantidad, precio estimado y nota">
            <thead>
              <tr>
                <th className={TH} scope="col">
                  <span className="sr-only">Comprado</span>
                </th>
                <th className={TH} scope="col">Artículo</th>
                <th className={TH} scope="col">Cantidad, precio y nota</th>
                <th className={TH} scope="col">
                  <span className="sr-only">Eliminar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={`${FILA} ${i.comprado ? 'opacity-60' : ''}`}>
                  <td className={TD}>
                    <form action={alternarCompradoItem}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="comprado" value={i.comprado ? '0' : '1'} />
                      <button
                        type="submit"
                        aria-label={
                          i.comprado
                            ? `Marcar «${i.nombre}» como pendiente`
                            : `Marcar «${i.nombre}» como comprado`
                        }
                        aria-pressed={i.comprado}
                        className={`flex size-6 items-center justify-center rounded-md border-2 text-sm font-bold transition ${
                          i.comprado
                            ? 'border-lago-600 bg-lago-600 text-white'
                            : 'border-stone-300 bg-white text-transparent hover:border-lago-400'
                        }`}
                      >
                        ✓
                      </button>
                    </form>
                  </td>
                  <td className={TD}>
                    {/* El input de nombre vive en esta celda pero pertenece al MISMO
                        formulario que cantidad/precio/nota (vía el atributo `form`,
                        HTML estándar): se guardan los cuatro juntos con un solo
                        "Guardar", aunque las celdas no sean contiguas en la fila. */}
                    <input
                      name="nombre"
                      form={`editar-${i.id}`}
                      defaultValue={i.nombre}
                      required
                      className={`${CAMPO} py-1.5 text-sm font-medium ${i.comprado ? 'line-through' : ''}`}
                      aria-label="Artículo"
                    />
                  </td>
                  <td className={TD}>
                    {/* Cantidad, precio y nota se guardan juntos: es la fila spreadsheet-like
                        que se puede editar sin abrir nada aparte. */}
                    <form
                      id={`editar-${i.id}`}
                      action={editarItemCompra}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="id" value={i.id} />
                      <label className="flex flex-col gap-0.5 text-xs text-stone-500">
                        Cantidad
                        <input
                          name="cantidad"
                          defaultValue={i.cantidad}
                          className={`${CAMPO} w-24 py-1.5 text-sm`}
                          aria-label={`Cantidad de ${i.nombre}`}
                        />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs text-stone-500">
                        Precio est. (ARS)
                        <input
                          name="precio_estimado"
                          inputMode="decimal"
                          defaultValue={i.precio_estimado ?? ''}
                          className={`${CAMPO} w-28 py-1.5 text-sm`}
                          aria-label={`Precio estimado de ${i.nombre}`}
                        />
                      </label>
                      <label className="flex min-w-32 flex-1 flex-col gap-0.5 text-xs text-stone-500">
                        Nota
                        <input
                          name="nota"
                          defaultValue={i.nota}
                          className={`${CAMPO} py-1.5 text-sm`}
                          aria-label={`Nota de ${i.nombre}`}
                        />
                      </label>
                      <BotonEnvio variante="secundario" cargando="…" extra="py-1.5">
                        Guardar
                      </BotonEnvio>
                    </form>
                  </td>
                  <td className={TD}>
                    <form action={eliminarItemCompra}>
                      <input type="hidden" name="id" value={i.id} />
                      <BotonEnvio
                        variante="fantasma"
                        cargando="…"
                        confirmar={`¿Eliminar «${i.nombre}» de la lista?`}
                        aria-label={`Eliminar ${i.nombre}`}
                      >
                        Eliminar
                      </BotonEnvio>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </div>

      {/* ── Hoja para llevar al súper: SOLO se ve al imprimir ────────────
          Casilleros en blanco donde el sistema todavía no tiene el artículo
          tildado, para poder marcarlos a mano en el momento de comprar; y ya
          tildados los que se cargaron como comprados antes de imprimir. */}
      {items.length > 0 && (
        <table className="hidden w-full border-collapse text-sm print:table">
          <thead>
            <tr className="border-b-2 border-stone-800">
              <th className="py-1.5 pr-2 text-left">✓</th>
              <th className="py-1.5 pr-2 text-left">Artículo</th>
              <th className="py-1.5 pr-2 text-left">Cantidad</th>
              <th className="py-1.5 pr-2 text-right">Precio est.</th>
              <th className="py-1.5 text-left">Nota</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-stone-300">
                <td className="py-1.5 pr-2 align-top">
                  <span aria-hidden className="inline-block h-4 w-4 border border-stone-800 text-center leading-3">
                    {i.comprado ? '✓' : ''}
                  </span>
                </td>
                <td className="py-1.5 pr-2 align-top">{i.nombre}</td>
                <td className="py-1.5 pr-2 align-top">{i.cantidad}</td>
                <td className="py-1.5 pr-2 text-right align-top tabular-nums">
                  {i.precio_estimado !== null ? formatearLocal(Number(i.precio_estimado), 'ARS') : ''}
                </td>
                <td className="py-1.5 align-top">{i.nota}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="pt-2 text-right font-semibold">
                Total pendiente
              </td>
              <td className="pt-2 text-right font-semibold tabular-nums">
                {formatearLocal(pendiente, 'ARS')}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </Pagina>
  )
}
