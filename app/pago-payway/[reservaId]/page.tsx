import { notFound } from 'next/navigation'
import { proveedoresHabilitados, nombreClave } from '@/lib/payments'
import { esProduccion } from '@/lib/integraciones/seleccion'
import { formatearLocal } from '@/lib/domain/divisas'
import { Marco, Tarjeta, Mensaje, Titulo } from '../../_publico/ui'
import { FormularioPayway } from './formulario'

const BASE_API_SANDBOX = 'https://developers.decidir.com/api/v2'
const BASE_API_PRODUCCION = 'https://ventasonline.payway.com.ar/api/v2'

/**
 * Checkout propio de Payway (ver ADR 0038 y `lib/payments/payway.ts`).
 *
 * A diferencia de Mercado Pago y Stripe, acá no se redirige a una pasarela
 * alojada: esta ES la pasarela, desde el punto de vista del huésped. La
 * tarjeta se tokeniza en el navegador (`FormularioPayway`) y el pago se
 * ejecuta recién en el servidor con esa credencial de un solo uso.
 */
export const dynamic = 'force-dynamic'

export default async function PagoPaywayPage({
  params,
  searchParams,
}: {
  params: Promise<{ reservaId: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const habilitado = proveedoresHabilitados().some((p) => nombreClave(p) === 'payway')
  if (!habilitado) notFound()

  const publicKey = process.env.PAYWAY_PUBLIC_KEY?.trim()
  if (!publicKey) notFound()

  const { reservaId } = await params
  const q = await searchParams
  const externalId = q.external_id ?? ''
  const monto = Number(q.monto ?? 0)
  const descripcion = q.descripcion ?? 'Pago'
  const volver = q.volver ?? '/'
  const cancelar = q.cancelar ?? '/'

  if (!externalId || !reservaId || !(monto > 0)) notFound()

  return (
    <Marco ancho="angosto">
      <Titulo titulo="Pagar con tarjeta" descripcion={descripcion} />

      <div className="mb-5">
        <Mensaje tono="aviso">
          El importe a pagar es <strong>{formatearLocal(monto, 'ARS')}</strong>. Tus datos de
          tarjeta viajan directo a Payway; este sistema nunca los recibe.
        </Mensaje>
      </div>

      <Tarjeta>
        <div className="px-5 py-5 sm:px-6">
          <FormularioPayway
            publicKey={publicKey}
            urlApi={esProduccion() ? BASE_API_PRODUCCION : BASE_API_SANDBOX}
            externalId={externalId}
            reservaId={reservaId}
            monto={monto}
            volver={volver}
            cancelar={cancelar}
          />
        </div>
      </Tarjeta>
    </Marco>
  )
}
