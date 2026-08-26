import { notFound } from 'next/navigation'
import { proveedoresHabilitados, nombreClave } from '@/lib/payments'
import { formatearUSD } from '@/lib/domain/moneda'
import { formatearLocal } from '@/lib/domain/divisas'
import { MONEDA_BASE, type MonedaCobro } from '@/lib/domain/cobro'
import { esMonedaExtranjera } from '@/lib/domain/divisas'
import { Marco, Tarjeta, Mensaje, Titulo, botonPublico } from '../_publico/ui'
import { resolverPagoSimulado } from './actions'

/**
 * Pasarela simulada.
 *
 * Es la pantalla a la que manda `ProveedorSimulado.crearCheckout`, y existe para
 * que el circuito de cobro se pueda **recorrer entero** sin contratar una
 * pasarela: se genera el link, se elige un desenlace, se dispara el webhook
 * firmado de verdad y la reserva se salda sola. Sin ella, el flujo se cortaba en
 * el redirect y la URL que devolvía el stub daba 404.
 *
 * Dos cosas que la hacen honesta y no un atajo:
 *
 * · **Dice lo que es, en grande.** Nadie que llegue acá puede confundirla con un
 *   cobro real: el aviso es lo primero que se lee y los botones se llaman
 *   «aprobar» y «rechazar», que es vocabulario de simulador y no de pasarela.
 * · **Ejercita el camino real.** El webhook que dispara va firmado con el mismo
 *   HMAC y pasa por las mismas validaciones que uno de MercadoPago. Lo que se
 *   prueba acá es el código que va a correr en producción.
 *
 * Sólo existe si alguien habilitó el simulador a propósito en `PAGO_PROVIDER`;
 * si no, responde 404 (ADR 0018).
 */

/*
  Nunca se prerenderiza.

  Depende de dos cosas que sólo existen en tiempo de ejecución: los parámetros
  del checkout que la invocó y el valor de `PAGO_PROVIDER`. Sin esto, Next
  intentaba generarla estáticamente durante el build —donde `NODE_ENV` ya es
  `production` y la variable todavía no está— y la guarda del ADR 0018 hacía
  fallar la compilación entera. La guarda está bien; la página estaba mal
  declarada.
*/
export const dynamic = 'force-dynamic'

export default async function PagoSimuladoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  // Sin el simulador habilitado, esta pantalla no debe ni existir. Es la misma
  // regla que hace fallar a los otros simuladores en producción.
  const habilitado = proveedoresHabilitados().some((p) => nombreClave(p) === 'simulado')
  if (!habilitado) notFound()

  const q = await searchParams
  const externalId = q.external_id ?? ''
  const reservaId = q.reserva_id ?? ''
  const monto = Number(q.monto ?? 0)
  const moneda = (q.moneda ?? MONEDA_BASE) as MonedaCobro
  const tipo = q.tipo === 'senia' ? 'senia' : 'saldo'
  const volver = q.volver ?? '/'
  const descripcion = q.descripcion ?? 'Pago'

  if (!externalId || !(monto > 0)) notFound()

  const importe =
    moneda !== MONEDA_BASE && esMonedaExtranjera(moneda)
      ? formatearLocal(monto, moneda)
      : formatearUSD(monto)

  return (
    <Marco ancho="angosto">
      <Titulo
        titulo="Pasarela de prueba"
        descripcion="Elegí cómo querés que termine este pago para ver qué hace el sistema."
      />

      <div className="mb-5">
        <Mensaje tono="aviso">
          <strong className="font-medium">Acá no se mueve dinero.</strong> Es un simulador para
          demostrar el circuito de cobro. Ninguna tarjeta se debita y no hay pasarela real
          detrás de esta pantalla.
        </Mensaje>
      </div>

      <Tarjeta className="mb-5">
        <dl className="flex flex-col gap-3 px-5 py-5 sm:px-6">
          <Fila etiqueta="Concepto" valor={descripcion} />
          <Fila etiqueta="Tipo" valor={tipo === 'senia' ? 'Seña' : 'Saldo'} />
          <Fila etiqueta="Importe" valor={importe} destacado />
        </dl>
      </Tarjeta>

      <div className="flex flex-col gap-3">
        <Desenlace
          estado="aprobado"
          titulo="Aprobar el pago"
          detalle="El sistema registra el cobro y, si cubre la cuenta, marca la reserva como pagada."
          variante="primario"
          datos={{ externalId, reservaId, monto, moneda, tipo, volver }}
        />
        <Desenlace
          estado="pendiente"
          titulo="Dejarlo pendiente"
          detalle="Como un pago en efectivo por Rapipago: el huésped todavía no pagó. La reserva no se salda."
          variante="secundario"
          datos={{ externalId, reservaId, monto, moneda, tipo, volver }}
        />
        <Desenlace
          estado="rechazado"
          titulo="Rechazar el pago"
          detalle="Como una tarjeta sin fondos. Después se puede reintentar con el mismo enlace."
          variante="secundario"
          datos={{ externalId, reservaId, monto, moneda, tipo, volver }}
        />
      </div>
    </Marco>
  )
}

interface DatosPago {
  externalId: string
  reservaId: string
  monto: number
  moneda: string
  tipo: string
  volver: string
}

function Desenlace({
  estado,
  titulo,
  detalle,
  variante,
  datos,
}: {
  estado: string
  titulo: string
  detalle: string
  variante: 'primario' | 'secundario'
  datos: DatosPago
}) {
  return (
    <form action={resolverPagoSimulado}>
      <input type="hidden" name="estado" value={estado} />
      <input type="hidden" name="external_id" value={datos.externalId} />
      <input type="hidden" name="reserva_id" value={datos.reservaId} />
      <input type="hidden" name="monto" value={String(datos.monto)} />
      <input type="hidden" name="moneda" value={datos.moneda} />
      <input type="hidden" name="tipo" value={datos.tipo} />
      <input type="hidden" name="volver" value={datos.volver} />

      <button type="submit" className={botonPublico(variante, 'w-full flex-col items-start')}>
        <span className="font-medium">{titulo}</span>
        <span
          className={`text-sm font-normal ${variante === 'primario' ? 'text-lago-100' : 'text-stone-500'}`}
        >
          {detalle}
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
            : 'font-medium text-stone-800'
        }
      >
        {valor}
      </dd>
    </div>
  )
}
