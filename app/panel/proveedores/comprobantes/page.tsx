import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { datosFiscales } from '@/lib/facturacion/emisor'
import { construirQuery, paginaActual, rangoDePagina, terminoBusqueda } from '@/lib/listados'
import { formatoFechaCorta } from '@/lib/fechas'
import { importe } from '@/lib/domain/moneda'
import { MONEDAS_EXTRANJERAS } from '@/lib/domain/divisas'
import {
  esNotaDeCredito,
  nombreDeComprobante,
  numeroVisible,
} from '@/lib/domain/comprobante-qr'
import {
  BarraHerramientas,
  Buscador,
  CAMPO,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Mensaje,
  Pagina,
  Paginacion,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  COL_SECUNDARIA,
} from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'
import { EscanearComprobante } from './escanear'
import { CargarAMano } from './a-mano'
import { imputarComprobante } from './actions'

/**
 * Comprobantes recibidos (objetivo 9 del pedido).
 *
 * «Que se le saque una foto a una factura y que se carguen los datos de esa
 *  factura a un excel.»
 *
 * Las dos mitades están acá: se escanea el QR de la factura —que trae los datos
 * que el emisor le informó a ARCA, con su CAE— y se baja el CSV, que Excel abre
 * directo. El botón de exportar va por `/panel/exportar/comprobantes`, el punto
 * único de descarga del panel, que verifica el permiso del área.
 *
 * ⚠️ **La imagen no se guarda.** El QR se lee en el navegador y al servidor viaja
 * sólo su texto. Guardar fotos de facturas es gestión documental y tiene su ADR
 * pendiente (0013): Storage, retención y permisos por campo.
 */

const VISTAS = ['todos', 'sin_imputar'] as const
type Vista = (typeof VISTAS)[number]

const ETIQUETAS_VISTA: Record<Vista, string> = {
  todos: 'Todos',
  sin_imputar: 'Sin imputar',
}

const MENSAJES_ERROR: Record<string, string> = {
  sin_proveedor: 'Elegí a qué proveedor se le imputa el comprobante.',
  inexistente: 'Ese comprobante ya no existe. Recargá la pantalla.',
  ya_imputado: 'Ese comprobante ya estaba imputado a una cuenta corriente.',
  sin_cotizacion:
    'No hay cotización para la moneda del comprobante, así que la deuda en dólares sería inventada. Cargá una a mano en Configuración.',
  imputar_lectura: 'No se pudo leer el comprobante. Probá de nuevo.',
  imputar: 'No se pudo registrar el movimiento en la cuenta del proveedor. No se guardó nada.',
  imputar_vinculo:
    'El movimiento SÍ se registró en la cuenta del proveedor, pero no se pudo dejar el vínculo con el comprobante. Revisalo en la ficha del proveedor antes de volver a imputarlo.',
}

interface ComprobanteRow {
  id: string
  cuit_emisor: string
  tipo_codigo: number
  letra: string | null
  punto_venta: number
  numero: number
  fecha: string
  total: number | string
  moneda: string
  cae: string
  origen_dato: string
  razon_social: string | null
  movimiento_id: string | null
  proveedor: { id: string; nombre: string } | null
}

export default async function ComprobantesPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string
    q?: string
    pagina?: string
    ok?: string
    error?: string
  }>
}) {
  const sesion = await requerirAcceso('proveedores')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const vista: Vista = (VISTAS as readonly string[]).includes(sp.vista ?? '')
    ? (sp.vista as Vista)
    : 'todos'
  const termino = terminoBusqueda(sp.q)
  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)

  let consulta = supabase
    .from('comprobantes_recibidos')
    .select(
      'id, cuit_emisor, tipo_codigo, letra, punto_venta, numero, fecha, total, moneda, cae, origen_dato, razon_social, movimiento_id, proveedor:proveedores(id, nombre)',
      { count: 'exact' },
    )
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })

  if (vista === 'sin_imputar') consulta = consulta.is('movimiento_id', null)
  // `.ilike` con el valor pelado es seguro: viaja como parámetro y no como
  // sintaxis del filtro (`patronOr()` haría falta sólo dentro de un `.or()`).
  if (termino) consulta = consulta.ilike('razon_social', `%${termino}%`)

  const [{ data, count }, { count: sinImputar }, { data: proveedoresData }] = await Promise.all([
    consulta.range(desde, hasta),
    supabase
      .from('comprobantes_recibidos')
      .select('id', { count: 'exact', head: true })
      .is('movimiento_id', null),
    supabase
      .from('proveedores')
      .select('id, nombre')
      .eq('activo', true)
      .order('nombre')
      .limit(300),
  ])

  // El CUIT del hotel, para poder avisar si una factura escaneada no es suya.
  // `null` cuando todavía no se cargó: ver el comentario del `EscanearComprobante`.
  const emisor = await datosFiscales(supabase)

  const comprobantes = (data ?? []) as unknown as ComprobanteRow[]
  const total = count ?? 0
  const proveedores = (proveedoresData ?? []) as { id: string; nombre: string }[]

  // Sólo gerencia carga e imputa. Recepción ve la lista, que es lo que necesita
  // para saber si una factura ya está cargada antes de volver a escanearla.
  const puedeGestionar = sesion.rol === 'admin' || sesion.rol === 'gerencia'

  const filtros = { vista, q: sp.q }

  return (
    <Pagina>
      <Link
        href="/panel/proveedores"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a proveedores
      </Link>

      <Encabezado
        titulo="Comprobantes recibidos"
        descripcion="Escaneá el QR de la factura y los datos entran solos. Después se bajan a Excel."
        icono="proveedores"
        acciones={
          <a
            href={`/panel/exportar/comprobantes${construirQuery(filtros, { pagina: undefined })}`}
            className={botonClases('secundario')}
          >
            Bajar a Excel (CSV)
          </a>
        }
      />

      {sp.error && (
        <Mensaje tono="error">
          {MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}
        </Mensaje>
      )}
      {sp.ok === 'imputado' && (
        <Mensaje tono="ok">
          Imputado a la cuenta del proveedor. Ya figura en su saldo y en la antigüedad.
        </Mensaje>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi titulo="En el filtro" valor={String(total)} detalle="comprobantes" icono="proveedores" />
        <Kpi
          titulo="Sin imputar"
          valor={String(sinImputar ?? 0)}
          detalle="cargados, sin pasar a la cuenta"
          icono="alerta"
        />
        <Kpi
          titulo="Proveedores"
          valor={String(proveedores.length)}
          detalle="activos, para vincular"
          icono="agencias"
        />
      </div>

      {puedeGestionar && (
        <div className="mb-4 grid gap-4">
          <Tarjeta
            titulo="Sacarle una foto a la factura"
            descripcion="Se lee el código QR obligatorio de la factura electrónica. La foto no se guarda."
            className="overflow-hidden p-0"
          >
            {/*
              El CUIT del hotel sale de `datos_fiscales` (migración 0082).

              Cuando todavía no está cargado va `null` y la advertencia «esta
              factura no es para el hotel» queda **apagada**, no aproximada: un
              aviso construido sobre un dato inventado es peor que no tener aviso.
              La pantalla de configuración dice que falta cargarlo.
            */}
            <EscanearComprobante proveedores={proveedores} cuitHotel={emisor?.cuit ?? null} />
          </Tarjeta>

          <Tarjeta
            titulo="O cargarlo a mano"
            descripcion="Para una factura anterior a 2021, un papel cuyo QR no se deja leer, o un navegador que no puede escanear."
            className="overflow-hidden p-0"
          >
            <CargarAMano
              proveedores={proveedores}
              monedas={['ARS', 'USD', ...MONEDAS_EXTRANJERAS.filter((m) => m !== 'ARS')]}
            />
          </Tarjeta>
        </div>
      )}

      <BarraHerramientas>
        <div className="flex flex-wrap gap-1.5">
          {VISTAS.map((v) => (
            <Chip
              key={v}
              href={`/panel/proveedores/comprobantes${construirQuery(filtros, { vista: v, pagina: undefined })}`}
              activo={vista === v}
            >
              {ETIQUETAS_VISTA[v]}
            </Chip>
          ))}
        </div>
        <Buscador
          accion="/panel/proveedores/comprobantes"
          valor={sp.q ?? ''}
          etiqueta="Buscar por razón social"
          placeholder="Lavandería, distribuidora…"
          ocultos={{ vista }}
        />
        {(termino || vista !== 'todos') && (
          <Link href="/panel/proveedores/comprobantes" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      <Tarjeta className="overflow-hidden p-0">
        {comprobantes.length === 0 ? (
          <EstadoVacio
            titulo={termino || vista !== 'todos' ? 'Sin resultados' : 'Todavía no hay comprobantes'}
            descripcion={
              termino || vista !== 'todos'
                ? 'Probá con otro filtro.'
                : 'Sacale una foto al QR de una factura para cargar la primera.'
            }
            icono="proveedores"
          />
        ) : (
          <>
            <Tabla resumen="Comprobantes recibidos: fecha, tipo y número, emisor, importe, de dónde salieron los datos y si están imputados.">
              <thead>
                <tr className={FILA}>
                  <th className={TH}>Fecha</th>
                  <th className={TH}>Comprobante</th>
                  <th className={TH}>Emisor</th>
                  <th className={TH}>Total</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Datos</th>
                  <th className={TH}>Cuenta corriente</th>
                </tr>
              </thead>
              <tbody>
                {comprobantes.map((c) => (
                  <tr key={c.id} className={FILA}>
                    <td className={`${TD} tabular whitespace-nowrap text-stone-500`}>
                      {formatoFechaCorta(c.fecha)}
                    </td>
                    <td className={TD}>
                      <span className="font-medium text-stone-800">
                        {nombreDeComprobante(c.tipo_codigo)}
                      </span>
                      <span className="block font-mono text-xs text-stone-500">
                        {numeroVisible(c.punto_venta, c.numero)}
                      </span>
                      {esNotaDeCredito(c.tipo_codigo) && (
                        <Etiqueta tono="alerta">Resta del saldo</Etiqueta>
                      )}
                    </td>
                    <td className={TD}>
                      {c.razon_social ?? c.proveedor?.nombre ?? 'Sin identificar'}
                      <span className="block font-mono text-xs text-stone-500">
                        {c.cuit_emisor}
                      </span>
                    </td>
                    <td className={`${TD} tabular whitespace-nowrap`}>
                      {c.moneda} {importe(Number(c.total))}
                    </td>
                    <td className={`${TD} ${COL_SECUNDARIA}`}>
                      {/*
                        De dónde salieron los datos. No es decorativo: un número
                        tipeado puede estar mal y uno leído del QR no, así que
                        quien revisa el cierre del mes tiene que poder
                        distinguirlos sin preguntarle a nadie.
                      */}
                      <Etiqueta tono={c.origen_dato === 'qr' ? 'exito' : 'neutro'}>
                        {c.origen_dato === 'qr' ? 'Leído del QR' : 'Cargado a mano'}
                      </Etiqueta>
                    </td>
                    <td className={TD}>
                      {c.movimiento_id ? (
                        <span className="text-sm text-stone-600">
                          Imputado
                          {c.proveedor && (
                            <Link
                              href={`/panel/proveedores/${c.proveedor.id}`}
                              className="ml-1 underline"
                            >
                              {c.proveedor.nombre}
                            </Link>
                          )}
                        </span>
                      ) : puedeGestionar ? (
                        <form
                          action={imputarComprobante}
                          className="flex flex-wrap items-end gap-1.5"
                        >
                          <input type="hidden" name="comprobante_id" value={c.id} />
                          <label className="flex flex-col gap-1 text-xs">
                            <span className="text-stone-500">Proveedor</span>
                            <select
                              name="proveedor_id"
                              defaultValue={c.proveedor?.id ?? ''}
                              className={CAMPO}
                            >
                              <option value="">Elegí el proveedor…</option>
                              {proveedores.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nombre}
                                </option>
                              ))}
                            </select>
                          </label>
                          {!esNotaDeCredito(c.tipo_codigo) && (
                            <label className="flex flex-col gap-1 text-xs">
                              <span className="text-stone-500">Vencimiento</span>
                              <input
                                name="vencimiento"
                                type="date"
                                title="Vencimiento (alimenta la antigüedad de saldos)"
                                className={CAMPO}
                              />
                            </label>
                          )}
                          <BotonEnvio
                            variante="secundario"
                            cargando="Imputando…"
                            confirmar="Se va a registrar este comprobante en la cuenta corriente del proveedor. ¿Confirmás?"
                          >
                            Imputar
                          </BotonEnvio>
                        </form>
                      ) : (
                        <span className="text-sm text-stone-500">Sin imputar</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
            <Paginacion
              pagina={pagina}
              total={total}
              base="/panel/proveedores/comprobantes"
              params={filtros}
            />
          </>
        )}
      </Tarjeta>
    </Pagina>
  )
}
