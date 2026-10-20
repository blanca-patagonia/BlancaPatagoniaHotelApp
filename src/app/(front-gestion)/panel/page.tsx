import { Suspense } from 'react'
import { comoLista } from '@/lib/domain/listas'
import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_ACTIVOS, ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { nombreCompleto } from '@/lib/domain/huespedes'
import { ETIQUETAS_ESTADO_HK, ESTADOS_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import {
  hoyISO,
  sumarDias,
  parsearPeriodo,
  formatoFechaCorta,
  inicioDelDiaHotel,
  fechaHoraHotel,
} from '@/lib/fechas'
import { porVencer, type ComprobanteDeuda } from '@/lib/domain/antiguedad'
import { faltantes as articulosFaltantes } from '@/lib/domain/inventario'
import { areasDe, esDireccion, estaOculta, type Area } from '@/lib/domain/permisos'
import { cronsAtrasados } from '@/lib/domain/crons'
import { registrarFalla } from '@/lib/acciones'
import { ESTADOS_FACTURABLES } from '@/lib/domain/facturacion'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import { TONO_ESTADO } from './_components/estilos'
import { Icono, type NombreIcono } from './_components/iconos'
import { WidgetCotizacion, WidgetCotizacionCargando } from './_components/cotizacion'
import { ConsultasRapidasIA } from './_components/consultas-rapidas-ia'
import { iaActiva } from '@/lib/ia/proveedor'
import {
  Encabezado,
  EstadoUnidad,
  EstadoVacio,
  Etiqueta,
  Kpi,
  Mensaje,
  Tarjeta,
  botonClases,
  Pagina,
} from './_components/ui'

interface EstadiaDia {
  periodo: string
  unidad: { nombre: string } | null
  reserva: {
    id: string
    codigo: string
    estado: EstadoReserva
    huesped: { apellido: string; nombre: string } | null
  } | null
}

/** Fila de llegada o salida del día, con acceso directo a la reserva. */
function FilaMovimiento({ e }: { e: EstadiaDia }) {
  const r = e.reserva
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-stone-100 px-5 py-2.5 first:border-0">
      {/*
        El nombre va en su propia línea y ACOTADO, no fluyendo junto a la unidad.

        Antes los dos eran `span` en línea dentro del mismo `flex-1`: un apellido
        compuesto —«Fernández de la Vega Etchegoyen, María de los Ángeles
        Guadalupe», que es un nombre perfectamente normal— envolvía en cuatro
        renglones, empujaba la unidad al final del párrafo y descolocaba la
        etiqueta de estado y el código de reserva.

        Con `truncate` la fila mide siempre lo mismo y el listado se lee de un
        vistazo, que es para lo que existe. El nombre completo queda en el
        `title`, y de todos modos está a un clic en la ficha.
      */}
      <span className="min-w-0 flex-1">
        <span
          className="block truncate font-medium text-stone-800"
          title={r?.huesped ? nombreCompleto(r.huesped) : undefined}
        >
          {r?.huesped ? nombreCompleto(r.huesped) : 'Sin huésped'}
        </span>
        {e.unidad?.nombre && (
          <span className="block truncate text-xs text-stone-600">{e.unidad.nombre}</span>
        )}
      </span>
      {r && <Etiqueta tono={TONO_ESTADO[r.estado]}>{ETIQUETAS_ESTADO_RESERVA[r.estado]}</Etiqueta>}
      {r && (
        <Link
          href={`/panel/reservas/${r.id}`}
          className="text-sm font-medium text-lago-700 hover:underline"
        >
          {r.codigo}
        </Link>
      )}
    </li>
  )
}

type ClienteServidor = Awaited<ReturnType<typeof crearClienteServidor>>

/** Cuántos días hacia atrás se mira para «consumos sin facturar». */
const VENTANA_CONSUMOS_SIN_FACTURAR_DIAS = 60

/**
 * Reservas en estados facturables (`ESTADOS_FACTURABLES`) con consumos
 * cargados que todavía no tienen factura — la cuenta que se puede olvidar
 * porque el huésped «ya se fue» (`motivoNoCargable`, ADR/P3: la cuenta se
 * cierra con la FACTURA, no con el check-out — no existe `consumos.factura_id`,
 * «facturada» es «existe una fila en `facturas` con este `reserva_id`», igual
 * que ya lo resuelve `agregarConsumo` en `app/panel/reservas/actions.ts`).
 *
 * Acotado a los últimos `VENTANA_CONSUMOS_SIN_FACTURAR_DIAS` por el check-out:
 * `checkout` es un estado terminal que no se vuelve a tocar, así que sin esta
 * ventana la consulta sumaría TODAS las reservas facturables de la historia
 * del hotel y con los años pasaría las 1000 filas que PostgREST corta en
 * silencio (`max_rows`). Una cuenta sin facturar hace más de dos meses ya no
 * es «atender hoy»: es otro problema, de auditoría.
 */
async function contarConsumosSinFacturar(
  supabase: ClienteServidor,
  hoy: string,
): Promise<{ cantidad: number; error: { message: string } | null }> {
  const desde = sumarDias(hoy, -VENTANA_CONSUMOS_SIN_FACTURAR_DIAS)

  /*
    Una sola consulta. Antes eran tres viajes en serie (reservas → facturas →
    consumos) con las listas de ids en la URL, que con unas cientos de
    reservas se acercaban al límite de largo de URL del proxy; y el tablero
    entero esperaba los tres.

    · `estadias!inner` + el filtro por `check_out`: la ventana. `!inner` es
      obligatorio para que el filtro recorte la reserva y no sólo el arreglo
      embebido (trampa documentada en AGENTS.md).
    · `consumos!inner(id)`: sólo reservas con algún consumo — sin esto se
      contaría también el alojamiento solo, que no es «consumos sin facturar».
    · `facturas(id)`, embed normal: se cuentan las que lo traen vacío. ⚠️ Es
      a-uno (una factura por reserva, 0045): llega como objeto o `null`, no
      como arreglo — `comoLista` —. Con `.length` sobre `null` el tablero entero
      daba error con la primera reserva con consumos y sin factura.
  */
  const { data, error } = await supabase
    .from('reservas')
    .select('id, estadias!inner(check_out), consumos!inner(id), facturas(id)')
    .in('estado', ESTADOS_FACTURABLES)
    .gte('estadias.check_out', desde)
  if (error) return { cantidad: 0, error }
  const cantidad = ((data ?? []) as unknown as { facturas: unknown }[]).filter(
    (r) => comoLista(r.facturas).length === 0,
  ).length
  return { cantidad, error: null }
}

/**
 * Reservas confirmadas o alojadas con saldo pendiente de cobro, calculado con
 * la misma cuenta consolidada (alojamiento + consumos) y el mismo
 * `resumenPagos` que usa `lib/notificaciones/cobros.ts` — no una segunda
 * noción de «pendiente» que con el tiempo diverja de la real (es la misma
 * situación que ya pasó con `saldarSiCorresponde`, documentada en ese archivo).
 *
 * Sólo cuenta las que YA deberían haber sido cobradas: una `confirmada` para
 * dentro de un mes, con la seña pagada y el resto pendiente, es el curso
 * normal de una reserva — contarla acá inundaría «Requiere atención» con
 * prácticamente toda reserva confirmada a futuro. Lo que sí pide atención es
 * el check-in ya pasado sin saldar (`confirmada` que debería haberse alojado)
 * o el check-out ya pasado sin saldar (`in_house` sin registrar la salida).
 */
async function contarSaldosPendientes(
  supabase: ClienteServidor,
  hoy: string,
): Promise<{ cantidad: number; error: { message: string } | null }> {
  /*
    Acotado en la base, no en JavaScript. Antes se traían TODAS las reservas
    confirmadas e in_house —las confirmadas a futuro, que son la mayoría, sólo
    para descartarlas— y pasadas las 1000 PostgREST cortaba sin aviso, así que
    el número podía salir mal. Ahora viajan sólo las candidatas: confirmadas
    con check-in ya pasado e in_house con check-out ya pasado. `!inner` es lo
    que hace que el filtro sobre `estadias` acote la reserva (ver AGENTS.md).
  */
  const SELECT =
    'estado, total, pagos(tipo, monto, estado), consumos(cantidad, precio_unitario), estadias!inner(check_in, check_out)'
  const [confirmadas, alojadas] = await Promise.all([
    supabase.from('reservas').select(SELECT).eq('estado', 'confirmada').lte('estadias.check_in', hoy),
    supabase.from('reservas').select(SELECT).eq('estado', 'in_house').lte('estadias.check_out', hoy),
  ])
  const error = confirmadas.error ?? alojadas.error
  if (error) return { cantidad: 0, error }

  const filas = [...(confirmadas.data ?? []), ...(alojadas.data ?? [])] as unknown as {
    estado: string
    total: number | string
    pagos: Pago[]
    consumos: { cantidad: number; precio_unitario: number | string }[]
    estadias: { check_in: string; check_out: string }[]
  }[]

  let cantidad = 0
  for (const r of filas) {
    const cuenta = cuentaConsolidada(
      Number(r.total),
      r.consumos.map(
        (c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }) as Consumo,
      ),
    )
    const resumen = resumenPagos(
      cuenta.total,
      r.pagos.map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado })),
    )
    if (resumen.saldo <= 0) continue

    // «Debería haberse cobrado» según el estado: el check-in ya pasado para
    // una `confirmada`, el check-out ya pasado para una `in_house`.
    const fechas =
      r.estado === 'in_house' ? r.estadias.map((e) => e.check_out) : r.estadias.map((e) => e.check_in)
    if (fechas.some((f) => f <= hoy)) cantidad++
  }
  return { cantidad, error: null }
}

export default async function DashboardPage() {
  const sesion = await requerirAcceso('dashboard')
  const supabase = await crearClienteServidor()
  const hoy = hoyISO()
  const mañana = sumarDias(hoy, 1)

  /*
    Tareas programadas atrasadas (0117). Un cron que dejó de correr no deja
    errores —simplemente no pasa nada—: las reservas pendientes dejan de
    expirar y los avisos dejan de salir. Sólo lo ve la dirección, que es quien
    puede resolverlo (y la única que lee esa tabla).
  */
  let atrasados: ReturnType<typeof cronsAtrasados> = []
  // Sólo en producción: en desarrollo los crons no corren nunca y la alerta
  // estaría siempre encendida, que es la forma de enseñar a ignorarla.
  if (process.env.NODE_ENV === 'production' && esDireccion(sesion.rol)) {
    const { data: corridas, error: eCorridas } = await supabase
      .from('cron_corridas')
      .select('nombre, ultima_ok')
    registrarFalla(eCorridas, 'dashboard:cron_corridas')
    // Si no se pudo leer, no se inventa una alarma: queda en el registro.
    if (!eCorridas) atrasados = cronsAtrasados(corridas ?? [], new Date())
  }

  const [
    { data: unidades, error: eUnidades },
    { data: estadias, error: eEstadias },
    { count: reservasActivas, error: eActivas },
    { count: reservasNuevasHoy, error: eNuevasHoy },
    { count: canceladasHoy, error: eCanceladasHoy },
    { count: mantPendiente, error: eMant },
    { count: objetosGuardados, error: eObjetos },
    { count: conflictosCanal, error: eConflictos },
    { data: stockBajo, error: eStock },
    { data: comprobantes, error: eComprobantes },
    { count: avisosFijados, error: eAvisos },
    { cantidad: consumosSinFacturar, error: eConsumosSinFacturar },
    { cantidad: saldosPendientes, error: eSaldosPendientes },
  ] = await Promise.all([
    supabase.from('unidades').select('estado').eq('activo', true),
    supabase
      .from('estadias')
      .select(
        'periodo, unidad:unidades(nombre), reserva:reservas(id, codigo, estado, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre))',
      )
      .in('estado', [...ESTADOS_ACTIVOS])
      /*
        Sólo las que tocan HOY (llegan, se van o están alojadas): es todo lo
        que el tablero usa. Sin este filtro viajaban todas las estadías
        activas del año, y pasadas las 1000 los KPI del día salían mal sin
        aviso. `check_in`/`check_out` son columnas generadas (0037) con índice.
      */
      .lte('check_in', hoy)
      .gte('check_out', hoy),
    supabase.from('reservas').select('*', { count: 'exact', head: true }).in('estado', [...ESTADOS_ACTIVOS]),
    // Altas del día: por cuándo se CARGÓ la reserva, no por cuándo empieza la
    // estadía (eso ya lo cuentan «Llegadas hoy»).
    supabase
      .from('reservas')
      .select('*', { count: 'exact', head: true })
      .gte('creada_en', inicioDelDiaHotel(hoy))
      .lt('creada_en', inicioDelDiaHotel(mañana)),
    // `cancelada_en` (migración 0090): sin esa fecha, «canceladas hoy» y
    // «canceladas el mes pasado» eran indistinguibles.
    supabase
      .from('reservas')
      .select('*', { count: 'exact', head: true })
      .gte('cancelada_en', inicioDelDiaHotel(hoy))
      .lt('cancelada_en', inicioDelDiaHotel(mañana)),
    supabase
      .from('ordenes_mantenimiento')
      .select('*', { count: 'exact', head: true })
      .in('estado', ['pendiente', 'en_proceso']),
    // Entrantes del canal que chocan con lo ya vendido (migración 0052). Va acá porque
    // el hub es lo que se mira una vez por día.
    supabase
      .from('canal_reservas')
      .select('*', { count: 'exact', head: true })
      .eq('conflicto', true)
      .neq('estado', 'ignorada'),
    // Si el módulo está apagado (`AREAS_OCULTAS`), nadie va a ver este número y la
    // consulta sería un viaje a la base de más en la pantalla que más se abre.
    estaOculta('objetos_perdidos')
      ? Promise.resolve({ count: 0, error: null })
      : supabase
          .from('objetos_perdidos')
          .select('*', { count: 'exact', head: true })
          .eq('estado', 'guardado'),
    supabase.from('productos_servicios').select('nombre, stock, stock_minimo').eq('activo', true),
    supabase
      .from('movimientos_proveedor')
      .select('tipo, monto, estado, vencimiento')
      .eq('tipo', 'cargo')
      .in('estado', ['pendiente', 'vencido']),
    // Avisos fijados por el equipo: son los que alguien marcó a propósito
    // como «esto hay que verlo», a diferencia del resto del tablón que se lee
    // por orden cronológico.
    supabase.from('avisos').select('*', { count: 'exact', head: true }).eq('fijado', true),
    contarConsumosSinFacturar(supabase, hoy),
    contarSaldosPendientes(supabase, hoy),
  ])

  /*
   * Ninguna de las 12 lecturas de arriba revisaba su `error`: si una fallaba,
   * `data`/`count` llegaban en `null`, el `?? 0`/`?? []` de más abajo lo
   * convertía en «no hay nada», y la pantalla lo mostraba idéntico a que
   * estuviera todo en cero. El caso más caro era el conflicto de canal
   * (`conflictosCanal`): con la lectura fallada, la alerta de posible
   * overbooking —la más cara que le puede pasar al hotel— desaparecía sin
   * dejar rastro. Se loguean todas (accesorio: no corta el render, degrada) y
   * la de canal se trata aparte más abajo porque «no se pudo verificar» no es
   * lo mismo que «no hay ninguno».
   */
  registrarFalla(eUnidades, 'dashboard:unidades')
  registrarFalla(eEstadias, 'dashboard:estadias')
  registrarFalla(eActivas, 'dashboard:reservas_activas')
  registrarFalla(eNuevasHoy, 'dashboard:reservas_nuevas_hoy')
  registrarFalla(eCanceladasHoy, 'dashboard:canceladas_hoy')
  registrarFalla(eMant, 'dashboard:mantenimiento_pendiente')
  registrarFalla(eObjetos, 'dashboard:objetos_guardados')
  registrarFalla(eConflictos, 'dashboard:conflictos_canal')
  registrarFalla(eStock, 'dashboard:stock_bajo')
  registrarFalla(eComprobantes, 'dashboard:comprobantes_proveedor')
  registrarFalla(eAvisos, 'dashboard:avisos_fijados')
  registrarFalla(eConsumosSinFacturar, 'dashboard:consumos_sin_facturar')
  registrarFalla(eSaldosPendientes, 'dashboard:saldos_pendientes')

  /** `null` cuando la lectura fallida no puede distinguirse de «no hay ninguno». */
  const kpi = (valor: number | null, huboError: unknown): string =>
    huboError ? '—' : String(valor ?? 0)

  const totalUnidades = unidades?.length ?? 0
  const porEstado = new Map<EstadoHousekeeping, number>()
  for (const u of unidades ?? []) {
    const e = u.estado as EstadoHousekeeping
    porEstado.set(e, (porEstado.get(e) ?? 0) + 1)
  }

  const filas = (estadias ?? []) as unknown as EstadiaDia[]
  const llegadas: EstadiaDia[] = []
  const salidas: EstadiaDia[] = []
  let ocupadasHoy = 0
  for (const e of filas) {
    const p = parsearPeriodo(e.periodo)
    if (hoy >= p.desde && hoy < p.hasta) ocupadasHoy++
    if (p.desde === hoy) llegadas.push(e)
    if (p.hasta === hoy) salidas.push(e)
  }
  const ocupacionPct = totalUnidades ? Math.round((ocupadasHoy / totalUnidades) * 100) : 0

  // La condición vive en el dominio: acá estaba escrita a mano y contaba como
  // faltantes a los servicios (stock null), que no llevan inventario. Por eso
  // el tablero avisaba «4 productos con stock bajo» y Configuración mostraba 0.
  const faltantes = articulosFaltantes(
    (stockBajo ?? []) as { stock: number | null; stock_minimo: number | null; nombre: string }[],
  )

  // Facturas de proveedores que vencen esta semana (o ya vencieron).
  const comprobantesVivos = (comprobantes ?? []) as ComprobanteDeuda[]
  const vencenPronto = porVencer(comprobantesVivos, hoy, 7).length
  const yaVencidos = comprobantesVivos.filter((c) => c.estado === 'vencido').length

  const areas = areasDe(sesion.rol)
  const puede = (a: Area) => areas.includes(a)

  /*
    Lo que pide acción hoy. Cada línea se arma solo si el rol tiene el área
    **y** el número es mayor que cero: un tablero que dice «0 pendientes» en
    cinco filas entrena a no mirarlo.

    El orden es por urgencia real, no por módulo: lo vencido antes que lo que
    vence, y el dinero antes que un paraguas olvidado.
  */
  const pendientes: { href: string; icono: NombreIcono; cantidad: number; texto: string }[] = [
    {
      area: 'proveedores' as Area,
      href: '/panel/proveedores',
      icono: 'proveedores' as NombreIcono,
      cantidad: yaVencidos,
      texto: yaVencidos === 1 ? 'factura de proveedor vencida' : 'facturas de proveedor vencidas',
    },
    {
      area: 'proveedores' as Area,
      href: '/panel/proveedores',
      icono: 'proveedores' as NombreIcono,
      cantidad: vencenPronto,
      texto: 'por vencer esta semana',
    },
    {
      area: 'reservas' as Area,
      href: '/panel/reservas',
      icono: 'divisas' as NombreIcono,
      cantidad: saldosPendientes,
      texto:
        saldosPendientes === 1
          ? 'reserva con saldo pendiente de cobro'
          : 'reservas con saldo pendiente de cobro',
    },
    {
      area: 'reservas' as Area,
      href: '/panel/reservas',
      icono: 'reservas' as NombreIcono,
      cantidad: consumosSinFacturar,
      texto:
        consumosSinFacturar === 1
          ? 'cuenta con consumos sin facturar'
          : 'cuentas con consumos sin facturar',
    },
    {
      area: 'mantenimiento' as Area,
      href: '/panel/mantenimiento',
      icono: 'mantenimiento' as NombreIcono,
      cantidad: mantPendiente ?? 0,
      texto: mantPendiente === 1 ? 'orden de mantenimiento abierta' : 'órdenes de mantenimiento abiertas',
    },
    {
      area: 'config' as Area,
      href: '/panel/config',
      icono: 'config' as NombreIcono,
      cantidad: faltantes.length,
      texto: faltantes.length === 1 ? 'artículo con stock bajo' : 'artículos con stock bajo',
    },
    {
      area: 'objetos_perdidos' as Area,
      href: '/panel/objetos-perdidos',
      icono: 'objetos' as NombreIcono,
      cantidad: objetosGuardados ?? 0,
      texto: objetosGuardados === 1 ? 'objeto perdido guardado' : 'objetos perdidos guardados',
    },
    {
      area: 'avisos' as Area,
      href: '/panel/avisos',
      icono: 'avisos' as NombreIcono,
      cantidad: avisosFijados ?? 0,
      texto: avisosFijados === 1 ? 'aviso fijado por el equipo' : 'avisos fijados por el equipo',
    },
  ]
    .filter((p) => p.cantidad > 0 && puede(p.area))
    .map(({ href, icono, cantidad, texto }) => ({ href, icono, cantidad, texto }))

  return (
    <Pagina>
      <Encabezado
        titulo={`Buen día, ${sesion.nombre.split(' ')[0]}`}
        descripcion={`Panorama del hotel · ${formatoFechaCorta(hoy)}`}
        icono="inicio"
        acciones={
          puede('reservas') ? (
            <>
              <Link href="/panel/ocupacion" className={botonClases('secundario')}>
                Ver ocupación
              </Link>
              <Link href="/panel/reservas/nueva" className={botonClases('primario')}>
                <Icono nombre="mas" tam={16} />
                Nueva reserva
              </Link>
            </>
          ) : null
        }
      />

      {/* El asistente de IA en un clic, para quien lo usa y si está configurado. */}
      {puede('ia') && iaActiva() && <ConsultasRapidasIA />}

      {atrasados.length > 0 && (
        <Mensaje tono="error">
          {atrasados.length === 1
            ? 'Una tarea automática no corre hace demasiado: '
            : `${atrasados.length} tareas automáticas no corren hace demasiado: `}
          {atrasados
            .map((c) => (c.ultimaOk ? `${c.etiqueta} (última: ${fechaHoraHotel(c.ultimaOk)})` : `${c.etiqueta} (nunca)`))
            .join(' · ')}
          . Revisá la configuración de los cron en Vercel (y la variable CRON_SECRET).
        </Mensaje>
      )}

      {(eUnidades || eEstadias) && (
        <Mensaje tono="error">
          No se pudo leer el estado de las unidades ni la ocupación en este momento. Los números de
          abajo pueden estar incompletos — actualizá la página, y si sigue así avisá al administrador.
        </Mensaje>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          titulo="Ocupación hoy"
          valor={`${ocupacionPct}%`}
          detalle={`${ocupadasHoy} de ${totalUnidades} unidades`}
          icono="ocupacion"
          href={puede('ocupacion') ? '/panel/ocupacion' : undefined}
        />
        <Kpi
          titulo="Llegadas hoy"
          valor={String(llegadas.length)}
          detalle="check-in previstos"
          icono="reservas"
          tono="exito"
        />
        <Kpi
          titulo="Salidas hoy"
          valor={String(salidas.length)}
          detalle="check-out previstos"
          icono="salir"
          tono="alerta"
        />
        <Kpi
          titulo="Reservas activas"
          valor={kpi(reservasActivas, eActivas)}
          // No es "en curso": cuenta ESTADOS_ACTIVOS (pendiente + confirmada +
          // pagada + in_house), el mismo criterio del motor anti-overbooking
          // (`ocupaInventario`) — reservas que TIENEN una unidad tomada, aunque
          // el huésped todavía no haya llegado. "En curso" hacía pensar que las
          // dos de hoy eran huéspedes alojados en este momento.
          detalle="ocupan una unidad"
          icono="reservas"
          href={puede('reservas') ? '/panel/reservas' : undefined}
        />
        <Kpi
          titulo="Nuevas hoy"
          valor={kpi(reservasNuevasHoy, eNuevasHoy)}
          detalle="reservas cargadas hoy"
          icono="reservas"
          tono="exito"
          href={puede('reservas') ? '/panel/reservas' : undefined}
        />
        <Kpi
          titulo="Canceladas hoy"
          valor={kpi(canceladasHoy, eCanceladasHoy)}
          detalle="bajas de hoy"
          icono="reservas"
          tono={(canceladasHoy ?? 0) > 0 ? 'alerta' : undefined}
          href={puede('reservas') ? '/panel/reservas' : undefined}
        />
      </div>

      {/*
        Alertas: aparecen cuando hay algo que atender, O cuando una lectura
        falló y no se puede saber si hay algo que atender. Sin `eConflictos`
        acá, el aviso de «no se pudo verificar overbooking» de más abajo
        nunca llegaba a renderizarse: este `if` de afuera lo tapaba primero.
      */}
      {((mantPendiente ?? 0) > 0 ||
        (objetosGuardados ?? 0) > 0 ||
        faltantes.length > 0 ||
        vencenPronto > 0 ||
        yaVencidos > 0 ||
        eConflictos ||
        eStock ||
        eComprobantes) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(eStock || eComprobantes) && puede('proveedores') && (
            <span className="inline-flex items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-700 ring-1 ring-stone-200">
              <Icono nombre="alerta" tam={16} />
              No se pudo revisar el stock ni los vencimientos de proveedores en este momento
            </span>
          )}
          {(vencenPronto > 0 || yaVencidos > 0) && puede('proveedores') && (
            <Link
              href="/panel/proveedores"
              className="inline-flex items-center gap-2 rounded-xl bg-lenga-50 px-3 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200 transition hover:bg-lenga-100"
            >
              <Icono nombre="proveedores" tam={16} />
              {yaVencidos > 0 && `${yaVencidos} factura(s) vencida(s)`}
              {yaVencidos > 0 && vencenPronto > 0 && ' · '}
              {vencenPronto > 0 && `${vencenPronto} vence(n) esta semana`}
            </Link>
          )}
          {(mantPendiente ?? 0) > 0 && puede('mantenimiento') && (
            <Link
              href="/panel/mantenimiento"
              className="inline-flex items-center gap-2 rounded-xl bg-lenga-50 px-3 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200 transition hover:bg-lenga-100"
            >
              <Icono nombre="mantenimiento" tam={16} />
              {mantPendiente} orden(es) de mantenimiento sin resolver
            </Link>
          )}
          {/*
            El posible overbooking va en el hub y no solo en la pantalla de canales
            porque es lo más caro que le puede pasar al hotel y hay que verlo sin ir a
            buscarlo. En tono de peligro, no del gris de los demás avisos.

            Si la lectura falló, NO se trata como «cero conflictos»: eso sería
            justo el fallo silencioso más caro posible acá. Se avisa que no se
            pudo verificar, en el mismo tono de peligro, en vez de ocultar la
            alerta como si no hubiera nada que mirar.
          */}
          {eConflictos && puede('canales') && (
            <Link
              href="/panel/canales"
              className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-200 transition hover:bg-red-100"
            >
              <Icono nombre="alerta" tam={16} />
              No se pudo verificar si hay conflictos de canal — revisá Canales a mano
            </Link>
          )}
          {!eConflictos && (conflictosCanal ?? 0) > 0 && puede('canales') && (
            <Link
              href="/panel/canales"
              className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-200 transition hover:bg-red-100"
            >
              <Icono nombre="alerta" tam={16} />
              {conflictosCanal} reserva(s) de canal con posible overbooking
            </Link>
          )}
          {(objetosGuardados ?? 0) > 0 && puede('objetos_perdidos') && (
            <Link
              href="/panel/objetos-perdidos"
              className="inline-flex items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-700 ring-1 ring-stone-200 transition hover:bg-stone-200"
            >
              <Icono nombre="objetos" tam={16} />
              {objetosGuardados} objeto(s) en depósito
            </Link>
          )}
          {faltantes.length > 0 && puede('config') && (
            <Link
              href="/panel/config"
              className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200 transition hover:bg-red-100"
            >
              <Icono nombre="alerta" tam={16} />
              {faltantes.length} producto(s) con stock bajo
            </Link>
          )}
        </div>
      )}

      {/* Movimientos del día: lo que recepción necesita a mano. */}
      {puede('reservas') && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Tarjeta titulo="Llegadas de hoy" descripcion="Check-in previstos">
            {llegadas.length === 0 ? (
              <EstadoVacio titulo="Sin llegadas para hoy" icono="reservas" />
            ) : (
              <ul>
                {llegadas.map((e, i) => (
                  <FilaMovimiento key={`${e.reserva?.id}-${i}`} e={e} />
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta titulo="Salidas de hoy" descripcion="Check-out previstos">
            {salidas.length === 0 ? (
              <EstadoVacio titulo="Sin salidas para hoy" icono="salir" />
            ) : (
              <ul>
                {salidas.map((e, i) => (
                  <FilaMovimiento key={`${e.reserva?.id}-${i}`} e={e} />
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Cotización y estado de unidades comparten columna: los dos son datos
            de referencia que recepción consulta de un vistazo, no listados.
            El widget va en Suspense porque puede tardar hasta 3 s si la fuente
            externa está lenta, y el resto del dashboard no tiene por qué esperarlo. */}
        <div className="space-y-4 lg:col-span-1">
          <Suspense fallback={<WidgetCotizacionCargando />}>
            <WidgetCotizacion />
          </Suspense>

          <Tarjeta titulo="Estado de las unidades">
            <ul className="px-5 py-3">
              {ESTADOS_HK.map((estado) => (
                <li key={estado} className="flex items-center gap-2.5 py-1.5">
                  <EstadoUnidad estado={estado} />
                  <span className="tabular w-8 text-lg font-semibold text-stone-900">
                    {porEstado.get(estado) ?? 0}
                  </span>
                  <span className="text-sm text-stone-500">{ETIQUETAS_ESTADO_HK[estado]}</span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>

        {/*
          Antes acá había una grilla «Módulos» que repetía, uno por uno, los
          mismos enlaces del menú lateral. Ocupaba dos tercios del ancho para no
          decir nada nuevo, y empujaba abajo del pliegue el estado de las
          unidades, que sí es información.

          Lo único que aportaba eran dos contadores —mantenimiento pendiente y
          objetos guardados— colgados como insignias. Eso es lo que queda, pero
          al revés: en vez de un menú con números, una lista de lo que **pide
          acción**, donde cada línea existe solo si hay algo que hacer. Si no
          hay nada, lo dice y no ocupa lugar.
        */}
        <Tarjeta
          titulo="Requiere atención"
          descripcion="Solo lo que tiene algo pendiente"
          className="lg:col-span-2"
        >
          {pendientes.length === 0 ? (
            <EstadoVacio titulo="No hay nada pendiente" icono="ayuda" />
          ) : (
            <ul className="p-4">
              {pendientes.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition hover:bg-lago-50"
                  >
                    <span className="text-lago-600">
                      <Icono nombre={p.icono} tam={17} />
                    </span>
                    <span className="tabular w-8 shrink-0 text-lg font-semibold text-stone-900">
                      {p.cantidad}
                    </span>
                    <span className="min-w-0 flex-1 text-stone-700">{p.texto}</span>
                    <span aria-hidden="true" className="text-stone-600">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </Pagina>
  )
}
