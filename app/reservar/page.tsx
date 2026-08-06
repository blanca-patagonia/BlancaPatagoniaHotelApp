import Link from 'next/link'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { hoyISO, sumarDias, diasEntre } from '@/lib/fechas'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import { ChatAsistente } from './_asistente/chat'
import {
  CAMPO_PUBLICO,
  Campo,
  Marco,
  Mensaje,
  Tarjeta,
  Titulo,
  botonPublico,
} from '../_publico/ui'

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

interface Opcion {
  tipoUnidadId: string
  nombre: string
  categoria: CategoriaUnidad
  capacidadMax: number
  total: number
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
  searchParams: Promise<{ check_in?: string; check_out?: string; huespedes?: string }>
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
            nombre: t.nombre,
            categoria: t.categoria,
            capacidadMax: t.capacidad_max,
            total: cot.resumen.total,
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
      <Titulo
        titulo="Reservá tu estadía"
        descripcion="Elegí las fechas y cuántos son. Te mostramos lo que está libre, con el precio final."
      />

      <Tarjeta>
        <form method="get" className="grid gap-x-4 gap-y-5 p-5 sm:grid-cols-3 sm:p-6">
          <Campo etiqueta="Llegada">
            <input
              type="date"
              name="check_in"
              defaultValue={checkIn || hoyISO()}
              className={CAMPO_PUBLICO}
            />
          </Campo>
          <Campo etiqueta="Salida">
            <input
              type="date"
              name="check_out"
              defaultValue={checkOut || sumarDias(hoyISO(), 2)}
              className={CAMPO_PUBLICO}
            />
          </Campo>
          <Campo etiqueta="Huéspedes">
            <input
              type="number"
              name="huespedes"
              min={1}
              max={7}
              defaultValue={huespedes}
              className={CAMPO_PUBLICO}
            />
          </Campo>
          <div className="sm:col-span-3">
            <button type="submit" className={botonPublico('primario', 'w-full sm:w-auto')}>
              Ver disponibilidad
            </button>
          </div>
        </form>
      </Tarjeta>

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
                return (
                  <article
                    key={o.tipoUnidadId}
                    className={`flex flex-col gap-4 rounded-2xl border bg-white p-5 shadow-sm transition sm:flex-row sm:items-center sm:justify-between ${
                      reservable ? 'border-stone-200 hover:border-lago-300' : 'border-stone-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-semibold text-stone-900">
                        {o.nombre}
                      </h2>
                      <p className="mt-0.5 text-sm text-stone-500">
                        {ETIQUETAS_CATEGORIA[o.categoria]} · hasta {o.capacidadMax}{' '}
                        {o.capacidadMax === 1 ? 'persona' : 'personas'}
                      </p>
                    </div>

                    <div className="flex items-end justify-between gap-5 sm:items-center">
                      <div className="sm:text-right">
                        {o.hayPrecio ? (
                          <>
                            <p className="tabular font-display text-2xl leading-none font-semibold text-stone-900">
                              USD {o.total.toLocaleString('es-AR')}
                            </p>
                            <p className="mt-1 text-sm text-stone-500">
                              por {noches} {noches === 1 ? 'noche' : 'noches'}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-stone-500">Precio a confirmar</p>
                        )}
                      </div>

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
