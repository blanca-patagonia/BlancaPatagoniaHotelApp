import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_ACTIVOS } from '@/lib/domain/reservas'
import { hoyISO, rangoISO, sumarDias } from '@/lib/fechas'
import {
  resolutorDepartamentos,
  type DepartamentoFila,
} from '@/lib/domain/departamentos'
import { BotonEnvio } from '../_components/boton-envio'
import {
  COL_SECUNDARIA,
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
  botonClases,
} from '../_components/ui'
import { GrillaPos, type ProductoPos, type ReservaPos } from './grilla'
import { anularComanda } from './actions'
import { formatearUSD } from '@/lib/domain/moneda'

/**
 * Punto de venta.
 *
 * Reemplaza el `<select>` de a un producto del detalle de la reserva por la grilla
 * por departamento que tenía WinPAX, con buscador y número de comanda.
 *
 * ── Qué NO cambia ───────────────────────────────────────────────────────────
 *
 * El cargo sigue yendo a `consumos`, la misma tabla que ya alimenta la cuenta del
 * huésped, la factura y los reportes de servicio. No hay un segundo camino por el
 * que un consumo pueda llegar a la cuenta: lo único nuevo es que las líneas
 * comparten un número que permite reconocer el recuento y anularlo completo.
 */

const MENSAJES_ERROR: Record<string, string> = {
  comanda: 'Faltó indicar qué comanda anular.',
  anular: 'No se pudo anular la comanda. Quedó como estaba.',
}

interface ConsumoRow {
  id: string
  comanda: number | null
  folio: string
  departamento_id: string | null
  cantidad: number
  precio_unitario: number | string
  nota: string
  fecha: string
  producto: { nombre: string } | null
  reserva: {
    codigo: string
    huesped: { apellido: string } | null
  } | null
}

export default async function PuntoVentaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; comanda?: string }>
}) {
  await requerirAcceso('punto_venta')
  const sp = await searchParams
  const supabase = await crearClienteServidor()
  const hoy = hoyISO()

  const [{ data: productosData }, { data: estadiasData }, { data: consumosData }, { data: deptosData }] =
    await Promise.all([
      supabase
        .from('productos_servicios')
        .select('id, codigo, nombre, categoria, precio, stock')
        .eq('activo', true)
        .order('categoria')
        .order('nombre'),

      // Sólo las estadías que tocan hoy: no tiene sentido cargarle un frigobar a
      // alguien que llega el mes que viene, y la lista corta evita elegir mal.
      supabase
        .from('estadias')
        .select(
          'reserva_id, unidad:unidades(nombre), reserva:reservas(codigo, estado, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre))',
        )
        .in('estado', [...ESTADOS_ACTIVOS])
        // ⚠️ `rangoISO(hoy, hoy)` sería `[hoy,hoy)`, que es un rango **VACÍO** y no
        // se solapa con nada: la lista salía siempre en cero y el POS quedaba
        // inutilizable diciendo «no hay nadie alojado hoy». Los períodos son
        // `[desde, hasta)`, así que «la noche de hoy» es `[hoy, mañana)`.
        .overlaps('periodo', rangoISO(hoy, sumarDias(hoy, 1))),

      // Comandas recientes, para poder revisar y anular.
      supabase
        .from('consumos')
        .select(
          'id, comanda, folio, cantidad, precio_unitario, nota, fecha, departamento_id, producto:productos_servicios(nombre), reserva:reservas(codigo, huesped:huespedes!reservas_huesped_id_fkey(apellido))',
        )
        .not('comanda', 'is', null)
        .order('comanda', { ascending: false })
        .limit(120),

      // La tabla completa de departamentos, una vez. Son ~14 filas y sirven para
      // resolver la jerarquía de todas las líneas sin un join por fila: el embed
      // anidado de PostgREST no puede hacerlo (ver `lib/domain/departamentos.ts`).
      supabase.from('departamentos').select('id, nombre, padre_id'),
    ])

  const resolverDepto = resolutorDepartamentos((deptosData ?? []) as DepartamentoFila[])

  const productos = ((productosData ?? []) as ProductoPos[]).map((p) => ({
    ...p,
    precio: Number(p.precio),
  }))

  const reservas: ReservaPos[] = (
    (estadiasData ?? []) as unknown as {
      reserva_id: string
      unidad: { nombre: string } | null
      reserva: { codigo: string; huesped: { apellido: string; nombre: string } | null } | null
    }[]
  ).map((e) => ({
    id: e.reserva_id,
    codigo: e.reserva?.codigo ?? '',
    huesped: e.reserva?.huesped
      ? `${e.reserva.huesped.apellido}, ${e.reserva.huesped.nombre}`
      : 'Sin huésped',
    unidad: e.unidad?.nombre ?? '—',
  }))

  const consumos = (consumosData ?? []) as unknown as ConsumoRow[]

  // Se agrupan por comanda para poder mostrarlas y anularlas como una unidad.
  const comandas = new Map<number, ConsumoRow[]>()
  for (const c of consumos) {
    if (c.comanda == null) continue
    const lista = comandas.get(c.comanda) ?? []
    lista.push(c)
    comandas.set(c.comanda, lista)
  }

  const vendidoHoy = consumos
    .filter((c) => c.fecha === hoy)
    .reduce((acc, c) => acc + c.cantidad * Number(c.precio_unitario), 0)

  return (
    <Pagina ancho="ancho">
      <Encabezado
        titulo="Punto de venta"
        descripcion="Frigobar, room service y extras. El cargo va directo a la cuenta del huésped."
        icono="objetos"
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'Ocurrió un error.'}</Mensaje>}
      {sp.ok === 'anulada' && (
        <Mensaje tono="ok">
          Comanda {sp.comanda} anulada. Las líneas se quitaron de la cuenta del huésped.
        </Mensaje>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Alojados hoy"
          valor={String(reservas.length)}
          detalle="habitaciones a las que se puede cargar"
          icono="huespedes"
        />
        <Kpi
          titulo="Vendido hoy"
          valor={`${formatearUSD(vendidoHoy)}`}
          detalle="consumos con comanda"
          icono="reportes"
          tono="exito"
        />
        <Kpi
          titulo="Comandas"
          valor={String(comandas.size)}
          detalle="últimas cargadas"
          icono="objetos"
        />
        <Kpi
          titulo="Catálogo"
          valor={String(productos.length)}
          detalle="productos activos"
          icono="config"
          href="/panel/config"
        />
      </div>

      {reservas.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            titulo="No hay nadie alojado hoy"
            descripcion="Los consumos se cargan a una reserva en curso. Cuando haya alguien alojado, la grilla aparece acá."
            icono="huespedes"
            accion={
              <Link href="/panel/reservas" className={botonClases('secundario')}>
                Ver reservas
              </Link>
            }
          />
        </Tarjeta>
      ) : productos.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            titulo="El catálogo está vacío"
            descripcion="Cargá productos en Configuración para poder venderlos."
            icono="config"
            accion={
              <Link href="/panel/config" className={botonClases('primario')}>
                Ir a Configuración
              </Link>
            }
          />
        </Tarjeta>
      ) : (
        <GrillaPos productos={productos} reservas={reservas} />
      )}

      {/* ── Comandas recientes ─────────────────────────────────────────────── */}
      {comandas.size > 0 && (
        <div className="mt-6">
          <Tarjeta
            titulo="Comandas recientes"
            descripcion="Anular quita todas las líneas de la cuenta del huésped. No repone el stock: el consumo físico ya pasó."
          >
            <div className="overflow-x-auto">
              <Tabla resumen="Comandas cargadas recientemente, con su total y la opción de anularlas">
                <thead>
                  <tr>
                    <th className={TH}>Comanda</th>
                    <th className={TH}>Habitación</th>
                    <th className={`${TH} ${COL_SECUNDARIA}`}>Depto. / folio</th>
                    <th className={`${TH} ${COL_SECUNDARIA}`}>Líneas</th>
                    <th className={`${TH} text-right`}>Total</th>
                    <th className={TH}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {[...comandas.entries()].map(([numero, lineas]) => {
                    const total = lineas.reduce(
                      (acc, l) => acc + l.cantidad * Number(l.precio_unitario),
                      0,
                    )
                    const primera = lineas[0]

                    return (
                      <tr key={numero} className={FILA}>
                        <td className={`${TD} tabular font-medium text-stone-800`}>#{numero}</td>
                        <td className={`${TD} text-stone-600`}>
                          {primera.reserva?.huesped?.apellido ?? '—'}
                          <span className="block text-xs text-stone-500">
                            {primera.reserva?.codigo} · {primera.fecha}
                          </span>
                          {/* En el teléfono las columnas de depto./folio y de líneas
                              se ocultan, pero el folio decide a QUIÉN se le cobra:
                              se pliega acá en vez de desaparecer. */}
                          <span className="block text-xs text-stone-500 sm:hidden">
                            {resolverDepto(primera.departamento_id).etiqueta} · folio{' '}
                            {primera.folio} · {lineas.length} línea(s)
                          </span>
                        </td>
                        <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>
                          {resolverDepto(primera.departamento_id).etiqueta}
                          {/* El folio con texto: es lo que decide a quién se le
                              cobra, y no puede quedar solo insinuado. */}
                          <span className="mt-0.5 block text-xs text-stone-500">
                            Folio {primera.folio}
                          </span>
                        </td>
                        <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>
                          <ul className="text-xs">
                            {lineas.map((l) => (
                              <li key={l.id}>
                                {l.cantidad}× {l.producto?.nombre}
                              </li>
                            ))}
                          </ul>
                          {primera.nota && (
                            <span className="mt-1 block text-xs text-stone-500 italic">
                              «{primera.nota}»
                            </span>
                          )}
                        </td>
                        <td className={`${TD} tabular text-right font-semibold text-stone-900`}>
                          {formatearUSD(total)}
                        </td>
                        <td className={TD}>
                          <form action={anularComanda}>
                            <input type="hidden" name="comanda" value={numero} />
                            <BotonEnvio
                              variante="fantasma"
                              cargando="Anulando…"
                              confirmar={`¿Anular la comanda #${numero}? Se quitan ${lineas.length} línea(s) por ${formatearUSD(total)} de la cuenta del huésped.`}
                            >
                              Anular
                            </BotonEnvio>
                          </form>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Tabla>
            </div>
          </Tarjeta>
        </div>
      )}
    </Pagina>
  )
}
