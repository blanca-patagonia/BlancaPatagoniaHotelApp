import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { estadoDeCobro, type EstadoCobro } from '@/lib/reservas/cobro'
import { motivoNoSeCobra } from '@/lib/domain/cobro'
import { formatearUSD } from '@/lib/domain/moneda'
import type { EstadoReserva } from '@/lib/domain/reservas'
import { parsearPeriodo, formatoFechaCorta, diasEntre } from '@/lib/fechas'
import { Marco, Mensaje, Tarjeta, botonPublico } from '../../../_publico/ui'

interface Reserva {
  id: string
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
      'id, codigo, estado, total, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, email), estadias(periodo, unidad:unidades(nombre, tipo:tipos_unidad(nombre)))',
    )
    .eq('token', token)
    .single()
  if (!data) notFound()

  const reserva = data as unknown as Reserva
  const estadia = reserva.estadias?.[0]
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0

  // El estado de cobro sale de la base, no de la vuelta de la pasarela: la URL
  // de retorno de un checkout se puede abrir a mano sin haber pagado nada.
  // Quien confirma un cobro es el webhook, y esto lee lo que él escribió.
  const cobro = await estadoDeCobro(admin, reserva.id)

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
          <Fila etiqueta="Total" valor={formatearUSD(cobro?.total ?? Number(reserva.total))} />
          {cobro && cobro.pagado > 0 && (
            <Fila etiqueta="Pagado" valor={formatearUSD(cobro.pagado)} />
          )}
          {cobro && (
            <Fila
              etiqueta={cobro.saldada ? 'Saldo' : cobro.tieneSenia ? 'Saldo a abonar' : 'Seña a abonar'}
              valor={formatearUSD(
                cobro.saldada ? 0 : cobro.tieneSenia ? cobro.saldo : Math.min(cobro.senia, cobro.saldo),
              )}
              destacado
            />
          )}
        </dl>

        <div className="border-t border-stone-100 px-6 py-5 sm:px-8">
          <EstadoDePago token={token} reserva={reserva} cobro={cobro} />

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

/**
 * Qué le decimos al huésped sobre su pago, y qué puede hacer al respecto.
 *
 * Los cuatro casos son distintos y llevan a acciones distintas; mostrarlos con
 * un texto único —«hay que abonar la seña»— era lo que había antes, y le pedía
 * la seña incluso a quien ya la había pagado.
 */
function EstadoDePago({
  token,
  reserva,
  cobro,
}: {
  token: string
  reserva: Reserva
  cobro: EstadoCobro | null
}) {
  // Sin datos de cobro no se inventa un estado: se dice que no se pudo calcular.
  if (!cobro) {
    return (
      <Mensaje tono="aviso">
        No pudimos calcular el saldo en este momento. Escribinos y lo revisamos con vos.
      </Mensaje>
    )
  }

  if (cobro.saldada) {
    return (
      <Mensaje tono="ok">
        <strong className="font-medium">Está todo pago.</strong> No tenés que hacer nada más;
        te esperamos el día de la llegada.
      </Mensaje>
    )
  }

  const impedimento = motivoNoSeCobra(reserva.estado as EstadoReserva, cobro.saldo)

  return (
    <>
      <Mensaje tono="aviso">
        <strong className="font-medium">
          {cobro.tieneSenia
            ? 'Queda un saldo pendiente.'
            : 'La reserva todavía no está confirmada.'}
        </strong>{' '}
        {cobro.tieneSenia
          ? 'Podés abonarlo ahora o al llegar al hotel.'
          : 'Queda tomada por 5 días; para asegurarla hay que abonar la seña.'}
      </Mensaje>

      {!impedimento && (
        <div className="mt-4">
          <Link href={`/reservar/pagar/${token}`} className={botonPublico('primario')}>
            {cobro.tieneSenia ? 'Pagar el saldo' : 'Pagar la seña'}
          </Link>
        </div>
      )}
    </>
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
