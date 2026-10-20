import Link from 'next/link'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { hoyISO, sumarDias, diasEntre } from '@/lib/fechas'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import { formatearUSD, porNoche } from '@/lib/domain/moneda'
import { senalEscasez } from '@/lib/domain/senales'
import { textoCapacidad } from '@/lib/domain/catalogo'
import { ChatAsistente } from './_asistente/chat'
import { PortadaAlojamiento } from '../alojamientos/_portada'
import { BuscadorEstadia } from '../_publico/buscador'
import { Insignia, Marco, Mensaje, Precio, Titulo, botonPublico } from '../_publico/ui'

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
  searchParams,
}: {
  searchParams: Promise<{ check_in?: string; check_out?: string; huespedes?: string; tipo?: string }>
}) {
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

  return (
    <Marco>
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
      />

      <Titulo
        titulo="Reservá tu estadía"
        descripcion="Elegí las fechas y cuántos son. Te mostramos lo que está libre, con el precio final."
      />

      {/* Salida para quien llegó acá sin saber qué ofrece el hotel. */}
      <Link
        href="/alojamientos"
        className="text-sm text-lago-700 underline underline-offset-4 transition hover:text-lago-900"
      >
        Ver todos los alojamientos y sus precios
      </Link>

      {buscado && (
        <div className="mt-6 flex flex-col gap-3">
          {reservables === 0 && opciones.some((o) => o.hayLugar) && (
            <Mensaje tono="aviso">
              Tenemos lugar en esas fechas, pero todavía no publicamos las tarifas del período.
              Escribinos y te pasamos el precio en el día.
            </Mensaje>
          )}
          {opciones.length === 0 ? (
            <Mensaje tono="aviso">
              No tenemos nada libre para {huespedes} {huespedes === 1 ? 'huésped' : 'huéspedes'} en
              esas fechas. Probá corriendo un día, o escribinos: a veces se libera algo.
            </Mensaje>
          ) : (
            <>
              <p className="text-sm text-stone-500">
                {reservables} {reservables === 1 ? 'opción' : 'opciones'} para {noches}{' '}
                {noches === 1 ? 'noche' : 'noches'}. Los precios ya incluyen IVA.
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
                          ? 'border-stone-200 hover:border-lago-300 hover:shadow-md'
                          : 'border-stone-200'
                    }`}
                  >
                    {/* Patrón de Booking: la foto manda en el resultado. Se
                        decide mirando, no leyendo una lista de nombres. */}
                    <Link
                      href={`/alojamientos/${o.codigo}`}
                      className="group relative block"
                      aria-label={`Ver el detalle de ${o.nombre}`}
                    >
                      <PortadaAlojamiento
                        codigo={o.codigo}
                        nombre={o.nombre}
                        categoria={o.categoria}
                        alto="resultado"
                      />
                      {escasez && reservable && (
                        <span className="absolute top-3 left-3">
                          <Insignia tono="atencion">{escasez.texto}</Insignia>
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
                        <h2 className="font-display text-lg font-semibold text-stone-900">
                          <Link
                            href={`/alojamientos/${o.codigo}`}
                            className="transition hover:text-lago-800"
                          >
                            {o.nombre}
                          </Link>
                        </h2>
                        <p className="mt-0.5 text-sm text-stone-500">
                          {ETIQUETAS_CATEGORIA[o.categoria]} · {textoCapacidad(o.capacidadMax)}
                        </p>
                        {elegido && (
                          <p className="mt-1.5 text-sm font-medium text-lago-700">
                            El que estabas mirando
                          </p>
                        )}
                        <Link
                          href={`/alojamientos/${o.codigo}`}
                          className="mt-2 inline-block text-sm text-lago-700 underline underline-offset-4 transition hover:text-lago-900"
                        >
                          Ver fotos y servicios
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
                            detalle={`${formatearUSD(o.total)} por ${noches} ${
                              noches === 1 ? 'noche' : 'noches'
                            }, con IVA`}
                            alineado="derecha"
                          />
                        ) : (
                          <p className="text-sm text-stone-500">Precio a confirmar</p>
                        )}

                        {reservable ? (
                          <Link
                            href={`/reservar/checkout?tipo=${o.tipoUnidadId}&check_in=${checkIn}&check_out=${checkOut}&huespedes=${huespedes}`}
                            className={botonPublico('primario', 'shrink-0')}
                          >
                            Reservar
                          </Link>
                        ) : !o.hayLugar ? (
                          <span className="shrink-0 rounded-xl bg-stone-100 px-5 py-3 text-stone-500">
                            Sin lugar
                          </span>
                        ) : (
                          /* Hay lugar pero todavía no está cargada la tarifa de
                             esas fechas: se ofrece consultar en lugar de decir
                             que está lleno, que sería mentira y perdería la venta. */
                          <a
                            href={`mailto:reservas@blancapatagonia.com?subject=${encodeURIComponent(
                              `Consulta de disponibilidad · ${o.nombre}`,
                            )}&body=${encodeURIComponent(
                              `Hola, quisiera consultar por ${o.nombre} del ${checkIn} al ${checkOut} para ${huespedes} huésped(es).`,
                            )}`}
                            className={botonPublico('secundario', 'shrink-0')}
                          >
                            Consultar
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
        <ChatAsistente />
      </div>
    </Marco>
  )
}
