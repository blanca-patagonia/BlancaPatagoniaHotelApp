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

  const { data, count } = await consulta.range(desde, hasta)
  const registros = (data ?? []) as Registro[]
  const total = count ?? 0

  // Los nombres del staff se resuelven con el cliente privilegiado porque un
  // registro puede referir a un usuario dado de baja.
  const admin = crearClienteAdmin()
  const { data: perfiles } = await admin.from('perfiles').select('id, nombre')
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
        <p className="ml-auto text-xs text-stone-400">
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
                        {new Date(r.creado_en).toLocaleString('es-AR')}
                      </td>
                      <td className={`${TD} text-stone-700`}>
                        {r.usuario_id ? (nombres.get(r.usuario_id) ?? 'Usuario dado de baja') : 'Sistema'}
                        {r.rol && (
                          <span className="ml-1.5 text-xs text-stone-400">
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
                          <span className="text-stone-400">
                            {r.accion === 'INSERT' ? 'alta del registro' : 'baja del registro'}
                          </span>
                        ) : (
                          <ul className="flex flex-col gap-0.5">
                            {cambios.slice(0, 4).map((c) => (
                              <li key={c.campo}>
                                <span className="text-stone-500">{c.campo}: </span>
                                <span className="text-stone-400 line-through">{c.antes}</span>
                                <span className="text-stone-400"> → </span>
                                <span className="font-medium text-stone-800">{c.despues}</span>
                              </li>
                            ))}
                            {cambios.length > 4 && (
                              <li className="text-stone-400">y {cambios.length - 4} campo(s) más</li>
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
    </div>
  )
}
