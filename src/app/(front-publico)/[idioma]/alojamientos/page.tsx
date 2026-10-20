import Link from 'next/link'
import {
  tiposUnidadPublicos,
  tarifasPublicas,
  rangosTemporadaPublicos,
} from '@/lib/catalogo/publico'
import { parsearRango } from '@/lib/domain/temporadas'
import type { CategoriaUnidad } from '@/lib/domain/unidades'
import {
  FILTROS_CATEGORIA,
  filtroValido,
  filtrarPorCategoria,
  ordenarCatalogo,
  precioVigente,
  conIva,
  type TipoCatalogo,
} from '@/lib/domain/catalogo'
import { formatearUSD } from '@/lib/domain/moneda'
import { hoyISO, sumarDias } from '@/lib/fechas'
import { Titulo, ChipEnlace, Etiqueta, Precio, botonPublico } from '@/app/(front-publico)/_publico/ui'
import { Marco } from '@/app/(front-publico)/_publico/marco'
import { BuscadorEstadia } from '@/app/(front-publico)/_publico/buscador'
import { PortadaAlojamiento } from './_portada'
import { JsonLdHotel } from '@/app/(front-publico)/_publico/jsonld-hotel'
import {
  textos,
  idiomaValido,
  rutaConIdioma,
  alternativasDeIdioma,
  textoCapacidadEn,
  textoComodidad,
} from '@/lib/i18n'

const FOTO_COMPARTIR = '/alojamientos/doble-superior.jpg'

export async function generateMetadata({ params }: { params: Promise<{ idioma: string }> }) {
  const { idioma } = await params
  const t = textos(idioma)
  const titulo = `${t.catalogo.metaTitulo} — Blanca Patagonia`
  return {
    title: titulo,
    description: t.catalogo.metaDescripcion,
    alternates: alternativasDeIdioma(idioma, '/alojamientos'),
    openGraph: { title: titulo, description: t.catalogo.metaDescripcion, images: [FOTO_COMPARTIR] },
    twitter: { title: titulo, description: t.catalogo.metaDescripcion, images: [FOTO_COMPARTIR] },
  }
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
  params,
  searchParams,
}: {
  params: Promise<{ idioma: string }>
  searchParams: Promise<{ categoria?: string }>
}) {
  const idioma = idiomaValido((await params).idioma)
  const tx = textos(idioma)
  const ruta = (r: string) => rutaConIdioma(r, idioma)
  const etiquetaFiltro = { todas: tx.catalogo.todos, hosteria: tx.catalogo.hosteria, cabana: tx.catalogo.cabanas }
  const { categoria } = await searchParams
  const filtro = filtroValido(categoria)

  // Catálogo cacheado (etiqueta `catalogo-publico`, se invalida al editar una
  // tarifa o temporada en el panel). La disponibilidad NO se cachea y vive en
  // `/reservar`. Ver `lib/catalogo/publico.ts`.
  const [tiposData, tarifasData, rangosData] = await Promise.all([
    tiposUnidadPublicos(),
    tarifasPublicas(),
    rangosTemporadaPublicos(),
  ])

  const tipos: TipoCatalogo[] = ((tiposData ?? []) as FilaTipo[]).map((t) => ({
    id: t.id,
    codigo: t.codigo,
    nombre: t.nombre,
    categoria: t.categoria,
    capacidadMax: t.capacidad_max,
    descripcion: t.descripcion,
    amenities: leerAmenities(t.amenities),
  }))

  // Tarifas por tipo y temporada, para el «desde» de cada tarjeta. El precio
  // que se anuncia es el de la temporada VIGENTE (`precioVigente`), no el más
  // bajo del año: el «desde USD 90» de la baja, mostrado en plena alta, es un
  // precio que el huésped no va a encontrar al elegir fechas.
  const porTipo = new Map<string, { temporada: string; precio: number }[]>()
  for (const t of tarifasData ?? []) {
    if (!t.temporada) continue
    const lista = porTipo.get(t.tipo_unidad_id) ?? []
    // Con IVA: la columna se guarda sin él y el checkout sí lo suma. Publicar el
    // valor crudo mostraría un precio más bajo que el que se cobra.
    lista.push({
      temporada: t.temporada.codigo,
      precio: conIva(Number(t.precio_rack), Number(t.iva_pct)),
    })
    porTipo.set(t.tipo_unidad_id, lista)
  }
  const rangos = (rangosData ?? [])
    .filter((rg) => rg.temporada)
    .map((rg) => ({ temporada: rg.temporada!.codigo, ...parsearRango(rg.rango) }))

  const visibles = ordenarCatalogo(filtrarPorCategoria(tipos, filtro))

  const hoy = hoyISO()

  return (
    <Marco idioma={idioma}>
      <JsonLdHotel />
      {/* La misma barra que en los resultados: quien está mirando el catálogo y
          se decide no tiene que ir a buscar dónde se consultan las fechas. */}
      <BuscadorEstadia
        checkIn=""
        checkOut=""
        huespedes={2}
        hoy={hoy}
        salidaPorDefecto={sumarDias(hoy, 2)}
        idioma={idioma}
        t={tx.buscador}
      />

      <Titulo
        titulo={tx.catalogo.titulo}
        descripcion={tx.catalogo.descripcion}
      />

      {/* El filtro va en la URL: se puede compartir el enlace de «solo cabañas»
          y el botón «atrás» del navegador hace lo que uno espera. */}
      <nav aria-label={tx.catalogo.filtrar} className="mb-6 flex flex-wrap gap-2">
        {FILTROS_CATEGORIA.map((f) => (
          <ChipEnlace
            key={f}
            href={ruta(f === 'todas' ? '/alojamientos' : `/alojamientos?categoria=${f}`)}
            activo={filtro === f}
          >
            {etiquetaFiltro[f]}
          </ChipEnlace>
        ))}
      </nav>

      {visibles.length === 0 ? (
        <p className="rounded-2xl border border-tinta/10 bg-white px-5 py-10 text-center text-tinta-suave">
          {tx.catalogo.sinCategoria}
        </p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((t, i) => {
            const desde = precioVigente(porTipo.get(t.id) ?? [], rangos, hoy)?.precio ?? null
            const extra = t.amenities.length - AMENITIES_EN_TARJETA

            return (
              <li key={t.id} data-revelar className="flex">
                {/* Toda la tarjeta es el enlace: en el teléfono nadie apunta a
                    un «ver más» de dos palabras. */}
                {/*
                  La foto manda y el texto va debajo, sobre el papel, sin caja.

                  Antes era un recuadro blanco con borde gris, esquinas muy
                  redondeadas y sombra: el patrón de tarjeta por omisión, el
                  que hace que un catálogo de hotel se vea igual que un listado
                  de productos. Ahora la imagen es el bloque —con su propio
                  radio— y la ficha respira sobre el fondo de papel, separada
                  por aire en vez de por un borde.
                */}
                <Link
                  href={ruta(`/alojamientos/${t.codigo}`)}
                  className="group flex w-full flex-col"
                >
                  <div className="overflow-hidden rounded-lg">
                    <PortadaAlojamiento
                      codigo={t.codigo}
                      nombre={t.nombre}
                      categoria={t.categoria}
                      etiquetaCategoria={tx.categorias[t.categoria]}
                      prioridad={i === 0}
                    />
                  </div>

                  <div className="flex flex-1 flex-col gap-3 pt-4">
                    <div>
                      {/* Versalitas con interletrado ancho para la categoría:
                          rotula sin competir con el nombre. */}
                      <p className="text-[10px] font-semibold tracking-[0.2em] text-lago-700/70 uppercase">
                        {tx.categorias[t.categoria]}
                      </p>
                      <h2 className="mt-1.5 font-display text-xl leading-tight font-semibold tracking-tight text-tinta transition group-hover:text-lago-800">
                        {t.nombre}
                      </h2>
                      <p className="mt-0.5 text-sm text-tinta-suave">
                        {textoCapacidadEn(tx, t.capacidadMax)}
                      </p>
                    </div>

                    {t.descripcion && (
                      <p className="text-sm leading-relaxed text-tinta-suave">{t.descripcion}</p>
                    )}

                    {t.amenities.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5">
                        {t.amenities.slice(0, AMENITIES_EN_TARJETA).map((a) => (
                          <li key={a}>
                            <Etiqueta>{textoComodidad(a, idioma, tx)}</Etiqueta>
                          </li>
                        ))}
                        {extra > 0 && (
                          <li>
                            <Etiqueta>+{extra}</Etiqueta>
                          </li>
                        )}
                      </ul>
                    )}

                    <div className="mt-auto flex items-end justify-between gap-3 border-t border-tinta/10 pt-4">
                      <div>
                        {desde === null ? (
                          /* Sin tarifa cargada no se inventa un número: decir
                             «USD 0» fue un bug real (Fase 18). */
                          <p className="text-sm text-tinta-suave">{tx.catalogo.precioAConfirmar}</p>
                        ) : (
                          <Precio
                            monto={formatearUSD(desde)}
                            encabezado={tx.catalogo.desde}
                            detalle={tx.catalogo.porNoche}
                          />
                        )}
                      </div>
                      <span className="text-sm font-medium text-lago-700 transition group-hover:text-lago-800">
                        {tx.catalogo.verDetalle}{' '}
                        <span
                          aria-hidden="true"
                          className="inline-block transition-transform duration-300 group-hover:translate-x-1"
                        >
                          →
                        </span>
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-10 rounded-2xl border border-tinta/10 bg-white px-5 py-6 text-center sm:px-6">
        <h2 className="font-display text-xl font-semibold text-tinta">
          {tx.catalogo.yaSabes}
        </h2>
        <p className="mx-auto mt-1.5 max-w-lg text-tinta-suave">
          {tx.catalogo.yaSabesTexto}
        </p>
        <Link href={ruta('/reservar')} className={botonPublico('primario', 'mt-4 w-full sm:w-auto')}>
          {tx.catalogo.verDisponibilidad}
        </Link>
      </div>
    </Marco>
  )
}
