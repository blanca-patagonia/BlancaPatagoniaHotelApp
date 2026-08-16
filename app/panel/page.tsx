import { Suspense } from 'react'
import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_ACTIVOS, ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { ETIQUETAS_ESTADO_HK, ESTADOS_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { hoyISO, parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'
import { porVencer, type ComprobanteDeuda } from '@/lib/domain/antiguedad'
import { faltantes as articulosFaltantes } from '@/lib/domain/inventario'
import { areasDe, estaOculta, type Area } from '@/lib/domain/permisos'
import { TONO_ESTADO } from './_components/estilos'
import { Icono, type NombreIcono } from './_components/iconos'
import { WidgetCotizacion, WidgetCotizacionCargando } from './_components/cotizacion'
import {
  Encabezado,
  EstadoUnidad,
  EstadoVacio,
  Etiqueta,
  Kpi,
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
      <span className="min-w-0 flex-1">
        <span className="font-medium text-stone-800">
          {r?.huesped ? `${r.huesped.apellido}, ${r.huesped.nombre}` : 'Sin huésped'}
        </span>
        <span className="ml-2 text-xs text-stone-600">{e.unidad?.nombre}</span>
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

export default async function DashboardPage() {
  const sesion = await requerirAcceso('dashboard')
  const supabase = await crearClienteServidor()
  const hoy = hoyISO()

  const [
    { data: unidades },
    { data: estadias },
    { count: reservasActivas },
    { count: mantPendiente },
    { count: objetosGuardados },
    { data: stockBajo },
    { data: comprobantes },
  ] = await Promise.all([
    supabase.from('unidades').select('estado').eq('activo', true),
    supabase
      .from('estadias')
      .select(
        'periodo, unidad:unidades(nombre), reserva:reservas(id, codigo, estado, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre))',
      )
      .in('estado', [...ESTADOS_ACTIVOS]),
    supabase.from('reservas').select('*', { count: 'exact', head: true }).in('estado', [...ESTADOS_ACTIVOS]),
    supabase
      .from('ordenes_mantenimiento')
      .select('*', { count: 'exact', head: true })
      .in('estado', ['pendiente', 'en_proceso']),
    // Si el módulo está apagado (`AREAS_OCULTAS`), nadie va a ver este número y la
    // consulta sería un viaje a la base de más en la pantalla que más se abre.
    estaOculta('objetos_perdidos')
      ? Promise.resolve({ count: 0 })
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
  ])

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
                + Nueva reserva
              </Link>
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          valor={String(reservasActivas ?? 0)}
          detalle="en curso"
          icono="reservas"
          href={puede('reservas') ? '/panel/reservas' : undefined}
        />
      </div>

      {/* Alertas: solo aparecen cuando hay algo que atender. */}
      {((mantPendiente ?? 0) > 0 ||
        (objetosGuardados ?? 0) > 0 ||
        faltantes.length > 0 ||
        vencenPronto > 0 ||
        yaVencidos > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
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
