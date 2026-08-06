import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { TONO_ESTADO } from '../../_components/estilos'
import {
  COL_SECUNDARIA,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../../_components/ui'
import { Icono } from '../../_components/iconos'
import { parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'
import { nivelFidelidad, ETIQUETAS_NIVEL } from '@/lib/domain/fidelidad'
import { ETIQUETAS_CONDICION_IVA, type CondicionIva } from '@/lib/domain/facturacion'

interface Huesped {
  id: string
  apellido: string
  nombre: string
  email: string | null
  telefono: string | null
  doc_tipo: string
  doc_numero: string
  nacionalidad: string | null
  puntos: number
  condicion_iva: CondicionIva
  notas: string
}
interface ReservaHist {
  id: string
  codigo: string
  estado: EstadoReserva
  total: number | string
  estadias: { periodo: string }[]
}

/** Fila de la ficha: etiqueta arriba, valor abajo. */
function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">{etiqueta}</dt>
      <dd className="mt-0.5 text-stone-800">{children}</dd>
    </div>
  )
}

export default async function DetalleHuespedPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requerirAcceso('huespedes')
  const { id } = await params
  const supabase = await crearClienteServidor()

  const [{ data: huespedData }, { data: reservasData }] = await Promise.all([
    supabase
      .from('huespedes')
      .select(
        'id, apellido, nombre, email, telefono, doc_tipo, doc_numero, nacionalidad, puntos, condicion_iva, notas',
      )
      .eq('id', id)
      .single(),
    supabase
      .from('reservas')
      .select('id, codigo, estado, total, estadias(periodo)')
      .eq('huesped_id', id)
      .order('creada_en', { ascending: false }),
  ])

  if (!huespedData) notFound()
  const huesped = huespedData as Huesped
  const reservas = (reservasData ?? []) as unknown as ReservaHist[]
  const nivel = nivelFidelidad(huesped.puntos)

  return (
    <Pagina>
      <Link
        href="/panel/huespedes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a huéspedes
      </Link>

      <Encabezado
        titulo={`${huesped.apellido}, ${huesped.nombre}`}
        descripcion={`${huesped.doc_tipo} ${huesped.doc_numero || 'sin documento'}`}
        icono="huespedes"
        acciones={
          <Link href={`/panel/huespedes/${huesped.id}/editar`} className={botonClases('secundario')}>
            <Icono nombre="config" tam={16} />
            Editar datos
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Datos de contacto" className="lg:col-span-2">
          <dl className="grid gap-4 p-5 sm:grid-cols-2">
            <Dato etiqueta="Email">
              {huesped.email ? (
                <a href={`mailto:${huesped.email}`} className="text-lago-700 hover:underline">
                  {huesped.email}
                </a>
              ) : (
                <span className="text-stone-400">Sin cargar</span>
              )}
            </Dato>
            <Dato etiqueta="Teléfono">
              {huesped.telefono ? (
                // Enlace `tel:`: desde un teléfono se llama con un toque.
                <a
                  href={`tel:${huesped.telefono.replace(/\s/g, '')}`}
                  className="text-lago-700 hover:underline"
                >
                  {huesped.telefono}
                </a>
              ) : (
                <span className="text-stone-400">Sin cargar</span>
              )}
            </Dato>
            <Dato etiqueta="Nacionalidad">
              {huesped.nacionalidad || <span className="text-stone-400">Sin cargar</span>}
            </Dato>
            <Dato etiqueta="Condición frente al IVA">
              {ETIQUETAS_CONDICION_IVA[huesped.condicion_iva]}
              <span className="mt-0.5 block text-xs text-stone-500">
                Define la letra de la factura.
              </span>
            </Dato>
            {huesped.notas && (
              <div className="sm:col-span-2">
                <Dato etiqueta="Notas internas">
                  <span className="whitespace-pre-line">{huesped.notas}</span>
                </Dato>
              </div>
            )}
          </dl>
        </Tarjeta>

        <Tarjeta titulo="Fidelidad">
          <div className="p-5">
            <p className="font-display text-3xl leading-none font-semibold text-stone-900">
              {huesped.puntos.toLocaleString('es-AR')}
            </p>
            <p className="mt-1 text-sm text-stone-500">puntos acumulados</p>
            <p className="mt-3">
              <Etiqueta tono="calafate">Nivel {ETIQUETAS_NIVEL[nivel]}</Etiqueta>
            </p>
            <p className="mt-3 text-xs leading-snug text-stone-500">
              Se suma 1 punto por cada USD 10 al hacer el check-out.
            </p>
          </div>
        </Tarjeta>
      </div>

      <div className="mt-4">
        <Tarjeta titulo="Historial de reservas" descripcion={`${reservas.length} en total`}>
          {reservas.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no tiene reservas"
              descripcion="Cuando se le cargue una, va a aparecer acá."
              icono="reservas"
            />
          ) : (
            <Tabla resumen="Reservas del huésped con fechas, importe y estado">
              <thead>
                <tr>
                  <th className={TH}>Código</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Estadía</th>
                  <th className={`${TH} ${COL_SECUNDARIA} text-right`}>Total</th>
                  <th className={TH}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {reservas.map((r) => {
                  const p = r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo) : null
                  return (
                    <tr key={r.id} className={FILA}>
                      <td className={TD}>
                        <Link
                          href={`/panel/reservas/${r.id}`}
                          className="font-medium text-lago-700 hover:underline"
                        >
                          {r.codigo}
                        </Link>
                        <span className="tabular block text-xs text-stone-500 sm:hidden">
                          {p ? `${formatoFechaCorta(p.desde)} → ${formatoFechaCorta(p.hasta)}` : '—'}
                          {` · USD ${Number(r.total).toLocaleString('es-AR')}`}
                        </span>
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>
                        {p ? `${formatoFechaCorta(p.desde)} → ${formatoFechaCorta(p.hasta)}` : '—'}
                      </td>
                      <td
                        className={`${TD} ${COL_SECUNDARIA} tabular text-right font-medium text-stone-800`}
                      >
                        USD {Number(r.total).toLocaleString('es-AR')}
                      </td>
                      <td className={TD}>
                        <Etiqueta tono={TONO_ESTADO[r.estado]}>
                          {ETIQUETAS_ESTADO_RESERVA[r.estado]}
                        </Etiqueta>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabla>
          )}
        </Tarjeta>
      </div>
    </Pagina>
  )
}
