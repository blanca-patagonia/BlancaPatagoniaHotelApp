import Link from 'next/link'
import { tiposUnidadPublicos, tarifasPublicas } from '@/lib/catalogo/publico'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import {
  FILTROS_CATEGORIA,
  ETIQUETAS_FILTRO,
  filtroValido,
  filtrarPorCategoria,
  ordenarCatalogo,
  precioDesde,
  conIva,
  textoCapacidad,
  type TipoCatalogo,
} from '@/lib/domain/catalogo'
import { formatearUSD } from '@/lib/domain/moneda'
import { hoyISO, sumarDias } from '@/lib/fechas'
import { Marco, Titulo, ChipEnlace, Etiqueta, Precio, botonPublico } from '../_publico/ui'
import { BuscadorEstadia } from '../_publico/buscador'
import { PortadaAlojamiento } from './_portada'

export const metadata = {
  title: 'Alojamientos — Blanca Patagonia',
  description:
    'Habitaciones de hostería con vista al Lago Argentino y cabañas con hogar a leña en El Calafate. Capacidad, comodidades y precios por temporada.',
}

/** Cuántas comodidades se muestran en la tarjeta antes de resumir el resto. */
const AMENITIES_EN_TARJETA = 3

interface FilaTipo {
  id: string
  codigo: string
  nombre: string
  categoria: CategoriaUnidad
  capacidad_max: number
  descripcion: string
  amenities: unknown
}

/** `amenities` es `jsonb`: puede llegar como arreglo o como texto sin parsear. */
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
 * Catálogo público de alojamientos.
 *
 * Por qué existe: el buscador de `/reservar` exige fechas antes de mostrar nada,
 * así que quien todavía no decidió cuándo viajar no tenía forma de ver qué ofrece
 * el hotel. En Booking sí puede mirar sin comprometerse, y este portal existe
 * justamente para no depender de Booking.
 *
 * El contenido sale de `tipos_unidad`: si el hotel corrige una descripción, acá
 * cambia sola. Los precios salen de `tarifas`, columna **rack** — la de
 * mostrador. El precio neto es de agencia y el rol público no puede ni leerlo
 * (migración 0031).
 */
export default async function AlojamientosPage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string }>
}) {
  const { categoria } = await searchParams
  const filtro = filtroValido(categoria)

  // Catálogo cacheado (etiqueta `catalogo-publico`, se invalida al editar una
  // tarifa o temporada en el panel). La disponibilidad NO se cachea y vive en
  // `/reservar`. Ver `lib/catalogo/publico.ts`.
  const [tiposData, tarifasData] = await Promise.all([tiposUnidadPublicos(), tarifasPublicas()])

  const tipos: TipoCatalogo[] = ((tiposData ?? []) as FilaTipo[]).map((t) => ({
    id: t.id,
    codigo: t.codigo,
    nombre: t.nombre,
    categoria: t.categoria,
    capacidadMax: t.capacidad_max,
    descripcion: t.descripcion,
    amenities: leerAmenities(t.amenities),
  }))

  // Precio más bajo por tipo, para el «desde» de cada tarjeta.
  const porTipo = new Map<string, { precio: number }[]>()
  for (const t of (tarifasData ?? []) as {
    tipo_unidad_id: string
    precio_rack: number | string
    iva_pct: number | string
  }[]) {
    const lista = porTipo.get(t.tipo_unidad_id) ?? []
    // Con IVA: la columna se guarda sin él y el checkout sí lo suma. Publicar el
    // valor crudo mostraría un precio más bajo que el que se cobra.
    lista.push({ precio: conIva(Number(t.precio_rack), Number(t.iva_pct)) })
    porTipo.set(t.tipo_unidad_id, lista)
  }

  const visibles = ordenarCatalogo(filtrarPorCategoria(tipos, filtro))

  const hoy = hoyISO()

  return (
    <Marco>
      {/* La misma barra que en los resultados: quien está mirando el catálogo y
          se decide no tiene que ir a buscar dónde se consultan las fechas. */}
      <BuscadorEstadia
        checkIn=""
        checkOut=""
        huespedes={2}
        hoy={hoy}
        salidaPorDefecto={sumarDias(hoy, 2)}
      />

      <Titulo
        titulo="Nuestros alojamientos"
        descripcion="Hostería boutique frente al Lago Argentino y cabañas a pasos del Parque Nacional Los Glaciares. Mirá las opciones y después elegí las fechas."
      />

      {/* El filtro va en la URL: se puede compartir el enlace de «solo cabañas»
          y el botón «atrás» del navegador hace lo que uno espera. */}
      <nav aria-label="Filtrar por tipo de alojamiento" className="mb-6 flex flex-wrap gap-2">
        {FILTROS_CATEGORIA.map((f) => (
          <ChipEnlace
            key={f}
            href={f === 'todas' ? '/alojamientos' : `/alojamientos?categoria=${f}`}
            activo={filtro === f}
          >
            {ETIQUETAS_FILTRO[f]}
          </ChipEnlace>
        ))}
      </nav>

      {visibles.length === 0 ? (
        <p className="rounded-2xl border border-stone-200 bg-white px-5 py-10 text-center text-stone-600">
          No hay alojamientos de esta categoría por el momento.
        </p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((t) => {
            const desde = precioDesde(porTipo.get(t.id) ?? [])
            const extra = t.amenities.length - AMENITIES_EN_TARJETA

            return (
              <li key={t.id} className="flex">
                {/* Toda la tarjeta es el enlace: en el teléfono nadie apunta a
                    un «ver más» de dos palabras. */}
                <Link
                  href={`/alojamientos/${t.codigo}`}
                  className="group flex w-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:border-lago-300 hover:shadow-md"
                >
                  <PortadaAlojamiento codigo={t.codigo} nombre={t.nombre} categoria={t.categoria} />

                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div>
                      <h2 className="font-display text-lg leading-tight font-semibold text-stone-900">
                        {t.nombre}
                      </h2>
                      <p className="mt-0.5 text-sm text-stone-500">
                        {ETIQUETAS_CATEGORIA[t.categoria]} · {textoCapacidad(t.capacidadMax)}
                      </p>
                    </div>

                    {t.descripcion && (
                      <p className="text-sm leading-relaxed text-stone-600">{t.descripcion}</p>
                    )}

                    {t.amenities.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5">
                        {t.amenities.slice(0, AMENITIES_EN_TARJETA).map((a) => (
                          <li key={a}>
                            <Etiqueta>{a}</Etiqueta>
                          </li>
                        ))}
                        {extra > 0 && (
                          <li>
                            <Etiqueta>+{extra}</Etiqueta>
                          </li>
                        )}
                      </ul>
                    )}

                    <div className="mt-auto flex items-end justify-between gap-3 border-t border-stone-100 pt-4">
                      <div>
                        {desde === null ? (
                          /* Sin tarifa cargada no se inventa un número: decir
                             «USD 0» fue un bug real (Fase 18). */
                          <p className="text-sm text-stone-500">Precio a confirmar</p>
                        ) : (
                          <Precio
                            monto={formatearUSD(desde)}
                            encabezado="Desde"
                            detalle="por noche, con IVA"
                          />
                        )}
                      </div>
                      <span className="text-sm font-medium text-lago-700 transition group-hover:text-lago-800">
                        Ver detalle →
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-10 rounded-2xl border border-stone-200 bg-white px-5 py-6 text-center sm:px-6">
        <h2 className="font-display text-xl font-semibold text-stone-900">
          ¿Ya sabés cuándo viajás?
        </h2>
        <p className="mx-auto mt-1.5 max-w-lg text-stone-600">
          Consultá la disponibilidad real de esas fechas y reservá en línea, sin intermediarios.
        </p>
        <Link href="/reservar" className={botonPublico('primario', 'mt-4 w-full sm:w-auto')}>
          Ver disponibilidad
        </Link>
      </div>
    </Marco>
  )
}
