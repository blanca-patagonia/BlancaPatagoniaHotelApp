import Link from 'next/link'
import { requerirSesion } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { ETIQUETAS_AMBITO, ambitosPara, terminoBuscado } from '@/lib/domain/busqueda'
import { parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'
import { patronOr } from '@/lib/listados'
import { TONO_ESTADO } from '../_components/estilos'
import {
  Encabezado,
  EstadoVacio,
  Etiqueta,
  Pagina,
  Tarjeta,
  botonClases,
} from '../_components/ui'
import { Icono } from '../_components/iconos'

/** Tope por ámbito: la búsqueda es para encontrar algo puntual, no para listar. */
const TOPE = 8

interface ReservaHit {
  id: string
  codigo: string
  estado: EstadoReserva
  huesped: { apellido: string; nombre: string } | null
  estadias: { periodo: string }[]
}

/**
 * Búsqueda global.
 *
 * Pensada para el momento en que alguien llama y hay que encontrarlo mientras
 * está al teléfono: se escribe un apellido, un código o un email y aparece todo
 * lo que coincide, sin tener que adivinar en qué módulo está cargado.
 *
 * Los ámbitos se filtran por rol con los mismos permisos que arman el menú
 * (ver `lib/domain/busqueda.ts`).
 */
export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const sesion = await requerirSesion()
  const { q } = await searchParams
  const termino = terminoBuscado(q)
  const ambitos = ambitosPara(sesion.rol)
  const supabase = await crearClienteServidor()

  const puede = (a: string) => ambitos.includes(a as never)

  const [reservas, huespedes, agencias, proveedores] = termino
    ? await Promise.all([
        puede('reservas')
          ? supabase
              .from('reservas')
              .select(
                'id, codigo, estado, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre), estadias(periodo)',
              )
              .ilike('codigo', `%${termino}%`)
              .limit(TOPE)
              .then((r) => (r.data ?? []) as unknown as ReservaHit[])
          : Promise.resolve([]),
        puede('huespedes')
          ? supabase
              .from('huespedes')
              .select('id, apellido, nombre, email, doc_numero')
              .or(
                `apellido.ilike.${patronOr(termino)},nombre.ilike.${patronOr(termino)},email.ilike.${patronOr(termino)},doc_numero.ilike.${patronOr(termino)}`,
              )
              .limit(TOPE)
              .then((r) => (r.data ?? []) as Record<string, string>[])
          : Promise.resolve([]),
        puede('agencias')
          ? supabase
              .from('agencias')
              .select('id, nombre, tipo')
              .ilike('nombre', `%${termino}%`)
              .limit(TOPE)
              .then((r) => (r.data ?? []) as Record<string, string>[])
          : Promise.resolve([]),
        puede('proveedores')
          ? supabase
              .from('proveedores')
              .select('id, nombre, rubro')
              .ilike('nombre', `%${termino}%`)
              .limit(TOPE)
              .then((r) => (r.data ?? []) as Record<string, string>[])
          : Promise.resolve([]),
      ])
    : [[], [], [], []]

  const total = reservas.length + huespedes.length + agencias.length + proveedores.length

  return (
    <Pagina>
      <Encabezado
        titulo={termino ? `Resultados de «${(q ?? '').trim()}»` : 'Buscar'}
        descripcion={
          termino
            ? `${total} ${total === 1 ? 'coincidencia' : 'coincidencias'} en ${ambitos.map((a) => ETIQUETAS_AMBITO[a].toLowerCase()).join(', ')}.`
            : 'Escribí un apellido, un código de reserva, un email o un documento.'
        }
        icono="buscar"
      />

      {!termino && (
        <Tarjeta>
          <EstadoVacio
            titulo="Escribí al menos dos letras"
            descripcion="Se busca a la vez por apellido, nombre, email, documento y código de reserva."
            icono="buscar"
          />
        </Tarjeta>
      )}

      {termino && total === 0 && (
        <Tarjeta>
          <EstadoVacio
            titulo="No encontramos nada con ese texto"
            descripcion="Probá con menos letras, o con el apellido en lugar del nombre. La búsqueda no distingue mayúsculas."
            icono="buscar"
          />
        </Tarjeta>
      )}

      <div className="flex flex-col gap-4">
        {reservas.length > 0 && (
          <Tarjeta titulo={ETIQUETAS_AMBITO.reservas} descripcion={`${reservas.length} encontradas`}>
            <ul>
              {reservas.map((r) => {
                const p = r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo) : null
                return (
                  <li key={r.id} className="border-t border-stone-100 first:border-0">
                    <Link
                      href={`/panel/reservas/${r.id}`}
                      className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-stone-50"
                    >
                      <span className="font-medium text-lago-700">{r.codigo}</span>
                      <span className="min-w-0 flex-1 text-stone-700">
                        {r.huesped ? `${r.huesped.apellido}, ${r.huesped.nombre}` : 'Sin huésped'}
                        {p && (
                          <span className="block text-sm text-stone-500">
                            {formatoFechaCorta(p.desde)} → {formatoFechaCorta(p.hasta)}
                          </span>
                        )}
                      </span>
                      <Etiqueta tono={TONO_ESTADO[r.estado]}>
                        {ETIQUETAS_ESTADO_RESERVA[r.estado]}
                      </Etiqueta>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Tarjeta>
        )}

        {huespedes.length > 0 && (
          <Tarjeta
            titulo={ETIQUETAS_AMBITO.huespedes}
            descripcion={`${huespedes.length} encontrados`}
          >
            <ul>
              {huespedes.map((h) => (
                <li key={h.id} className="border-t border-stone-100 first:border-0">
                  <Link
                    href={`/panel/huespedes/${h.id}`}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-stone-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-stone-800">
                        {h.apellido}, {h.nombre}
                      </span>
                      <span className="block text-sm text-stone-500">
                        {[h.email, h.doc_numero].filter(Boolean).join(' · ') || 'sin datos de contacto'}
                      </span>
                    </span>
                    <Icono nombre="siguiente" tam={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}

        {agencias.length > 0 && (
          <Tarjeta titulo={ETIQUETAS_AMBITO.agencias} descripcion={`${agencias.length} encontradas`}>
            <ul>
              {agencias.map((a) => (
                <li key={a.id} className="border-t border-stone-100 first:border-0">
                  <Link
                    href={`/panel/agencias/${a.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition hover:bg-stone-50"
                  >
                    <span className="min-w-0 flex-1 font-medium text-stone-800">{a.nombre}</span>
                    <Icono nombre="siguiente" tam={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}

        {proveedores.length > 0 && (
          <Tarjeta
            titulo={ETIQUETAS_AMBITO.proveedores}
            descripcion={`${proveedores.length} encontrados`}
          >
            <ul>
              {proveedores.map((p) => (
                <li key={p.id} className="border-t border-stone-100 first:border-0">
                  <Link
                    href={`/panel/proveedores/${p.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition hover:bg-stone-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-stone-800">{p.nombre}</span>
                      {p.rubro && <span className="block text-sm text-stone-500">{p.rubro}</span>}
                    </span>
                    <Icono nombre="siguiente" tam={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </div>

      {termino && total > 0 && (
        <p className="mt-4 text-sm text-stone-500">
          Se muestran hasta {TOPE} resultados por sección. Si lo que buscás no está, entrá al
          módulo y usá su buscador, que tiene filtros y paginado.
        </p>
      )}

      {ambitos.length === 0 && (
        <Tarjeta>
          <EstadoVacio
            titulo="Tu perfil no tiene secciones donde buscar"
            descripcion="La búsqueda cubre reservas, huéspedes y cuentas corrientes."
            icono="buscar"
            accion={
              <Link href="/panel" className={botonClases('secundario')}>
                Volver al inicio
              </Link>
            }
          />
        </Tarjeta>
      )}
    </Pagina>
  )
}
