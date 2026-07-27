import Link from 'next/link'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { hoyISO, sumarDias, diasEntre } from '@/lib/fechas'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

interface Opcion {
  tipoUnidadId: string
  nombre: string
  categoria: CategoriaUnidad
  capacidadMax: number
  total: number
  disponible: boolean
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
            disponible: t.disponibles > 0 && !cot.faltanTarifas,
          }
        }),
    )
    opciones.sort((a, b) => a.total - b.total)
  }

  return (
    <main className="flex flex-1 flex-col bg-stone-50">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight text-sky-700">
          Blanca Patagonia
        </Link>
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">
          ← Inicio
        </Link>
      </header>

      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Reservá tu estadía</h1>
        <p className="mt-1 text-sm text-stone-500">Elegí las fechas y la cantidad de huéspedes.</p>

        <form
          method="get"
          className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-stone-600">Check-in</span>
            <input
              type="date"
              name="check_in"
              defaultValue={checkIn || hoyISO()}
              className="rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-sky-600"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-stone-600">Check-out</span>
            <input
              type="date"
              name="check_out"
              defaultValue={checkOut || sumarDias(hoyISO(), 2)}
              className="rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-sky-600"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-stone-600">Huéspedes</span>
            <input
              type="number"
              name="huespedes"
              min={1}
              max={7}
              defaultValue={huespedes}
              className="w-24 rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-sky-600"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-sky-700 px-4 py-2 font-medium text-white transition hover:bg-sky-800"
          >
            Buscar
          </button>
        </form>

        {buscado && (
          <div className="mt-6 flex flex-col gap-3">
            {opciones.length === 0 && (
              <p className="rounded-lg bg-white p-4 text-sm text-stone-500">
                No hay unidades para esa cantidad de huéspedes.
              </p>
            )}
            {opciones.map((o) => (
              <div
                key={o.tipoUnidadId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4"
              >
                <div>
                  <p className="font-medium text-stone-800">{o.nombre}</p>
                  <p className="text-xs text-stone-400">
                    {ETIQUETAS_CATEGORIA[o.categoria]} · hasta {o.capacidadMax} personas
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-semibold text-stone-900">
                      USD {o.total.toLocaleString('es-AR')}
                    </p>
                    <p className="text-xs text-stone-400">
                      {noches} {noches === 1 ? 'noche' : 'noches'} · con IVA
                    </p>
                  </div>
                  {o.disponible ? (
                    <Link
                      href={`/reservar/checkout?tipo=${o.tipoUnidadId}&check_in=${checkIn}&check_out=${checkOut}&huespedes=${huespedes}`}
                      className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-800"
                    >
                      Reservar
                    </Link>
                  ) : (
                    <span className="rounded-lg bg-stone-100 px-4 py-2 text-sm text-stone-400">
                      Sin disponibilidad
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
