import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { hoyISO, sumarDias } from '@/lib/fechas'
import { FormularioGrupo, type OpcionGrupo } from './formulario'

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

export default async function NuevaGrupoPage({
  searchParams,
}: {
  searchParams: Promise<{ check_in?: string; check_out?: string }>
}) {
  await requerirAcceso('reservas')
  const sp = await searchParams
  const checkIn = RE_FECHA.test(sp.check_in ?? '') ? sp.check_in! : ''
  const checkOut = RE_FECHA.test(sp.check_out ?? '') ? sp.check_out! : ''
  const buscado = Boolean(checkIn && checkOut && checkOut > checkIn)

  let opciones: OpcionGrupo[] = []
  if (buscado) {
    const tipos = await disponibilidadPorTipo(checkIn, checkOut)
    opciones = tipos
      .filter((t) => Number(t.disponibles) > 0)
      .map((t) => ({
        tipoUnidadId: t.tipo_unidad_id,
        nombre: t.nombre,
        disponibles: Number(t.disponibles),
      }))
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/panel/reservas" className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Reservas
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Reserva grupal</h1>
      <p className="mt-1 text-sm text-stone-500">
        Varias unidades para un mismo grupo o familia (una reserva por unidad, agrupadas).
      </p>

      <form
        method="get"
        className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-stone-600">Check-in</span>
          <input type="date" name="check_in" defaultValue={checkIn || hoyISO()} className="rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-lago-600" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-stone-600">Check-out</span>
          <input type="date" name="check_out" defaultValue={checkOut || sumarDias(hoyISO(), 2)} className="rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-lago-600" />
        </label>
        <button type="submit" className="rounded-lg bg-stone-800 px-4 py-2 font-medium text-white transition hover:bg-stone-900">
          Buscar disponibilidad
        </button>
      </form>

      {buscado &&
        (opciones.length === 0 ? (
          <p className="mt-6 rounded-lg bg-lenga-50 px-4 py-3 text-sm text-lenga-800">
            No hay unidades disponibles para esas fechas.
          </p>
        ) : (
          <FormularioGrupo opciones={opciones} checkIn={checkIn} checkOut={checkOut} />
        ))}
    </div>
  )
}
