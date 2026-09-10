import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { ETIQUETAS_ROL, type Rol } from '@/lib/domain/roles'
import { construirQuery, paginaActual, rangoDePagina } from '@/lib/listados'
import {
  BarraHerramientas,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Paginacion,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  type Tono,
} from '../_components/ui'
import { fechaHoraHotel } from '@/lib/fechas'
import { registrarFalla } from '@/lib/acciones'

/** Tablas auditadas (las que tienen trigger en la migración 0020). */
const TABLAS = ['pagos', 'tarifas', 'reservas'] as const
type TablaAuditada = (typeof TABLAS)[number]

const ETIQUETAS_TABLA: Record<TablaAuditada, string> = {
  pagos: 'Pagos',
  tarifas: 'Tarifas',
  reservas: 'Reservas',
}

const TONO_ACCION: Record<string, Tono> = {
  INSERT: 'exito',
  UPDATE: 'lago',
  DELETE: 'peligro',
}

const ETIQUETAS_ORIGEN_ACCESO: Record<string, string> = {
  ficha_huesped: 'Ficha del huésped',
  ficha_reserva: 'Ficha de una reserva',
}

interface AccesoHuesped {
  id: number
  usuario_id: string | null
  rol: Rol | null
  origen: string
  creado_en: string
  huesped: { apellido: string; nombre: string } | null
}

interface Registro {
  id: number
  tabla: string
  registro_id: string | null
  accion: string
  usuario_id: string | null
  rol: Rol | null
  datos_previos: Record<string, unknown> | null
  datos_nuevos: Record<string, unknown> | null
  creado_en: string
}

/**
 * Resume el cambio mostrando solo los campos que efectivamente se modificaron.
 *
 * Volcar la fila entera sería ilegible: lo que importa es «precio_rack: 270 → 999».
 */
function camposCambiados(r: Registro): { campo: string; antes: string; despues: string }[] {
  if (!r.datos_previos || !r.datos_nuevos) return []
  const cambios: { campo: string; antes: string; despues: string }[] = []

  for (const clave of Object.keys(r.datos_nuevos)) {
    const antes = r.datos_previos[clave]
    const despues = r.datos_nuevos[clave]
    if (JSON.stringify(antes) !== JSON.stringify(despues)) {
      cambios.push({ campo: clave, antes: String(antes ?? '—'), despues: String(despues ?? '—') })
    }
  }
  return cambios
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ tabla?: string; pagina?: string }>
}) {
  await requerirAcceso('auditoria')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const tabla = (TABLAS as readonly string[]).includes(sp.tabla ?? '')
    ? (sp.tabla as TablaAuditada)
    : undefined

  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)

  let consulta = supabase
    .from('auditoria')
    .select('*', { count: 'exact' })
    .order('id', { ascending: false })
  if (tabla) consulta = consulta.eq('tabla', tabla)

  const { data, error: eAuditoria, count } = await consulta.range(desde, hasta)
  registrarFalla(eAuditoria, 'auditoria:listado')
  const registros = (data ?? []) as Registro[]
  const total = count ?? 0

  // Quién ABRIÓ una ficha de huésped (migración 0091). Es un registro aparte de
  // `auditoria`: un SELECT no dispara triggers, así que esto lo escribe la
  // propia pantalla al mostrarse, no la base. Solo los últimos 20: es para
  // detectar un patrón raro, no para paginar un historial completo.
  const { data: accesosData, error: eAccesos } = await supabase
    .from('auditoria_accesos')
    .select('id, usuario_id, rol, origen, creado_en, huesped:huespedes(apellido, nombre)')
    .order('id', { ascending: false })
    .limit(20)
  registrarFalla(eAccesos, 'auditoria:accesos')
  const accesos = (accesosData ?? []) as unknown as AccesoHuesped[]

  // Los nombres del staff se resuelven con el cliente privilegiado porque un
  // registro puede referir a un usuario dado de baja.
  const admin = crearClienteAdmin()
  const { data: perfiles, error: ePerfiles } = await admin.from('perfiles').select('id, nombre')
  registrarFalla(ePerfiles, 'auditoria:perfiles')
  const nombres = new Map(
    ((perfiles ?? []) as { id: string; nombre: string }[]).map((p) => [p.id, p.nombre]),
  )

  const filtros = { tabla }

  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado
        titulo="Auditoría"
        descripcion="Quién cambió qué y cuándo en las operaciones sensibles."
        icono="auditoria"
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi titulo="Registros" valor={String(total)} detalle="en el filtro actual" icono="auditoria" />
        {TABLAS.map((t) => (
          <Kpi
            key={t}
            titulo={ETIQUETAS_TABLA[t]}
            valor={t === tabla ? String(total) : '—'}
            detalle="ver solo esta tabla"
            icono={t === 'pagos' ? 'agencias' : t === 'tarifas' ? 'config' : 'reservas'}
            href={`/panel/auditoria${construirQuery(filtros, { tabla: t, pagina: undefined })}`}
          />
        ))}
      </div>

      <BarraHerramientas>
        <div className="flex flex-wrap gap-1.5">
          <Chip href={`/panel/auditoria${construirQuery(filtros, { tabla: undefined })}`} activo={!tabla}>
            Todas
          </Chip>
          {TABLAS.map((t) => (
            <Chip
              key={t}
              href={`/panel/auditoria${construirQuery(filtros, { tabla: t, pagina: undefined })}`}
              activo={tabla === t}
            >
              {ETIQUETAS_TABLA[t]}
            </Chip>
          ))}
        </div>
        {tabla && (
          <Link href="/panel/auditoria" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
        <p className="ml-auto text-xs text-stone-600">
          Registro de solo lectura: ni el staff puede editarlo.
        </p>
      </BarraHerramientas>

      <Tarjeta className="overflow-hidden">
        {registros.length === 0 ? (
          <EstadoVacio
            titulo="Sin movimientos registrados"
            descripcion="Se registran los cambios en pagos, tarifas y estados de reserva."
            icono="auditoria"
          />
        ) : (
          <>
            <Tabla resumen="Registro de cambios con fecha, usuario, tabla y campos modificados">
              <thead>
                <tr>
                  <th className={TH}>Fecha</th>
                  <th className={TH}>Usuario</th>
                  <th className={TH}>Tabla</th>
                  <th className={TH}>Acción</th>
                  <th className={TH}>Cambios</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => {
                  const cambios = camposCambiados(r)
                  return (
                    <tr key={r.id} className={FILA}>
                      <td className={`${TD} tabular whitespace-nowrap text-stone-500`}>
                        {fechaHoraHotel(r.creado_en)}
                      </td>
                      <td className={`${TD} text-stone-700`}>
                        {r.usuario_id ? (nombres.get(r.usuario_id) ?? 'Usuario dado de baja') : 'Sistema'}
                        {r.rol && (
                          <span className="ml-1.5 text-xs text-stone-600">
                            {ETIQUETAS_ROL[r.rol]}
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-stone-600`}>
                        {ETIQUETAS_TABLA[r.tabla as TablaAuditada] ?? r.tabla}
                      </td>
                      <td className={TD}>
                        <Etiqueta tono={TONO_ACCION[r.accion] ?? 'neutro'}>{r.accion}</Etiqueta>
                      </td>
                      <td className={`${TD} text-xs`}>
                        {cambios.length === 0 ? (
                          <span className="text-stone-600">
                            {r.accion === 'INSERT' ? 'alta del registro' : 'baja del registro'}
                          </span>
                        ) : (
                          <ul className="flex flex-col gap-0.5">
                            {cambios.slice(0, 4).map((c) => (
                              <li key={c.campo}>
                                <span className="text-stone-500">{c.campo}: </span>
                                <span className="text-stone-600 line-through">{c.antes}</span>
                                <span className="text-stone-600"> → </span>
                                <span className="font-medium text-stone-800">{c.despues}</span>
                              </li>
                            ))}
                            {cambios.length > 4 && (
                              <li className="text-stone-600">y {cambios.length - 4} campo(s) más</li>
                            )}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabla>
            <Paginacion base="/panel/auditoria" params={filtros} pagina={pagina} total={total} />
          </>
        )}
      </Tarjeta>

      {/*
        Quién LEYÓ un dato de huésped, no quién lo cambió. Va en tarjeta aparte
        porque es información distinta: la de arriba es un registro completo y
        paginado, esta es «los últimos 20 accesos», para notar algo raro (un rol
        que abre fichas que no tiene por qué mirar), no para auditar uno por uno.
      */}
      <Tarjeta
        className="mt-6 overflow-hidden"
        titulo="Accesos recientes a fichas de huéspedes"
        descripcion="Quién abrió qué ficha, aunque no haya cambiado nada."
      >
        {accesos.length === 0 ? (
          <EstadoVacio
            titulo="Sin accesos registrados todavía"
            descripcion="Se registra cada vez que alguien abre la ficha de un huésped o de una de sus reservas."
            icono="huespedes"
          />
        ) : (
          <Tabla resumen="Últimos accesos a fichas de huéspedes, con fecha, usuario y origen">
            <thead>
              <tr>
                <th className={TH}>Fecha</th>
                <th className={TH}>Usuario</th>
                <th className={TH}>Huésped</th>
                <th className={TH}>Desde</th>
              </tr>
            </thead>
            <tbody>
              {accesos.map((a) => (
                <tr key={a.id} className={FILA}>
                  <td className={`${TD} tabular whitespace-nowrap text-stone-500`}>
                    {fechaHoraHotel(a.creado_en)}
                  </td>
                  <td className={`${TD} text-stone-700`}>
                    {a.usuario_id ? (nombres.get(a.usuario_id) ?? 'Usuario dado de baja') : 'Sistema'}
                    {a.rol && (
                      <span className="ml-1.5 text-xs text-stone-600">{ETIQUETAS_ROL[a.rol]}</span>
                    )}
                  </td>
                  <td className={`${TD} text-stone-700`}>
                    {a.huesped ? `${a.huesped.apellido}, ${a.huesped.nombre}` : '—'}
                  </td>
                  <td className={`${TD} text-stone-600`}>
                    {ETIQUETAS_ORIGEN_ACCESO[a.origen] ?? a.origen}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
    </div>
  )
}
