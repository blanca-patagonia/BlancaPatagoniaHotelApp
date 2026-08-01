import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_ACTIVOS, ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { ETIQUETAS_ESTADO_HK, ESTADOS_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { hoyISO, parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'
import { areasDe, ETIQUETAS_AREA, type Area } from '@/lib/domain/permisos'
import { PUNTO_HK, TONO_ESTADO } from './_components/estilos'
import { Icono, type NombreIcono } from './_components/iconos'
import {
  Encabezado,
  EstadoVacio,
  Etiqueta,
  Kpi,
  Tarjeta,
  botonClases,
} from './_components/ui'

/** Ruta e icono de cada módulo, para la grilla de accesos rápidos. */
const MODULOS: Record<Area, { href: string; icono: NombreIcono }> = {
  dashboard: { href: '/panel', icono: 'inicio' },
  ocupacion: { href: '/panel/ocupacion', icono: 'ocupacion' },
  reservas: { href: '/panel/reservas', icono: 'reservas' },
  huespedes: { href: '/panel/huespedes', icono: 'huespedes' },
  housekeeping: { href: '/panel/housekeeping', icono: 'housekeeping' },
  mantenimiento: { href: '/panel/mantenimiento', icono: 'mantenimiento' },
  objetos_perdidos: { href: '/panel/objetos-perdidos', icono: 'objetos' },
  avisos: { href: '/panel/avisos', icono: 'avisos' },
  agencias: { href: '/panel/agencias', icono: 'agencias' },
  proveedores: { href: '/panel/proveedores', icono: 'proveedores' },
  reportes: { href: '/panel/reportes', icono: 'reportes' },
  config: { href: '/panel/config', icono: 'config' },
  usuarios: { href: '/panel/usuarios', icono: 'usuarios' },
}

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
        <span className="ml-2 text-xs text-stone-400">{e.unidad?.nombre}</span>
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
    supabase.from('objetos_perdidos').select('*', { count: 'exact', head: true }).eq('estado', 'guardado'),
    supabase.from('productos_servicios').select('nombre, stock, stock_minimo').eq('activo', true),
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

  const faltantes = (stockBajo ?? []).filter(
    (p) => Number(p.stock ?? 0) <= Number(p.stock_minimo ?? 0),
  )

  const areas = areasDe(sesion.rol)
  const puede = (a: Area) => areas.includes(a)

  return (
    <div className="mx-auto max-w-6xl">
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
      {((mantPendiente ?? 0) > 0 || (objetosGuardados ?? 0) > 0 || faltantes.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
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
        <Tarjeta titulo="Estado de las unidades" className="lg:col-span-1">
          <ul className="px-5 py-3">
            {ESTADOS_HK.map((estado) => (
              <li key={estado} className="flex items-center gap-2.5 py-1.5">
                <span className={`size-2.5 rounded-full ${PUNTO_HK[estado]}`} aria-hidden="true" />
                <span className="tabular w-8 text-lg font-semibold text-stone-900">
                  {porEstado.get(estado) ?? 0}
                </span>
                <span className="text-sm text-stone-500">{ETIQUETAS_ESTADO_HK[estado]}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>

        <Tarjeta titulo="Módulos" descripcion="Accesos según tu rol" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
            {areas
              .filter((a) => a !== 'dashboard')
              .map((a) => {
                const badge =
                  a === 'mantenimiento'
                    ? (mantPendiente ?? 0)
                    : a === 'objetos_perdidos'
                      ? (objetosGuardados ?? 0)
                      : null
                return (
                  <Link
                    key={a}
                    href={MODULOS[a].href}
                    className="flex items-center gap-2.5 rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-700 transition hover:border-lago-300 hover:bg-lago-50 hover:text-lago-900"
                  >
                    <span className="text-lago-600">
                      <Icono nombre={MODULOS[a].icono} tam={17} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{ETIQUETAS_AREA[a]}</span>
                    {badge != null && badge > 0 && (
                      <span className="tabular rounded-full bg-lenga-100 px-1.5 py-0.5 text-xs font-semibold text-lenga-800">
                        {badge}
                      </span>
                    )}
                  </Link>
                )
              })}
          </div>
        </Tarjeta>
      </div>
    </div>
  )
}
