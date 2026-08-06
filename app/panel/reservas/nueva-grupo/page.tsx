import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { hoyISO, sumarDias } from '@/lib/fechas'
import { FormularioGrupo, type OpcionGrupo } from './formulario'
import {
  CAMPO,
  Campo,
  Encabezado,
  EstadoVacio,
  Pagina,
  Tarjeta,
  botonClases,
} from '../../_components/ui'
import { Icono } from '../../_components/iconos'

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
    <Pagina ancho="angosto">
      <Link
        href="/panel/reservas"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a reservas
      </Link>

      <Encabezado
        titulo="Reserva grupal"
        descripcion="Varias unidades para un mismo grupo o familia. Se crea una reserva por unidad, todas agrupadas."
        icono="reservas"
      />

      {/* Los pasos van numerados —acá el 1, en el formulario el 2 y el 3— para
          que se vea cuánto falta en lugar de tener que descubrirlo. */}
      <Tarjeta titulo="1 · ¿Para cuándo?" descripcion="Todo el grupo comparte las mismas fechas.">
        <form method="get" className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2">
          <Campo etiqueta="Check-in">
            <input
              type="date"
              name="check_in"
              defaultValue={checkIn || hoyISO()}
              className={CAMPO}
            />
          </Campo>
          <Campo etiqueta="Check-out">
            <input
              type="date"
              name="check_out"
              defaultValue={checkOut || sumarDias(hoyISO(), 2)}
              className={CAMPO}
            />
          </Campo>
          <div className="sm:col-span-2">
            <button type="submit" className={botonClases('secundario', 'w-full sm:w-auto')}>
              <Icono nombre="buscar" tam={16} />
              Buscar disponibilidad
            </button>
          </div>
        </form>
      </Tarjeta>

      {buscado && (
        <div className="mt-4">
          {opciones.length === 0 ? (
            <Tarjeta>
              <EstadoVacio
                titulo="No hay unidades libres para esas fechas"
                descripcion="Probá con otras fechas, o mirá la grilla para ver qué se libera."
                icono="ocupacion"
                accion={
                  <Link href="/panel/ocupacion" className={botonClases('secundario')}>
                    Ver la ocupación
                  </Link>
                }
              />
            </Tarjeta>
          ) : (
            <FormularioGrupo opciones={opciones} checkIn={checkIn} checkOut={checkOut} />
          )}
        </div>
      )}
    </Pagina>
  )
}
