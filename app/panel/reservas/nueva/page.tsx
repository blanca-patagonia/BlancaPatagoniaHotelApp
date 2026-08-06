import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { hoyISO, sumarDias, diasEntre } from '@/lib/fechas'
import { FormularioReserva, type OpcionTipo, type OpcionAgencia } from './formulario'
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

  // Agencias activas con convenio: si la reserva entra por una, de ella salen
  // la tarifa neta y la letra del comprobante al facturar.
  const supabase = await crearClienteServidor()
  const { data: agenciasData } = await supabase
    .from('agencias')
    .select('id, nombre, descuento_pct')
    .eq('activo', true)
    .order('nombre')
  const agencias = (agenciasData ?? []) as OpcionAgencia[]

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
    <Pagina ancho="angosto">
      <Link
        href="/panel/reservas"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a reservas
      </Link>

      <Encabezado
        titulo="Nueva reserva"
        descripcion="Primero buscá qué hay libre; después elegís la unidad y cargás al huésped."
        icono="reservas"
      />

      {/* Paso 1. Numerado a la vista: quien no usa mucho la computadora
          necesita saber cuántos pasos faltan, no descubrirlo. */}
      <Tarjeta titulo="1 · ¿Para cuándo?" descripcion="Se muestran solo las unidades libres.">
        <form method="get" className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-3">
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
              defaultValue={checkOut || sumarDias(hoyISO(), 1)}
              className={CAMPO}
            />
          </Campo>
          <Campo etiqueta="Huéspedes">
            <input
              type="number"
              name="huespedes"
              min={1}
              max={7}
              defaultValue={huespedes}
              className={CAMPO}
            />
          </Campo>
          <div className="sm:col-span-3">
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
                descripcion={`Ninguna unidad entra ${huespedes} huésped(es) en ese período. Probá con otras fechas o revisá la grilla de ocupación.`}
                icono="ocupacion"
                accion={
                  <Link href="/panel/ocupacion" className={botonClases('secundario')}>
                    Ver la ocupación
                  </Link>
                }
              />
            </Tarjeta>
          ) : (
            <FormularioReserva
              agencias={agencias}
              opciones={opciones}
              checkIn={checkIn}
              checkOut={checkOut}
              huespedes={huespedes}
              noches={noches}
            />
          )}
        </div>
      )}
    </Pagina>
  )
}
