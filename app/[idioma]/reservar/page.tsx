import Link from 'next/link'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { hoyISO, sumarDias, diasEntre } from '@/lib/fechas'
import type { CategoriaUnidad } from '@/lib/domain/unidades'
import { formatearUSD, porNoche } from '@/lib/domain/moneda'
import { senalEscasez } from '@/lib/domain/senales'
import { ChatAsistente } from '@/app/reservar/_asistente/chat'
import { PortadaAlojamiento } from '../alojamientos/_portada'
import { BuscadorEstadia } from '@/app/_publico/buscador'
import { Pasos } from '@/app/_publico/pasos'
import { es as diccionarioEs } from '@/lib/i18n/diccionarios/es'
import {
  textos,
  rellenar,
  plural,
  idiomaValido,
  rutaConIdioma,
  alternativasDeIdioma,
  textoCapacidadEn,
  fechaCortaEn,
} from '@/lib/i18n'
import { Insignia, Mensaje, Precio, Titulo, botonPublico } from '@/app/_publico/ui'
import { Marco } from '@/app/_publico/marco'

/*
  Metadata propia.

  Sin esto la pantalla heredaba el título del layout raíz —«Blanca Patagonia —
  Gestión Hotelera»—, que es el nombre del **sistema interno**. Un huésped que
  llega desde Google a reservar una habitación leía «Gestión Hotelera» en la
  pestaña y en el resultado del buscador: suena a software, no a hotel.
*/
export async function generateMetadata({ params }: { params: Promise<{ idioma: string }> }) {
  const { idioma } = await params
  const t = textos(idioma)
  return {
    title: `${t.reservar.metaTitulo} — Blanca Patagonia`,
    description: t.reservar.metaDescripcion,
    alternates: alternativasDeIdioma(idioma, '/reservar'),
  }
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

interface Opcion {
  tipoUnidadId: string
  codigo: string
  nombre: string
  categoria: CategoriaUnidad
  capacidadMax: number
  total: number
  /** Unidades libres de este tipo en el rango. Alimenta la señal de escasez. */
  disponibles: number
  /** Queda alguna unidad de este tipo libre en el rango. */
  hayLugar: boolean
  /**
   * Se pudo cotizar: hay tarifa cargada para todas esas noches.
   *
   * Se separa de `hayLugar` a propósito. Antes ambas cosas se mezclaban en un
   * solo `disponible`, y cuando faltaba cargar la tarifa de un período el
   * portal decía **"sin disponibilidad"**: le avisaba al huésped que el hotel
   * estaba lleno cuando en realidad había lugar y solo faltaba el precio. La
   * reserva se perdía sin que nadie se enterara.
   */
  hayPrecio: boolean
}

export default async function ReservarPage({
  params,
  searchParams,
}: {
  params: Promise<{ idioma: string }>
  searchParams: Promise<{ check_in?: string; check_out?: string; huespedes?: string; tipo?: string }>
}) {
  const idioma = idiomaValido((await params).idioma)
  const tx = textos(idioma)
  const ruta = (r: string) => rutaConIdioma(r, idioma)
  const sp = await searchParams
  const checkIn = RE_FECHA.test(sp.check_in ?? '') ? sp.check_in! : ''
  const checkOut = RE_FECHA.test(sp.check_out ?? '') ? sp.check_out! : ''
  const huespedes = Math.max(1, Number(sp.huespedes ?? 2) || 2)
  const buscado = Boolean(checkIn && checkOut && checkOut > checkIn)
  const noches = buscado ? diasEntre(checkIn, checkOut) : 0

  let opciones: Opcion[] = []
  if (buscado) {
    const tipos = await disponibilidadPorTipo(checkIn, checkOut)
    opciones = await Promise.all(
      tipos
        .filter((t) => t.capacidad_max >= huespedes)
        .map(async (t) => {
          const cot = await cotizarEstadia({
            tipoUnidadId: t.tipo_unidad_id,
            checkIn,
            checkOut,
            tarifaTipo: 'rack',
          })
          return {
            tipoUnidadId: t.tipo_unidad_id,
            codigo: t.codigo,
            nombre: t.nombre,
            categoria: t.categoria,
            capacidadMax: t.capacidad_max,
            total: cot.resumen.total,
            disponibles: t.disponibles,
            hayLugar: t.disponibles > 0,
            hayPrecio: !cot.faltanTarifas,
          }
        }),
    )
    // Primero lo que se puede reservar ya; después lo que hay que consultar.
    opciones.sort((a, b) => {
      const reservable = (o: Opcion) => (o.hayLugar && o.hayPrecio ? 0 : 1)
      return reservable(a) - reservable(b) || a.total - b.total
    })
  }

  const reservables = opciones.filter((o) => o.hayLugar && o.hayPrecio).length
  const consulta = new URLSearchParams({
    ...(checkIn && { check_in: checkIn }),
    ...(checkOut && { check_out: checkOut }),
    huespedes: String(huespedes),
    ...(sp.tipo && { tipo: sp.tipo }),
  }).toString()

  return (
    <Marco idioma={idioma}>
      {/* Paso 1 hasta que hay una búsqueda válida; con resultados, paso 2. */}
      <Pasos
        actual={buscado ? 2 : 1}
        t={tx.pasos}
        enlaces={{ 1: `${ruta(`/reservar?${consulta}`)}#buscador` }}
      />
      {/* Patrón de Booking: la búsqueda queda arriba y acompaña el scroll, así
          corregir las fechas no obliga a volver atrás ni a perder los
          resultados que se estaban leyendo. */}
      <BuscadorEstadia
        checkIn={checkIn}
        checkOut={checkOut}
        huespedes={huespedes}
        hoy={hoyISO()}
        salidaPorDefecto={sumarDias(hoyISO(), 2)}
        tipo={sp.tipo}
        idioma={idioma}
        t={tx.buscador}
      />

      <Titulo
        titulo={tx.reservar.titulo}
        descripcion={tx.reservar.descripcion}
      />

      {/* Salida para quien llegó acá sin saber qué ofrece el hotel. */}
      <Link
        href={ruta('/alojamientos')}
        className="text-sm text-lago-700 underline underline-offset-4 transition hover:text-lago-900"
      >
        {tx.reservar.verTodos}
      </Link>

      {buscado && (
        <div className="mt-6 flex flex-col gap-3">
          {reservables === 0 && opciones.some((o) => o.hayLugar) && (
            <Mensaje tono="aviso">{tx.reservar.sinTarifasAviso}</Mensaje>
          )}
          {opciones.length === 0 ? (
            <Mensaje tono="aviso">
              {rellenar(tx.reservar.sinLugarAviso, {
                personas: plural(huespedes, tx.buscador.huesped, tx.buscador.huespedesN),
              })}
            </Mensaje>
          ) : (
            <>
              <p className="text-sm text-tinta-suave">
                {rellenar(tx.reservar.resumen, {
                  opciones: plural(reservables, tx.reservar.unaOpcion, tx.reservar.variasOpciones),
                  noches: plural(noches, tx.buscador.unaNoche, tx.buscador.noches),
                })}
              </p>
              {opciones.map((o) => {
                const reservable = o.hayLugar && o.hayPrecio
                // Quien llegó desde el detalle de un alojamiento tiene que
                // reconocerlo en la lista sin leerla entera; el resto sigue a la
                // vista porque si justo ese está lleno, la alternativa es la venta.
                const elegido = o.tipoUnidadId === sp.tipo
                // Señal con el número real de unidades libres. Solo habla
                // cuando queda una: ver lib/domain/senales.ts, donde está
                // explicado por qué no se avisa con 2 o 3.
                const escasez = senalEscasez(o.disponibles)

                return (
                  <article
                    key={o.tipoUnidadId}
                    className={`grid overflow-hidden rounded-2xl border bg-white shadow-sm transition sm:grid-cols-[16rem_1fr] ${
                      elegido
                        ? 'border-lago-500 ring-1 ring-lago-200'
                        : reservable
                          ? 'border-tinta/10 hover:border-lago-300 hover:shadow-md'
                          : 'border-tinta/10'
                    }`}
                  >
                    {/* Patrón de Booking: la foto manda en el resultado. Se
                        decide mirando, no leyendo una lista de nombres. */}
                    <Link
                      href={ruta(`/alojamientos/${o.codigo}`)}
                      className="group relative block overflow-hidden"
                      aria-label={rellenar(tx.reservar.verDetalleDe, { nombre: o.nombre })}
                    >
                      <PortadaAlojamiento
                        codigo={o.codigo}
                        nombre={o.nombre}
                        categoria={o.categoria}
                        etiquetaCategoria={tx.categorias[o.categoria]}
                        alto="resultado"
                      />
                      {escasez && reservable && (
                        <span className="absolute top-3 left-3">
                          <Insignia tono="atencion">{tx.categorias.ultimaLibre}</Insignia>
                        </span>
                      )}
                    </Link>

                    {/* `min-w-0` en la celda y en las columnas internas. Un hijo
                        de grid/flex no se encoge por debajo de su contenido
                        mínimo, y acá la línea del precio («USD 435,60 por 3
                        noches, con IVA») es larga: sin esto, un nombre de
                        alojamiento más largo o una moneda de más dígitos
                        empujarían el ancho de la tarjeta. */}
                    <div className="flex min-w-0 flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <h2 className="font-display text-lg font-semibold text-tinta">
                          <Link
                            href={ruta(`/alojamientos/${o.codigo}`)}
                            className="transition hover:text-lago-800"
                          >
                            {o.nombre}
                          </Link>
                        </h2>
                        <p className="mt-0.5 text-sm text-tinta-suave">
                          {tx.categorias[o.categoria]} · {textoCapacidadEn(tx, o.capacidadMax)}
                        </p>
                        {elegido && (
                          <p className="mt-1.5 text-sm font-medium text-lago-700">
                            {tx.reservar.elQueMirabas}
                          </p>
                        )}
                        <Link
                          href={ruta(`/alojamientos/${o.codigo}`)}
                          className="mt-2 inline-block text-sm text-lago-700 underline underline-offset-4 transition hover:text-lago-900"
                        >
                          {tx.reservar.verFotos}
                        </Link>
                      </div>

                      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-5 gap-y-3 sm:flex-col sm:items-end sm:flex-nowrap">
                        {o.hayPrecio ? (
                          /* Precio por noche arriba y total abajo: el primero
                             sirve para comparar entre opciones, el segundo es
                             el que se paga. Booking muestra los dos por eso
                             mismo, y acá el total ya lleva IVA (ADR 0004). */
                          <Precio
                            monto={formatearUSD(porNoche(o.total, noches))}
                            detalle={
                              noches === 1
                                ? rellenar(tx.reservar.porUnaNoche, { monto: formatearUSD(o.total) })
                                : rellenar(tx.reservar.porNoches, {
                                    monto: formatearUSD(o.total),
                                    n: noches,
                                  })
                            }
                            alineado="derecha"
                          />
                        ) : (
                          <p className="text-sm text-tinta-suave">{tx.catalogo.precioAConfirmar}</p>
                        )}

                        {reservable ? (
                          <Link
                            href={ruta(
                              `/reservar/checkout?tipo=${o.tipoUnidadId}&check_in=${checkIn}&check_out=${checkOut}&huespedes=${huespedes}`,
                            )}
                            className={botonPublico('primario', 'shrink-0')}
                          >
                            {tx.reservar.reservar}
                          </Link>
                        ) : !o.hayLugar ? (
                          <span className="shrink-0 rounded-xl bg-stone-100 px-5 py-3 text-tinta-suave">
                            {tx.reservar.completo}
                          </span>
                        ) : (
                          /* Hay lugar pero todavía no está cargada la tarifa de
                             esas fechas: se ofrece consultar en lugar de decir
                             que está lleno, que sería mentira y perdería la venta. */
                          <a
                            href={`mailto:reservas@blancapatagonia.com?subject=${encodeURIComponent(
                              rellenar(tx.reservar.consultaAsunto, { nombre: o.nombre }),
                            )}&body=${encodeURIComponent(
                              rellenar(tx.reservar.consultaCuerpo, {
                                nombre: o.nombre,
                                desde: fechaCortaEn(checkIn, idioma),
                                hasta: fechaCortaEn(checkOut, idioma),
                                n: huespedes,
                              }),
                            )}`}
                            className={botonPublico('secundario', 'shrink-0')}
                          >
                            {tx.reservar.consultar}
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* Asistente: resuelve las consultas frecuentes sin ocupar a recepción. */}
      <div className="mt-10">
        <ChatAsistente
          t={tx.asistente}
          consultasEs={[
            diccionarioEs.asistente.sugerencia1,
            diccionarioEs.asistente.sugerencia2,
            diccionarioEs.asistente.sugerencia3,
          ]}
        />
      </div>
    </Marco>
  )
}
