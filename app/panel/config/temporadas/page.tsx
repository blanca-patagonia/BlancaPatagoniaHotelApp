import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { hoyISO, sumarDias, formatoFechaCorta } from '@/lib/fechas'
import {
  parsearRango,
  huecosDeCobertura,
  tieneCobertura,
  cubiertoHasta,
  diasDelRango,
  type RangoTemporada,
} from '@/lib/domain/temporadas'
import {
  CAMPO,
  Campo,
  COL_SECUNDARIA,
  Encabezado,
  EstadoVacio,
  Etiqueta,
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
import { agregarRango, quitarRango } from './actions'

/** Un año vista: lo que le interesa a quien vende. */
const HORIZONTE_DIAS = 365

interface Temporada {
  id: string
  codigo: string
  nombre: string
  orden: number
}

interface RangoFila {
  id: string
  rango: string
  temporada_id: string
}

const MENSAJES_ERROR: Record<string, string> = {
  temporada: 'Elegí a qué temporada corresponde el período.',
  fechas: 'Revisá las fechas: la de fin tiene que ser posterior a la de inicio.',
  solape:
    'Ese período pisa a otro que ya está cargado. Una fecha pertenece a una sola temporada: quitá el período que se superpone y volvé a intentarlo.',
  guardar: 'No se pudo guardar el período.',
  borrar: 'No se pudo quitar el período.',
}

const TONO_TEMPORADA: Record<string, 'exito' | 'alerta' | 'peligro' | 'neutro'> = {
  baja: 'exito',
  media: 'alerta',
  alta: 'peligro',
}

/**
 * Calendario de temporadas.
 *
 * Esta pantalla faltaba, y su ausencia causó un error caro: los rangos cargados
 * terminaban en junio de 2026, el hotel siguió operando, y al reservar para
 * agosto el sistema mostraba «USD 0» sin explicar nada. El tarifario estaba
 * completo; lo que faltaba era decirle a qué fechas aplicaba cada temporada, y
 * no había forma de verlo ni corregirlo desde la interfaz.
 *
 * Por eso lo primero que se muestra no es la lista de períodos sino **hasta
 * cuándo se puede vender**: el dato que evita que el problema vuelva a
 * descubrirse recién cuando un huésped intenta reservar.
 */
export default async function TemporadasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const supabase = await crearClienteServidor()

  const [{ data: temporadasData }, { data: rangosData }] = await Promise.all([
    supabase.from('temporadas').select('id, codigo, nombre, orden').order('orden'),
    supabase.from('temporada_rangos').select('id, rango, temporada_id'),
  ])

  const temporadas = (temporadasData ?? []) as Temporada[]
  const filas = (rangosData ?? []) as RangoFila[]
  const nombreTemporada = new Map(temporadas.map((t) => [t.id, t]))

  // Se ordenan por fecha de inicio: en la base no hay orden garantizado.
  const periodos = filas
    .map((f) => ({ ...f, ...parsearRango(f.rango) }))
    .sort((a, b) => a.desde.localeCompare(b.desde))

  const rangos: RangoTemporada[] = periodos.map((p) => ({ desde: p.desde, hasta: p.hasta }))

  const hoy = hoyISO()
  const horizonte = sumarDias(hoy, HORIZONTE_DIAS)
  const huecos = huecosDeCobertura(rangos, hoy, horizonte)
  const hoyCubierto = tieneCobertura(rangos, hoy)
  const vendibleHasta = cubiertoHasta(rangos, hoy)
  const diasSinCubrir = huecos.reduce((a, h) => a + h.dias, 0)

  return (
    <Pagina>
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Temporadas"
        descripcion="A qué fechas corresponde cada temporada. De acá sale la tarifa que se aplica a una reserva."
        icono="config"
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'Ocurrió un error.'}</Mensaje>}
      {sp.ok === 'agregado' && <Mensaje tono="ok">Período agregado.</Mensaje>}
      {sp.ok === 'quitado' && (
        <Mensaje tono="ok">
          Período quitado. Esas fechas quedaron sin temporada: no se van a poder cotizar.
        </Mensaje>
      )}

      {/* Lo primero: si hoy no se puede vender, hay que enterarse acá y no
          cuando un huésped intente reservar. */}
      {!hoyCubierto && (
        <Mensaje tono="error">
          <span className="block font-medium">Hoy no se puede cotizar ninguna reserva.</span>
          La fecha de hoy ({formatoFechaCorta(hoy)}) no pertenece a ninguna temporada, así que el
          sistema no sabe qué tarifa aplicar. Cargá el período que falta con el formulario de más
          abajo.
        </Mensaje>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi
          titulo="Se puede vender hasta"
          valor={vendibleHasta ? formatoFechaCorta(vendibleHasta) : '—'}
          detalle={vendibleHasta ? 'sin interrupciones desde hoy' : 'hoy ya está descubierto'}
          icono="reservas"
          tono={vendibleHasta ? 'exito' : 'peligro'}
        />
        <Kpi
          titulo="Días sin temporada"
          valor={String(diasSinCubrir)}
          detalle="en los próximos 12 meses"
          icono="alerta"
          tono={diasSinCubrir > 0 ? 'peligro' : 'exito'}
        />
        <Kpi
          titulo="Períodos cargados"
          valor={String(periodos.length)}
          detalle="en total"
          icono="config"
        />
      </div>

      {huecos.length > 0 && (
        <div className="mb-4">
          <Tarjeta
            titulo="Fechas sin temporada"
            descripcion="En estos tramos el sistema no puede calcular precios. Una reserva que los toque no se va a poder cotizar."
          >
            <ul className="flex flex-col gap-2 p-5">
              {huecos.map((h) => (
                <li
                  key={h.desde}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-200"
                >
                  <span className="text-red-900">
                    Del <strong>{formatoFechaCorta(h.desde)}</strong> al{' '}
                    <strong>{formatoFechaCorta(sumarDias(h.hasta, -1))}</strong>
                  </span>
                  <span className="tabular text-sm text-red-700">
                    {h.dias} {h.dias === 1 ? 'día' : 'días'}
                  </span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>
      )}

      {puedeEditar && (
        <div className="mb-4">
          <Tarjeta
            titulo="Agregar un período"
            descripcion="Una fecha pertenece a una sola temporada: los períodos no se pueden superponer."
          >
            <form action={agregarRango} className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-4">
              <Campo etiqueta="Temporada" requerido>
                <select name="temporada_id" required defaultValue="" className={CAMPO}>
                  <option value="" disabled>
                    Elegir…
                  </option>
                  {temporadas.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Desde" requerido>
                <input type="date" name="desde" required className={CAMPO} />
              </Campo>
              <Campo etiqueta="Hasta" requerido ayuda="Este día ya NO entra en el período.">
                <input type="date" name="hasta" required className={CAMPO} />
              </Campo>
              <div className="flex items-end">
                <BotonEnvio extra="w-full" cargando="Agregando…">
                  Agregar
                </BotonEnvio>
              </div>
            </form>
          </Tarjeta>
        </div>
      )}

      <Tarjeta
        titulo="Períodos cargados"
        descripcion="Ordenados por fecha de inicio."
        className="overflow-hidden"
      >
        {periodos.length === 0 ? (
          <EstadoVacio
            titulo="Todavía no hay períodos cargados"
            descripcion="Sin períodos, ninguna reserva se puede cotizar: el sistema no sabe qué tarifa aplicar a cada fecha."
            icono="config"
          />
        ) : (
          <Tabla resumen="Períodos de cada temporada con sus fechas de inicio y fin">
            <thead>
              <tr>
                <th className={TH}>Temporada</th>
                <th className={TH}>Desde</th>
                <th className={TH}>Hasta</th>
                <th className={`${TH} ${COL_SECUNDARIA} text-right`}>Días</th>
                {puedeEditar && <th className={TH}></th>}
              </tr>
            </thead>
            <tbody>
              {periodos.map((p) => {
                const t = nombreTemporada.get(p.temporada_id)
                const vigente = p.desde <= hoy && hoy < p.hasta
                // El fin está excluido: el último día del período es el anterior.
                const ultimoDia = sumarDias(p.hasta, -1)
                return (
                  <tr key={p.id} className={FILA}>
                    <td className={TD}>
                      <Etiqueta tono={TONO_TEMPORADA[t?.codigo ?? ''] ?? 'neutro'}>
                        {t?.nombre ?? 'Sin temporada'}
                      </Etiqueta>
                      {vigente && (
                        <span className="ml-2 text-xs font-medium text-lago-700">· en curso</span>
                      )}
                    </td>
                    <td className={`${TD} tabular text-stone-700`}>
                      {formatoFechaCorta(p.desde)}
                    </td>
                    <td className={`${TD} tabular text-stone-700`}>
                      {formatoFechaCorta(ultimoDia)}
                      <span className="tabular block text-xs text-stone-500 sm:hidden">
                        {diasDelRango(p)} días
                      </span>
                    </td>
                    <td className={`${TD} ${COL_SECUNDARIA} tabular text-right text-stone-600`}>
                      {diasDelRango(p)}
                    </td>
                    {puedeEditar && (
                      <td className={`${TD} text-right`}>
                        <form action={quitarRango}>
                          <input type="hidden" name="rango_id" value={p.id} />
                          <BotonEnvio
                            variante="peligro"
                            cargando="Quitando…"
                            confirmar={`¿Quitar el período del ${formatoFechaCorta(p.desde)} al ${formatoFechaCorta(ultimoDia)}? Esas fechas van a quedar sin tarifa.`}
                          >
                            Quitar
                          </BotonEnvio>
                        </form>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      <p className="mt-4 text-sm text-stone-500">
        Los precios de cada temporada se cargan en{' '}
        <Link href="/panel/config" className="text-lago-700 hover:underline">
          Configuración → Tarifario
        </Link>
        . Acá solo se define a qué fechas corresponde cada una.
      </p>
    </Pagina>
  )
}
