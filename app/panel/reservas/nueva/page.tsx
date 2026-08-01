import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { hoyISO, sumarDias, diasEntre } from '@/lib/fechas'
import { FormularioReserva, type OpcionTipo } from './formulario'

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

export default async function NuevaReservaPage({
  searchParams,
}: {
  searchParams: Promise<{ check_in?: string; check_out?: string; huespedes?: string }>
}) {
  await requerirAcceso('reservas')
  const sp = await searchParams

  const checkIn = RE_FECHA.test(sp.check_in ?? '') ? sp.check_in! : ''
  const checkOut = RE_FECHA.test(sp.check_out ?? '') ? sp.check_out! : ''
  const huespedes = Math.max(1, Number(sp.huespedes ?? 1) || 1)
  const buscado = Boolean(checkIn && checkOut && checkOut > checkIn)
  const noches = buscado ? diasEntre(checkIn, checkOut) : 0

  let opciones: OpcionTipo[] = []
  if (buscado) {
    const tipos = await disponibilidadPorTipo(checkIn, checkOut)
    const disponibles = tipos.filter((t) => t.disponibles > 0 && t.capacidad_max >= huespedes)
    opciones = await Promise.all(
      disponibles.map(async (t) => {
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
          disponibles: t.disponibles,
          total: cot.resumen.total,
          faltanTarifas: cot.faltanTarifas,
        }
      }),
    )
    opciones.sort((a, b) => a.total - b.total)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/panel/reservas" className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Reservas
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Nueva reserva</h1>

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
            className="rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-lago-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-stone-600">Check-out</span>
          <input
            type="date"
            name="check_out"
            defaultValue={checkOut || sumarDias(hoyISO(), 1)}
            className="rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-lago-600"
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
            className="w-24 rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-lago-600"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-stone-800 px-4 py-2 font-medium text-white transition hover:bg-stone-900"
        >
          Buscar disponibilidad
        </button>
      </form>

      {buscado &&
        (opciones.length === 0 ? (
          <p className="mt-6 rounded-lg bg-lenga-50 px-4 py-3 text-sm text-lenga-800">
            No hay unidades disponibles para esas fechas y {huespedes} huésped(es).
          </p>
        ) : (
          <FormularioReserva
            opciones={opciones}
            checkIn={checkIn}
            checkOut={checkOut}
            huespedes={huespedes}
            noches={noches}
          />
        ))}
    </div>
  )
}
