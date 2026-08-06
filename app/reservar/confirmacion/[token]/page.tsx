import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { seniaSugerida } from '@/lib/domain/pagos'
import { parsearPeriodo, formatoFechaCorta, diasEntre } from '@/lib/fechas'
import { Marco, Mensaje, Tarjeta, botonPublico } from '../../../_publico/ui'

interface Reserva {
  codigo: string
  estado: string
  total: number | string
  huesped: { apellido: string; nombre: string; email: string | null } | null
  estadias: {
    periodo: string
    unidad: { nombre: string; tipo: { nombre: string } | null } | null
  }[]
}

export default async function ConfirmacionPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  // El token opaco actúa como credencial de acceso; se consulta con service_role.
  const admin = crearClienteAdmin()
  const { data } = await admin
    .from('reservas')
    .select(
      'codigo, estado, total, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, email), estadias(periodo, unidad:unidades(nombre, tipo:tipos_unidad(nombre)))',
    )
    .eq('token', token)
    .single()
  if (!data) notFound()

  const reserva = data as unknown as Reserva
  const estadia = reserva.estadias?.[0]
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0
  const senia = seniaSugerida(Number(reserva.total), noches)

  return (
    <Marco ancho="angosto">
      <Tarjeta>
        <div className="px-6 py-8 text-center sm:px-8">
          <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            <svg
              viewBox="0 0 24 24"
              className="size-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>

          <h1 className="font-display text-3xl leading-tight font-semibold text-stone-900">
            Te esperamos
          </h1>
          <p className="mt-2 leading-relaxed text-stone-600">
            Listo{reserva.huesped ? `, ${reserva.huesped.nombre || reserva.huesped.apellido}` : ''}.
            Guardá este código, es el que te van a pedir al llegar.
          </p>

          {/* El código, grande y aparte: es el único dato que el huésped
              necesita tener a mano después de cerrar la página. */}
          <p className="tabular mt-5 rounded-2xl bg-lago-50 px-4 py-4 font-display text-3xl font-semibold tracking-wider text-lago-800 ring-1 ring-lago-100">
            {reserva.codigo}
          </p>
        </div>

        <dl className="flex flex-col gap-3 border-t border-stone-100 px-6 py-5 text-left sm:px-8">
          {estadia?.unidad && (
            <Fila
              etiqueta="Alojamiento"
              valor={estadia.unidad.tipo?.nombre ?? estadia.unidad.nombre}
            />
          )}
          {periodo && (
            <>
              <Fila
                etiqueta="Llegada"
                valor={`${formatoFechaCorta(periodo.desde)} · desde las 15:00`}
              />
              <Fila
                etiqueta="Salida"
                valor={`${formatoFechaCorta(periodo.hasta)} · hasta las 10:00`}
              />
              <Fila etiqueta="Noches" valor={String(noches)} />
            </>
          )}
          <Fila etiqueta="Total" valor={`USD ${Number(reserva.total).toLocaleString('es-AR')}`} />
          <Fila etiqueta="Seña a abonar" valor={`USD ${senia.toLocaleString('es-AR')}`} destacado />
        </dl>

        <div className="border-t border-stone-100 px-6 py-5 sm:px-8">
          <Mensaje tono="aviso">
            <strong className="font-medium">La reserva todavía no está confirmada.</strong> Queda
            tomada por 5 días; para asegurarla hay que abonar la seña. Te escribimos
            {reserva.huesped?.email ? ` a ${reserva.huesped.email}` : ''} para coordinar cómo.
          </Mensaje>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/" className={botonPublico('secundario')}>
              Volver al inicio
            </Link>
            <Link href="/reservar" className={botonPublico('secundario')}>
              Reservar otra estadía
            </Link>
          </div>
        </div>
      </Tarjeta>

      <p className="mt-6 text-center text-sm text-stone-500">
        Guardá esta página en favoritos: podés volver a abrirla cuando quieras con el mismo enlace.
      </p>
    </Marco>
  )
}

function Fila({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string
  valor: string
  destacado?: boolean
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-stone-500">{etiqueta}</dt>
      <dd className={destacado ? 'font-semibold text-stone-900' : 'font-medium text-stone-800'}>
        {valor}
      </dd>
    </div>
  )
}
