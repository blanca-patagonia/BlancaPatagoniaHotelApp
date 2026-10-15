import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { opcionesDePago, type OpcionDePago } from '@/lib/payments/opciones'
import { motivoNoSeCobra } from '@/lib/domain/cobro'
import { formatearUSD } from '@/lib/domain/moneda'
import type { EstadoReserva } from '@/lib/domain/reservas'
import { Tarjeta, Mensaje, Titulo, botonPublico } from '../../../_publico/ui'
import { Marco, Aviso } from '../../../_publico/marco'
import { pagarDesdeElPortal } from './actions'

/**
 * Pantalla de pago del huésped.
 *
 * El principio de interfaz del proyecto vale especialmente acá: **nada oculto**.
 * Cada medio de pago se muestra con su nombre, su moneda, el importe exacto que
 * se va a cobrar y con qué se puede pagar por ese camino. Un huésped que está por
 * dar su tarjeta tiene que poder ver el número que le van a debitar **en la
 * moneda en la que se lo van a debitar**, antes de tocar nada: si acá dijera
 * «USD 145,20» y en el resumen le apareciera un importe en pesos que no
 * reconoce, la reacción normal es desconocer el consumo.
 */

/** Los mensajes de error que puede traer la vuelta de una acción. */
const MENSAJES_ERROR: Record<string, string> = {
  no_encontrada: 'No encontramos esa reserva. Revisá el enlace que te enviamos.',
  sin_datos: 'No pudimos calcular el saldo en este momento. Probá de nuevo en un minuto.',
  no_cobrable: 'Esta reserva no tiene un saldo que se pueda pagar en línea.',
  pasarela:
    'No pudimos abrir el medio de pago. Probá con otro, o escribinos y lo resolvemos por teléfono.',
}

export default async function PagarPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { token } = await params
  const { error } = await searchParams

  // El token opaco actúa como credencial de acceso; se consulta con service_role.
  const admin = crearClienteAdmin()
  const { data: reserva } = await admin
    .from('reservas')
    .select('id, codigo, estado')
    .eq('token', token)
    .maybeSingle()

  if (!reserva) notFound()

  const cobro = await estadoDeCobro(admin, reserva.id)
  if (!cobro) {
    return (
      <Aviso titulo="No pudimos calcular tu saldo">
        Es un problema nuestro, no tuyo. Probá de nuevo en un minuto o escribinos y lo
        resolvemos por teléfono.
      </Aviso>
    )
  }

  const impedimento = motivoNoSeCobra(reserva.estado as EstadoReserva, cobro.saldo)
  if (impedimento) {
    return (
      <Aviso
        titulo={cobro.saldada ? 'Ya está todo pago' : 'No hay nada para pagar acá'}
        accion={
          <Link href={`/reservar/confirmacion/${token}`} className={botonPublico('secundario')}>
            Ver mi reserva
          </Link>
        }
      >
        {impedimento}
      </Aviso>
    )
  }

  /*
    Qué se cobra: la seña si todavía no se pagó ninguna, el saldo si ya está.
    Se decide acá y se manda en el formulario, pero la acción **lo vuelve a
    decidir** con los mismos datos: lo que viaja por el navegador no define
    contra qué se imputa la plata.
  */
  const tipo = cobro.tieneSenia ? 'saldo' : 'senia'
  const montoUSD = tipo === 'senia' ? Math.min(cobro.senia, cobro.saldo) : cobro.saldo

  const opciones = await opcionesDePago(montoUSD)

  return (
    <Marco ancho="angosto" volver={{ href: `/reservar/confirmacion/${token}`, texto: 'Mi reserva' }}>
      <Titulo
        titulo={tipo === 'senia' ? 'Pagá la seña' : 'Pagá el saldo'}
        descripcion={`Reserva ${reserva.codigo}. Elegí cómo querés pagar.`}
      />

      {error && (
        <div className="mb-5">
          <Mensaje tono="error">
            {MENSAJES_ERROR[error] ?? 'No pudimos completar la operación. Probá de nuevo.'}
          </Mensaje>
        </div>
      )}

      <Tarjeta className="mb-5">
        <dl className="flex flex-col gap-3 px-5 py-5 sm:px-6">
          <Fila etiqueta="Total de la estadía" valor={formatearUSD(cobro.total)} />
          {cobro.pagado > 0 && <Fila etiqueta="Ya pagaste" valor={formatearUSD(cobro.pagado)} />}
          <Fila
            etiqueta={tipo === 'senia' ? 'Seña a pagar ahora' : 'Saldo a pagar ahora'}
            valor={formatearUSD(montoUSD)}
            destacado
          />
        </dl>
      </Tarjeta>

      {opciones.length === 0 ? (
        <Mensaje tono="aviso">
          <strong className="font-medium">El pago en línea no está disponible.</strong> Escribinos
          y coordinamos la transferencia o el pago al llegar.
        </Mensaje>
      ) : (
        <div className="flex flex-col gap-3">
          {opciones.map((o) => (
            <OpcionDePago key={o.medio.id} opcion={o} token={token} tipo={tipo} />
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-sm leading-relaxed text-stone-500">
        El pago lo procesa la pasarela, no el hotel. Blanca Patagonia nunca guarda el número de
        tu tarjeta.
      </p>
    </Marco>
  )
}

/* ─────────────────────────────────────────────────────── opciones ──────── */

/* ──────────────────────────────────────────────────────── piezas ───────── */

function OpcionDePago({
  opcion,
  token,
  tipo,
}: {
  opcion: OpcionDePago
  token: string
  tipo: 'senia' | 'saldo'
}) {
  // `valor` es el nombre con el que se elige la pasarela (ver `OpcionDePago`).
  const valorMedio = opcion.valor

  return (
    <form action={pagarDesdeElPortal}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="medio" value={valorMedio} />

      <button
        type="submit"
        className="toque w-full rounded-2xl border border-stone-200 bg-white p-5 text-left shadow-sm transition hover:border-lago-400 hover:shadow focus:border-lago-600 focus:outline-none"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-display text-lg font-semibold text-stone-900">
            {opcion.medio.titulo}
          </span>
          <span className="tabular font-display text-lg font-semibold text-lago-800">
            {opcion.importe}
          </span>
        </span>

        <span className="mt-1 block text-sm leading-relaxed text-stone-600">
          {opcion.medio.detalle}
        </span>

        {opcion.equivalencia && (
          <span className="mt-1 block text-sm text-stone-500">{opcion.equivalencia}</span>
        )}

        <span className="mt-3 flex flex-wrap gap-1.5">
          {opcion.medio.formas.map((f) => (
            <span
              key={f}
              className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-600"
            >
              {f}
            </span>
          ))}
        </span>
      </button>
    </form>
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
      <dd
        className={
          destacado
            ? 'tabular font-display text-lg font-semibold text-stone-900'
            : 'tabular font-medium text-stone-800'
        }
      >
        {valor}
      </dd>
    </div>
  )
}
