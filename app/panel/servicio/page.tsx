import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/paginado'
import { hoyISO, sumarDias, parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'
import {
  listaDeDesayuno,
  resumenDeVentas,
  ETIQUETAS_CATEGORIA_PRODUCTO,
  type EstadiaServicio,
  type ConsumoVendido,
  type DesayunoExtra,
} from '@/lib/domain/servicio'
import {
  Encabezado,
  EstadoVacio,
  FILA,
  Mensaje,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../_components/ui'
import { BotonImprimir } from './imprimir'

/**
 * Servicio de cocina: lista de desayuno del día y resumen de lo vendido.
 *
 * Son los dos papeles que se imprimen todos los días. La pantalla está pensada
 * para eso: al imprimir desaparecen la navegación y los filtros, y quedan solo
 * las tablas con su encabezado y su fecha (ver `@media print` en globals.css y
 * las clases `print:hidden`).
 *
 * El desayuno del día se calcula con la regla del dominio: desayuna quien
 * **durmió anoche**, así que el que se retira hoy entra y el que llega hoy no.
 */

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

interface FilaEstadia {
  periodo: string
  huespedes: number | null
  /**
   * ⚠️ `nombre`, no `codigo`: la tabla `unidades` no tiene columna `codigo`.
   * Pedirla hacía fallar la consulta entera con «column unidades_1.codigo does
   * not exist», así que la lista de desayuno salía **siempre vacía**. Los otros
   * seis módulos que embeben `unidades` ya usaban `nombre`.
   */
  unidad: { nombre: string } | null
  reserva: {
    codigo: string
    estado: string
    notas: string | null
    huesped: { apellido: string; nombre: string } | null
  } | null
}

interface FilaConsumo {
  cantidad: number
  precio_unitario: number | string
  fecha: string
  producto: { codigo: string; nombre: string; categoria: string } | null
}

/** Estados en los que el huésped efectivamente está (o estará) en la casa. */
const ESTADOS_EN_CASA = ['confirmada', 'pagada', 'in_house', 'checkout']

export default async function ServicioPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; desde?: string; hasta?: string }>
}) {
  await requerirAcceso('servicio')
  const sp = await searchParams

  const fecha = RE_FECHA.test(sp.fecha ?? '') ? sp.fecha! : hoyISO()
  const hasta = RE_FECHA.test(sp.hasta ?? '') ? sp.hasta! : hoyISO()
  const desde = RE_FECHA.test(sp.desde ?? '') ? sp.desde! : sumarDias(hasta, -6)

  const supabase = await crearClienteServidor()

  // Se traen las estadías que se solapan con la ventana del desayuno. El filtro
  // fino —quién durmió anoche— lo hace el dominio, que es donde vive la regla.
  const [estadiasRes, consumosRes, extrasRes] = await Promise.all([
    traerTodo<FilaEstadia>((d, h) =>
      supabase
        .from('estadias')
        .select(
          'periodo, huespedes, unidad:unidades(nombre), reserva:reservas(codigo, estado, notas, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre))',
        )
        .in('estado', ESTADOS_EN_CASA)
        .overlaps('periodo', `[${sumarDias(fecha, -1)},${sumarDias(fecha, 1)})`)
        .order('id')
        .range(d, h) as never,
    ),
    traerTodo<FilaConsumo>((d, h) =>
      supabase
        .from('consumos')
        .select('cantidad, precio_unitario, fecha, producto:productos_servicios(codigo, nombre, categoria)')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('id')
        .range(d, h) as never,
    ),
    /*
      Desayunos vendidos SUELTOS para la fecha de la lista.

      Van en una consulta aparte y no dentro de la de arriba porque el rango es
      otro: aquélla cubre el período del resumen de ventas (que puede ser un mes)
      y ésta solo el día que se está por servir.

      Sin esto, el que llegó a las 9 y pagó su desayuno no aparecía en la lista
      de cocina —la lista se arma con quién durmió anoche— y la cocina preparaba
      un cubierto de menos. Es justamente lo que la pantalla existe para evitar.
    */
    supabase
      .from('consumos')
      .select(
        // ⚠️ `!inner` en el producto NO es decorativo: con un embed normal,
        // PostgREST devuelve TODAS las filas madre con el array vacío, así que
        // el filtro por categoría no filtraría nada y la lista contaría cada
        // frigobar como un desayuno. Es la trampa más silenciosa de este stack
        // (ver AGENTS.md y el test de `SELECT_RESERVAS`).
        'cantidad, producto:productos_servicios!inner(categoria), reserva:reservas(codigo, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre), estadias(unidad:unidades(nombre)))',
      )
      .eq('fecha', fecha)
      .eq('producto.categoria', 'desayuno'),
  ])

  /*
    Se separan las dos cosas que antes se leían como una sola.

    `traerTodo` devuelve `truncado: true` tanto cuando llegó al techo de filas
    como cuando **la consulta falló**, y esta pantalla solo miraba `truncado`.
    Con la consulta de estadías rota, el resultado era un cartel que decía «hay
    más datos de los que se pudieron leer, achicá el rango» sobre una lista
    vacía: el mensaje mandaba a corregir el filtro cuando el problema era otro,
    y el error real no aparecía en ningún lado.
  */
  const fallo = estadiasRes.error ?? consumosRes.error
  const truncado = !fallo && (estadiasRes.truncado || consumosRes.truncado)

  // El detalle técnico va al log del servidor, nunca a la pantalla: a quien
  // arma el desayuno no le sirve un mensaje de PostgREST, y a quien tiene que
  // arreglarlo no le sirve «no se pudieron leer los datos».
  if (fallo) console.error('Servicio de cocina: falló la lectura —', fallo)

  const estadias: EstadiaServicio[] = estadiasRes.filas
    .filter((e) => e.unidad && e.reserva)
    .map((e) => {
      const { desde: ci, hasta: co } = parsearPeriodo(e.periodo)
      const h = e.reserva!.huesped
      return {
        reservaCodigo: e.reserva!.codigo,
        unidad: e.unidad!.nombre,
        huesped: h ? `${h.apellido}, ${h.nombre}` : 'Sin huésped',
        checkIn: ci,
        checkOut: co,
        huespedes: e.huespedes ?? 1,
        notas: e.reserva!.notas,
      }
    })

  /*
    Desayunos vendidos sueltos del día. Si la consulta falla no se corta la
    pantalla: la lista de los incluidos sigue sirviendo, y una lista incompleta
    con aviso es mejor que ninguna a las 7 de la mañana. El error va al log.
  */
  if (extrasRes.error) {
    console.error('Servicio de cocina: no se pudieron leer los desayunos extra —', extrasRes.error)
  }

  type FilaExtra = {
    cantidad: number
    reserva: {
      codigo: string
      huesped: { apellido: string; nombre: string } | null
      estadias: { unidad: { nombre: string } | null }[] | null
    } | null
  }

  const extras: DesayunoExtra[] = ((extrasRes.data ?? []) as unknown as FilaExtra[])
    .filter((c) => c.reserva)
    .map((c) => {
      const h = c.reserva!.huesped
      return {
        reservaCodigo: c.reserva!.codigo,
        huesped: h ? `${h.apellido}, ${h.nombre}` : 'Sin huésped',
        // Puede no tener unidad todavía: llegó antes del check-in.
        unidad: c.reserva!.estadias?.[0]?.unidad?.nombre ?? null,
        cubiertos: c.cantidad,
        fecha,
      }
    })

  const lista = listaDeDesayuno(estadias, fecha, extras)

  const consumos: ConsumoVendido[] = consumosRes.filas
    .filter((c) => c.producto)
    .map((c) => ({
      productoCodigo: c.producto!.codigo,
      productoNombre: c.producto!.nombre,
      categoria: c.producto!.categoria as ConsumoVendido['categoria'],
      cantidad: c.cantidad,
      precioUnitario: Number(c.precio_unitario),
      fecha: c.fecha,
    }))

  const ventas = resumenDeVentas(consumos, desde, hasta)

  return (
    <Pagina>
      <div className="print:hidden">
        <Encabezado
          titulo="Servicio de cocina"
          descripcion="Lista de desayuno del día y resumen de lo vendido."
          icono="reportes"
          acciones={<BotonImprimir />}
        />
      </div>

      {fallo && (
        <Mensaje tono="error">
          No se pudieron leer los datos del servicio, así que estos listados pueden estar vacíos o
          incompletos. No es un problema del filtro: volvé a intentar y, si sigue igual, avisá a
          sistemas.
        </Mensaje>
      )}

      {truncado && (
        <Mensaje tono="error">
          Hay más datos de los que se pudieron leer de una vez: estos listados están incompletos.
          Achicá el rango de fechas.
        </Mensaje>
      )}

      {/* Filtros: no se imprimen. */}
      <form
        method="get"
        action="/panel/servicio"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4 print:hidden"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-stone-500">Desayuno del día</span>
          <input
            type="date"
            name="fecha"
            defaultValue={fecha}
            aria-label="Fecha del desayuno"
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-stone-500">Ventas desde</span>
          <input
            type="date"
            name="desde"
            defaultValue={desde}
            aria-label="Ventas desde"
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-stone-500">Ventas hasta</span>
          <input
            type="date"
            name="hasta"
            defaultValue={hasta}
            aria-label="Ventas hasta"
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800"
        >
          Ver
        </button>
      </form>

      {/* ── Encabezado que SÍ se imprime ─────────────────────────────────── */}
      <div className="hidden print:block">
        <h1 className="text-lg font-semibold">Hotel Blanca Patagonia — Servicio de cocina</h1>
        <p className="text-sm">Desayuno del {formatoFechaCorta(fecha)}</p>
      </div>

      <Tarjeta
        titulo={`Desayuno del ${formatoFechaCorta(fecha)}`}
        descripcion={
          `${lista.totalCubiertos} cubiertos · ${lista.lineas.length} habitaciones · ` +
          `${lista.totalSeRetiran} se retiran hoy` +
          (lista.totalExtras > 0 ? ` · ${lista.totalExtras} extra vendidos` : '')
        }
      >
        {lista.lineas.length === 0 ? (
          <EstadoVacio titulo="No hay nadie alojado esa noche" />
        ) : (
          <Tabla resumen={`Lista de desayuno del ${fecha}, por habitación`}>
            <thead>
              <tr>
                <th className={TH} scope="col">Unidad</th>
                <th className={TH} scope="col">Huésped</th>
                <th className={TH} scope="col">Cubiertos</th>
                <th className={TH} scope="col">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.lineas.map((l) => (
                <tr key={`${l.reservaCodigo}-${l.unidad}-${l.esExtra ? 'x' : 'i'}`} className={FILA}>
                  <td className={`${TD} font-medium`}>{l.unidad}</td>
                  <td className={TD}>{l.huesped}</td>
                  <td className={`${TD} tabular-nums`}>{l.cubiertos}</td>
                  <td className={`${TD} text-sm text-stone-600`}>
                    {/* El extra se marca con TEXTO y no con color: esta hoja se
                        imprime, y muchas veces en blanco y negro. */}
                    {l.esExtra && (
                      <span className="font-medium text-lenga-800">
                        Desayuno extra vendido{l.unidad === '—' ? ' (todavía sin habitación)' : ''}.{' '}
                      </span>
                    )}
                    {l.seRetiraHoy && <span className="font-medium">Se retira hoy. </span>}
                    {l.notas}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-stone-300 font-semibold">
                <td className={TD} colSpan={2}>Total</td>
                <td className={`${TD} tabular-nums`}>{lista.totalCubiertos}</td>
                <td className={TD} />
              </tr>
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      {/* Salto de página al imprimir: cada listado en su hoja. */}
      <div className="break-before-page" />

      <Tarjeta
        titulo="Consumos vendidos"
        descripcion={`Del ${formatoFechaCorta(desde)} al ${formatoFechaCorta(hasta)} · ${ventas.dias} día(s) · ${ventas.totalUnidades} unidades · USD ${ventas.totalGeneral.toFixed(2)}`}
      >
        {ventas.lineas.length === 0 ? (
          <EstadoVacio titulo="No se vendió nada en ese período" />
        ) : (
          <>
            <Tabla resumen={`Consumos vendidos entre ${desde} y ${hasta}, por producto`}>
              <thead>
                <tr>
                  <th className={TH} scope="col">Producto</th>
                  <th className={TH} scope="col">Categoría</th>
                  <th className={TH} scope="col">Cantidad</th>
                  <th className={TH} scope="col">Total USD</th>
                </tr>
              </thead>
              <tbody>
                {ventas.lineas.map((l) => (
                  <tr key={l.productoCodigo} className={FILA}>
                    <td className={`${TD} font-medium`}>{l.productoNombre}</td>
                    <td className={TD}>{ETIQUETAS_CATEGORIA_PRODUCTO[l.categoria]}</td>
                    <td className={`${TD} tabular-nums`}>{l.cantidad}</td>
                    <td className={`${TD} tabular-nums`}>{l.total.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-stone-300 font-semibold">
                  <td className={TD} colSpan={2}>Total</td>
                  <td className={`${TD} tabular-nums`}>{ventas.totalUnidades}</td>
                  <td className={`${TD} tabular-nums`}>{ventas.totalGeneral.toFixed(2)}</td>
                </tr>
              </tbody>
            </Tabla>

            <h3 className="mt-6 mb-2 text-sm font-semibold text-stone-700">Por categoría</h3>
            <Tabla resumen="Totales por categoría de producto">
              <thead>
                <tr>
                  <th className={TH} scope="col">Categoría</th>
                  <th className={TH} scope="col">Cantidad</th>
                  <th className={TH} scope="col">Total USD</th>
                </tr>
              </thead>
              <tbody>
                {ventas.porCategoria.map((c) => (
                  <tr key={c.categoria} className={FILA}>
                    <td className={`${TD} font-medium`}>{ETIQUETAS_CATEGORIA_PRODUCTO[c.categoria]}</td>
                    <td className={`${TD} tabular-nums`}>{c.cantidad}</td>
                    <td className={`${TD} tabular-nums`}>{c.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </>
        )}
      </Tarjeta>
    </Pagina>
  )
}
