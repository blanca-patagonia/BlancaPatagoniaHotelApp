import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import { HORA_CHECK_IN, HORA_CHECK_OUT, ADMITE_MASCOTAS } from '@/lib/domain/hotel'
import { parsearRango } from '@/lib/domain/temporadas'
import {
  ordenarCatalogo,
  ordenarPrecios,
  precioDesde,
  conIva,
  textoCapacidad,
  textoRango,
  type PrecioTemporada,
  type TipoCatalogo,
} from '@/lib/domain/catalogo'
import { Marco, Titulo, Tarjeta, Etiqueta, botonPublico } from '../../_publico/ui'
import { PortadaAlojamiento } from '../_portada'

interface FilaTipo {
  id: string
  codigo: string
  nombre: string
  categoria: CategoriaUnidad
  capacidad_max: number
  descripcion: string
  amenities: unknown
}

function leerAmenities(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.filter((v): v is string => typeof v === 'string')
  if (typeof valor === 'string') {
    try {
      return leerAmenities(JSON.parse(valor))
    } catch {
      return []
    }
  }
  return []
}

/**
 * Busca el tipo por su código público. `null` si no existe o está dado de baja.
 *
 * Va envuelto en `cache` porque Next llama a `generateMetadata` y al componente
 * por separado: sin esto, cada visita haría la misma consulta dos veces.
 */
const tipoPorCodigo = cache(async function tipoPorCodigo(codigo: string) {
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('tipos_unidad')
    .select('id, codigo, nombre, categoria, capacidad_max, descripcion, amenities')
    .eq('codigo', codigo)
    .eq('activo', true)
    .maybeSingle()
  return (data as FilaTipo | null) ?? null
})

/**
 * Metadatos por alojamiento.
 *
 * No es un detalle cosmético: estas páginas son las que el hotel va a compartir
 * por WhatsApp y las que puede indexar un buscador. Sin esto, todas se anuncian
 * con el mismo título y el enlace compartido no dice cuál es.
 */
export async function generateMetadata({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  const tipo = await tipoPorCodigo(codigo)
  if (!tipo) return { title: 'Alojamiento no encontrado — Blanca Patagonia' }

  return {
    title: `${tipo.nombre} — Blanca Patagonia`,
    description:
      tipo.descripcion ||
      `${ETIQUETAS_CATEGORIA[tipo.categoria]} para ${textoCapacidad(tipo.capacidad_max)} en El Calafate.`,
  }
}

export default async function AlojamientoDetallePage({
  params,
}: {
  params: Promise<{ codigo: string }>
}) {
  const { codigo } = await params
  const fila = await tipoPorCodigo(codigo)
  // Un código inventado o un alojamiento dado de baja dan 404 de verdad, no una
  // pantalla vacía: el enlace compartido tiene que decir con claridad qué pasó.
  if (!fila) notFound()

  const tipo: TipoCatalogo = {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    categoria: fila.categoria,
    capacidadMax: fila.capacidad_max,
    descripcion: fila.descripcion,
    amenities: leerAmenities(fila.amenities),
  }

  const supabase = await crearClienteServidor()
  const [{ data: tarifasData }, { data: rangosData }, { data: otrosData }] = await Promise.all([
    // `precio_rack` únicamente: el neto es de agencia (migración 0031).
    supabase
      .from('tarifas')
      .select('precio_rack, iva_pct, temporada:temporadas(codigo, nombre, orden)')
      .eq('tipo_unidad_id', tipo.id)
      .eq('vigente', true),
    supabase.from('temporada_rangos').select('temporada_id, rango, temporada:temporadas(codigo)'),
    supabase
      .from('tipos_unidad')
      .select('id, codigo, nombre, categoria, capacidad_max, descripcion, amenities')
      .eq('activo', true)
      .eq('categoria', tipo.categoria)
      .neq('id', tipo.id),
  ])

  // Rangos de fecha por código de temporada, para que la tabla de precios diga
  // CUÁNDO rige cada una. «Temporada alta» sin fechas no le sirve a nadie.
  const rangosPorTemporada = new Map<string, string[]>()
  for (const r of (rangosData ?? []) as unknown as {
    rango: string
    temporada: { codigo: string } | null
  }[]) {
    if (!r.temporada) continue
    const { desde, hasta } = parsearRango(r.rango)
    const lista = rangosPorTemporada.get(r.temporada.codigo) ?? []
    // `textoRango` resta el día del fin excluido: sin eso la tabla publicaría
    // que la temporada alta llega al 1/12, cuando el 1/12 ya es media.
    lista.push(textoRango(desde, hasta))
    rangosPorTemporada.set(r.temporada.codigo, lista)
  }

  const precios: PrecioTemporada[] = ordenarPrecios(
    ((tarifasData ?? []) as unknown as {
      precio_rack: number | string
      iva_pct: number | string
      temporada: { codigo: string; nombre: string; orden: number } | null
    }[])
      .filter((t) => t.temporada)
      .map((t) => ({
        temporada: t.temporada!.codigo,
        nombre: t.temporada!.nombre,
        orden: t.temporada!.orden,
        // Con IVA: `precio_rack` se guarda sin él (ADR 0004) y el checkout lo
        // suma. Publicar el valor crudo sería anunciar un precio que no es.
        precio: conIva(Number(t.precio_rack), Number(t.iva_pct)),
        rangos: rangosPorTemporada.get(t.temporada!.codigo) ?? [],
      })),
  )

  const desde = precioDesde(precios)
  const otros = ordenarCatalogo(
    ((otrosData ?? []) as FilaTipo[]).map((t) => ({
      id: t.id,
      codigo: t.codigo,
      nombre: t.nombre,
      categoria: t.categoria,
      capacidadMax: t.capacidad_max,
      descripcion: t.descripcion,
      amenities: leerAmenities(t.amenities),
    })),
  ).slice(0, 3)

  return (
    <Marco volver={{ href: '/alojamientos', texto: 'Todos los alojamientos' }}>
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <PortadaAlojamiento
          codigo={tipo.codigo}
          nombre={tipo.nombre}
          categoria={tipo.categoria}
          alto="hero"
        />

        <div className="p-5 sm:p-6">
          <Titulo titulo={tipo.nombre} descripcion={tipo.descripcion || undefined} />

          <div className="-mt-2 flex flex-wrap gap-1.5">
            <Etiqueta>{ETIQUETAS_CATEGORIA[tipo.categoria]}</Etiqueta>
            <Etiqueta>{textoCapacidad(tipo.capacidadMax)}</Etiqueta>
          </div>

          {/* La decisión de reservar se toma acá: precio y botón juntos, sin
              tener que volver a subir para saber cuánto sale. */}
          <div className="mt-6 flex flex-col gap-4 rounded-xl bg-stone-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {desde === null ? (
                <p className="text-stone-600">
                  Todavía no publicamos las tarifas de este alojamiento.
                </p>
              ) : (
                <>
                  <p className="text-xs tracking-wide text-stone-500 uppercase">Desde</p>
                  <p className="tabular font-display text-3xl leading-none font-semibold text-stone-900">
                    USD {desde.toLocaleString('es-AR')}
                  </p>
                  <p className="mt-1 text-sm text-stone-500">
                    por noche, con IVA incluido
                  </p>
                </>
              )}
            </div>
            <Link
              href={`/reservar?tipo=${tipo.id}`}
              className={botonPublico('primario', 'w-full sm:w-auto')}
            >
              Ver disponibilidad
            </Link>
          </div>
        </div>
      </div>

      {tipo.amenities.length > 0 && (
        <Tarjeta titulo="Qué incluye" className="mt-6">
          <ul className="grid gap-2 p-5 sm:grid-cols-2 sm:px-6">
            {tipo.amenities.map((a) => (
              <li key={a} className="flex items-start gap-2 text-stone-700">
                <span className="mt-0.5 text-lago-600" aria-hidden="true">
                  ✓
                </span>
                {a}
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {precios.length > 0 && (
        <Tarjeta
          titulo="Precios por temporada"
          descripcion="Valor por noche en dólares con IVA incluido. La temporada la define la fecha de cada noche."
          className="mt-6"
        >
          {/* `overflow-x-auto` y no `hidden`: en un teléfono angosto la tabla se
              arrastra, no se recorta. */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="sr-only">
                Precio por noche de {tipo.nombre} en cada temporada, con las fechas que abarca
              </caption>
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="px-5 py-3 text-left font-semibold text-stone-500 sm:px-6">
                    Temporada
                  </th>
                  <th className="px-5 py-3 text-left font-semibold text-stone-500">Fechas</th>
                  <th className="px-5 py-3 text-right font-semibold text-stone-500 sm:px-6">
                    Por noche
                  </th>
                </tr>
              </thead>
              <tbody>
                {precios.map((p) => (
                  <tr key={p.temporada} className="border-t border-stone-100">
                    <td className="px-5 py-3 font-medium text-stone-800 sm:px-6">{p.nombre}</td>
                    <td className="px-5 py-3 text-stone-600">
                      {p.rangos.length > 0 ? (
                        p.rangos.join(' · ')
                      ) : (
                        <span className="text-stone-400">a confirmar</span>
                      )}
                    </td>
                    <td className="tabular px-5 py-3 text-right font-semibold text-stone-900 sm:px-6">
                      USD {p.precio.toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}

      <Tarjeta titulo="Antes de reservar" className="mt-6">
        <dl className="grid gap-4 p-5 sm:grid-cols-2 sm:px-6">
          <div>
            <dt className="text-sm font-medium text-stone-500">Horarios</dt>
            <dd className="mt-0.5 text-stone-800">
              Check-in desde las {HORA_CHECK_IN} · Check-out hasta las {HORA_CHECK_OUT}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-stone-500">Mascotas</dt>
            <dd className="mt-0.5 text-stone-800">
              {ADMITE_MASCOTAS ? 'Se admiten mascotas.' : 'No se admiten mascotas.'}
            </dd>
          </div>
          {/* La política sale del Tarifario y es la misma que aplica el sistema
              al calcular un cargo por cancelación: decirla antes evita el
              reclamo después. */}
          <div className="sm:col-span-2">
            <dt className="text-sm font-medium text-stone-500">Cancelación</dt>
            <dd className="mt-0.5 leading-relaxed text-stone-800">
              Sin cargo hasta 14 días antes del check-in. Entre 14 y 7 días se cobra la primera
              noche, y dentro de los 7 días el total de la estadía.
            </dd>
          </div>
        </dl>
      </Tarjeta>

      {otros.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display mb-4 text-xl font-semibold text-stone-900">
            Otras opciones en {ETIQUETAS_CATEGORIA[tipo.categoria].toLowerCase()}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {otros.map((o) => (
              <li key={o.id} className="flex">
                <Link
                  href={`/alojamientos/${o.codigo}`}
                  className="flex w-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:border-lago-300 hover:shadow-md"
                >
                  <PortadaAlojamiento
                    codigo={o.codigo}
                    nombre={o.nombre}
                    categoria={o.categoria}
                  />
                  <div className="p-4">
                    <h3 className="font-display font-semibold text-stone-900">{o.nombre}</h3>
                    <p className="mt-0.5 text-sm text-stone-500">
                      {textoCapacidad(o.capacidadMax)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Marco>
  )
}
