import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarAccesoHuesped } from '@/lib/auditoria/accesos'
import { registrarFalla } from '@/lib/acciones'
import { ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { patronOr } from '@/lib/listados'
import { fusionarHuespedes, anonimizarHuesped } from '../actions'
import { TONO_ESTADO } from '../../_components/estilos'
import {
  Buscador,
  COL_SECUNDARIA,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Mensaje,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'
import { Icono } from '../../_components/iconos'
import { parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'
import { nivelFidelidad, ETIQUETAS_NIVEL } from '@/lib/domain/fidelidad'
import { nombreCompleto } from '@/lib/domain/huespedes'
import { ETIQUETAS_CONDICION_IVA, type CondicionIva } from '@/lib/domain/facturacion'
import { formatearUSD } from '@/lib/domain/moneda'

const MENSAJES_ERROR: Record<string, string> = {
  fusion_datos: 'Faltó indicar con cuál huésped fusionar.',
  fusion: 'No se pudo fusionar. No se cambió nada.',
  fusion_mismo_huesped: 'No se puede fusionar una ficha con sí misma.',
  fusion_no_existe: 'El otro huésped ya no existe. Puede que ya se haya fusionado o borrado.',
  fusion_sin_permiso: 'No se pudo fusionar por un problema de permisos. No se cambió nada.',
  fusion_referencia_pendiente:
    'No se pudo completar la fusión: algo del duplicado no se pudo reasignar. No se perdió nada — probá de nuevo.',
  fusion_desconocido: 'No se pudo fusionar por un motivo inesperado. No se cambió nada.',
  anonimizar_verificar: 'No se pudo verificar si tiene una reserva activa. No se cambió nada.',
  anonimizar_activa:
    'No se puede anonimizar: tiene una reserva pendiente, confirmada, pagada o en curso. Esperá al check-out o cancelala primero.',
  anonimizar: 'No se pudieron borrar los datos personales. Probá de nuevo.',
}

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
  anonimizado: boolean
  acepta_promociones: boolean
}

interface CandidatoFusion {
  id: string
  apellido: string
  nombre: string
  doc_numero: string
  email: string | null
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
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string; q?: string }>
}) {
  await requerirAcceso('huespedes')
  const { id } = await params
  const { error: errorParam, ok: okParam, q: fusionarQ } = await searchParams
  const supabase = await crearClienteServidor()

  const [{ data: huespedData, error: eHuesped }, { data: reservasData, error: eReservas }] =
    await Promise.all([
      supabase
        .from('huespedes')
        .select(
          'id, apellido, nombre, email, telefono, doc_tipo, doc_numero, nacionalidad, puntos, condicion_iva, residente_exterior, notas, anonimizado, acepta_promociones',
        )
        .eq('id', id)
        .single(),
      supabase
        .from('reservas')
        .select('id, codigo, estado, total, estadias(periodo)')
        .eq('huesped_id', id)
        .order('creada_en', { ascending: false }),
    ])

  // Distinguir «falló la lectura» de «no existe»: mismo criterio que
  // `editar/page.tsx` — sin esto, un corte de red se ve igual que un huésped
  // borrado y dispara un 404 falso en vez del aviso de error real. Esta es la
  // ficha de solo lectura, la que ve TODO el staff, no solo quien edita.
  if (eHuesped) {
    registrarFalla(eHuesped, 'huespedes:ficha')
    throw new Error('No se pudo cargar el huésped')
  }
  if (!huespedData) notFound()
  registrarFalla(eReservas, 'huespedes:historial_reservas')
  await registrarAccesoHuesped(supabase, id, 'ficha_huesped')
  const huesped = huespedData as Huesped
  const reservas = (reservasData ?? []) as unknown as ReservaHist[]
  const nivel = nivelFidelidad(huesped.puntos)

  // Candidatos para fusionar: por nombre, apellido, documento o email. Excluye
  // esta misma ficha y cualquiera ya anonimizada —fusionar con una ficha sin
  // identidad no tiene sentido—. Se busca por término libre y no por
  // coincidencia exacta porque el caso típico (`Externo-xxxxxx` sin documento)
  // no tiene con qué buscar exacto.
  let candidatos: CandidatoFusion[] = []
  let errorCandidatos: string | null = null
  if (fusionarQ && fusionarQ.trim().length >= 2) {
    const patron = patronOr(fusionarQ.trim())
    const { data: candidatosData, error: eCandidatos } = await supabase
      .from('huespedes')
      .select('id, apellido, nombre, doc_numero, email')
      .eq('anonimizado', false)
      .neq('id', id)
      .or(`apellido.ilike.${patron},nombre.ilike.${patron},doc_numero.ilike.${patron},email.ilike.${patron}`)
      .limit(8)
    if (eCandidatos) {
      registrarFalla(eCandidatos, 'huespedes:candidatos_fusion')
      errorCandidatos = 'No se pudo buscar. Probá de nuevo.'
    }
    candidatos = (candidatosData ?? []) as CandidatoFusion[]
  }

  return (
    <Pagina>
      <Link
        href="/panel/huespedes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a huéspedes
      </Link>

      <Encabezado
        titulo={nombreCompleto(huesped)}
        descripcion={`${huesped.doc_tipo} ${huesped.doc_numero || 'sin documento'}`}
        icono="huespedes"
        acciones={
          <Link href={`/panel/huespedes/${huesped.id}/editar`} className={botonClases('secundario')}>
            <Icono nombre="config" tam={16} />
            Editar datos
          </Link>
        }
      />

      {errorParam && (
        <Mensaje tono="error">
          {MENSAJES_ERROR[errorParam] ?? 'No se pudo completar la operación.'}
        </Mensaje>
      )}
      {okParam === 'fusionado' && (
        <Mensaje tono="ok">
          Fusión completa. El historial de reservas y los puntos del duplicado ya están acá.
        </Mensaje>
      )}
      {okParam === 'anonimizado' && (
        <Mensaje tono="ok">Datos personales eliminados. El historial de reservas se conserva.</Mensaje>
      )}

      {huesped.anonimizado && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-stone-100 px-4 py-3 text-sm ring-1 ring-stone-300">
          <span className="shrink-0 text-stone-500">
            <Icono nombre="alerta" tam={16} />
          </span>
          <span className="text-stone-700">
            <strong className="font-semibold">Datos personales eliminados</strong> a pedido del
            titular (Ley 25.326). El nombre, el documento y el contacto fueron sobrescritos; el
            historial de reservas, pagos y facturas se conserva por retención fiscal.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Datos de contacto" className="lg:col-span-2">
          <dl className="grid gap-4 p-5 sm:grid-cols-2">
            <Dato etiqueta="Email">
              {huesped.email ? (
                <a href={`mailto:${huesped.email}`} className="text-lago-700 hover:underline">
                  {huesped.email}
                </a>
              ) : (
                <span className="text-stone-600">Sin cargar</span>
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
                <span className="text-stone-600">Sin cargar</span>
              )}
            </Dato>
            <Dato etiqueta="Nacionalidad">
              {huesped.nacionalidad || <span className="text-stone-600">Sin cargar</span>}
            </Dato>
            <Dato etiqueta="Condición frente al IVA">
              {ETIQUETAS_CONDICION_IVA[huesped.condicion_iva]}
              <span className="mt-0.5 block text-xs text-stone-500">
                Define la letra de la factura.
              </span>
            </Dato>
            {/* Lo marca el propio huésped al reservar desde la web (o el
                personal, desde la edición). Es el dato que dice si se le
                puede escribir con una promoción: sin «Sí», no. */}
            <Dato etiqueta="Promociones por correo">
              {huesped.acepta_promociones ? 'Sí, aceptó recibirlas' : 'No aceptó'}
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
          {eReservas && (
            <div className="p-5 pb-0">
              <Mensaje tono="error">
                No se pudo leer el historial de reservas. Puede estar incompleto o vacío sin que
                eso signifique que no tiene reservas.
              </Mensaje>
            </div>
          )}
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
                          {` · ${formatearUSD(Number(r.total))}`}
                        </span>
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>
                        {p ? `${formatoFechaCorta(p.desde)} → ${formatoFechaCorta(p.hasta)}` : '—'}
                      </td>
                      <td
                        className={`${TD} ${COL_SECUNDARIA} tabular text-right font-medium text-stone-800`}
                      >
                        {formatearUSD(Number(r.total))}
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

      {/*
        Fusionar duplicados: el caso típico es el huésped que entró por un
        canal sin documento ni email (`Externo-xxxxxx`) y volvió directo con
        sus datos reales — hasta ahora quedaban como dos fichas separadas, cada
        una con su propio historial, sin forma de unirlas.

        No se fusiona con una ficha ya anonimizada (se excluyen de la
        búsqueda): no tiene sentido absorber el historial de una identidad que
        ya se borró a pedido del titular.
      */}
      {!huesped.anonimizado && (
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-medium text-stone-700">Fusionar con otra ficha</h2>
          <p className="mb-3 text-xs text-stone-600">
            Si esta persona ya tiene otra ficha —por ejemplo, entró antes por un canal externo sin
            documento— buscala acá para unir las dos. El historial y los puntos del duplicado pasan
            a esta ficha, y el duplicado desaparece. No se puede deshacer.
          </p>
          <Buscador
            accion={`/panel/huespedes/${huesped.id}`}
            valor={fusionarQ}
            etiqueta="Buscar por apellido, documento o email"
            placeholder="Pérez, 30111222 o correo@ejemplo.com"
          />

          {errorCandidatos && (
            <p className="mt-3 text-sm text-red-700">{errorCandidatos}</p>
          )}

          {fusionarQ && !errorCandidatos && (
            <div className="mt-3">
              {candidatos.length === 0 ? (
                <p className="text-sm text-stone-600">No se encontró ninguna otra ficha con ese término.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {candidatos.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2"
                    >
                      <div className="text-sm">
                        <Link
                          href={`/panel/huespedes/${c.id}`}
                          className="font-medium text-lago-700 hover:underline"
                        >
                          {nombreCompleto(c)}
                        </Link>
                        <span className="ml-2 text-stone-500">
                          {c.doc_numero || 'sin documento'}
                          {c.email ? ` · ${c.email}` : ''}
                        </span>
                      </div>
                      <form action={fusionarHuespedes}>
                        <input type="hidden" name="conservar_id" value={huesped.id} />
                        <input type="hidden" name="descartar_id" value={c.id} />
                        <BotonEnvio
                          variante="secundario"
                          cargando="Fusionando…"
                          confirmar={`¿Fusionar «${nombreCompleto(c)}» en esta ficha? Su historial y sus puntos pasan acá, y esa ficha desaparece. No se puede deshacer.`}
                        >
                          Fusionar acá
                        </BotonEnvio>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/*
        Derecho de supresión (Ley 25.326). Baja lógica, no DELETE: `huespedes`
        tiene `on delete restrict` desde `reservas`, y las facturas ya
        emitidas son del contador — ver el comentario de `anonimizarHuesped`.
      */}
      {!huesped.anonimizado && (
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-medium text-stone-700">Derecho de supresión</h2>
          <p className="mb-3 text-xs text-stone-600">
            Borra el nombre, el documento, el email, el teléfono, la nacionalidad y las notas de
            esta ficha. Las reservas, pagos y facturas quedan — se conservan por retención fiscal,
            sin el dato personal. No se puede deshacer.
          </p>
          <form action={anonimizarHuesped}>
            <input type="hidden" name="huesped_id" value={huesped.id} />
            <BotonEnvio
              variante="peligro"
              cargando="Eliminando datos…"
              confirmar={`¿Eliminar los datos personales de ${nombreCompleto(huesped)}? Esta acción no se puede deshacer.`}
            >
              Eliminar datos personales
            </BotonEnvio>
          </form>
        </div>
      )}
    </Pagina>
  )
}
