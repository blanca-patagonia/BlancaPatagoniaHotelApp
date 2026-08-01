import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { seniaSugerida } from '@/lib/domain/pagos'
import { parsearPeriodo, formatoFechaCorta, diasEntre } from '@/lib/fechas'

interface Reserva {
  codigo: string
  estado: string
  total: number | string
  huesped: { apellido: string; email: string | null } | null
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
      'codigo, estado, total, huesped:huespedes!reservas_huesped_id_fkey(apellido, email), estadias(periodo, unidad:unidades(nombre, tipo:tipos_unidad(nombre)))',
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
    <main className="flex flex-1 flex-col bg-stone-50">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight text-lago-700">
          Blanca Patagonia
        </Link>
      </header>

      <div className="mx-auto w-full max-w-xl px-6 py-12">
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
            ✓
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            ¡Reserva registrada!
          </h1>
          <p className="mt-2 text-stone-600">
            Gracias{reserva.huesped ? `, ${reserva.huesped.apellido}` : ''}. Tu código de
            reserva es:
          </p>
          <p className="mt-2 text-2xl font-bold tracking-wider text-lago-700">{reserva.codigo}</p>

          <dl className="mt-6 flex flex-col gap-2 rounded-lg bg-stone-50 p-4 text-left text-sm">
            {estadia?.unidad && (
              <Fila etiqueta="Alojamiento" valor={`${estadia.unidad.tipo?.nombre ?? estadia.unidad.nombre}`} />
            )}
            {periodo && (
              <Fila
                etiqueta="Fechas"
                valor={`${formatoFechaCorta(periodo.desde)} → ${formatoFechaCorta(periodo.hasta)} (${noches} noches)`}
              />
            )}
            <Fila etiqueta="Total" valor={`USD ${Number(reserva.total).toLocaleString('es-AR')}`} />
            <Fila etiqueta="Seña a abonar" valor={`USD ${senia.toLocaleString('es-AR')}`} />
          </dl>

          <p className="mt-6 text-sm text-stone-500">
            Te enviamos un email de confirmación
            {reserva.huesped?.email ? ` a ${reserva.huesped.email}` : ''}. La reserva queda{' '}
            <strong>pendiente</strong> hasta el pago de la seña (primera noche), dentro de los
            5 días.
          </p>

          <Link
            href="/"
            className="mt-6 inline-block rounded-lg border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  )
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-stone-500">{etiqueta}</dt>
      <dd className="font-medium text-stone-800">{valor}</dd>
    </div>
  )
}
