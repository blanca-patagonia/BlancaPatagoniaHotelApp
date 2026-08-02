import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { hoyISO, formatoFechaCorta } from '@/lib/fechas'
import {
  motivoNoFirmable,
  MENSAJES_NO_FIRMABLE,
  ETIQUETAS_TIPO_CONTRATO,
  type EstadoContrato,
  type TipoContrato,
} from '@/lib/domain/contratos'
import { firmarContrato, rechazarContrato } from './actions'

/**
 * Vista pública de firma de un contrato.
 *
 * No requiere cuenta: el token opaco de la URL actúa como credencial y se
 * resuelve con `service_role` en el servidor (mismo patrón que la confirmación
 * de reserva). Es Server Component puro, sin JavaScript en el cliente.
 */

export const metadata = { title: 'Firmar contrato — Blanca Patagonia' }

interface Fila {
  fecha_firma: string | null
  firmante_nombre: string | null
  contrato: {
    tipo: TipoContrato
    titulo: string
    contenido: string | null
    estado: EstadoContrato
    vigencia_desde: string | null
    vigencia_hasta: string | null
  } | null
}

export default async function FirmarPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ ok?: string; error?: string; rechazado?: string }>
}) {
  const { token } = await params
  const sp = await searchParams

  const admin = crearClienteAdmin()
  const { data } = await admin
    .from('firmas')
    .select(
      'fecha_firma, firmante_nombre, contrato:contratos(tipo, titulo, contenido, estado, vigencia_desde, vigencia_hasta)',
    )
    .eq('token', token)
    .maybeSingle()

  const fila = data as unknown as Fila | null
  if (!fila?.contrato) notFound()
  const contrato = fila.contrato

  const motivo = motivoNoFirmable(contrato, hoyISO())
  const yaFirmado = Boolean(fila.fecha_firma)

  return (
    <main className="flex flex-1 justify-center bg-gradient-to-b from-lago-50 to-stone-100 px-4 py-10">
      <div className="w-full max-w-2xl">
        <header className="mb-6 text-center">
          <p className="text-xs font-medium tracking-[0.2em] text-lago-700 uppercase">
            Blanca Patagonia
          </p>
          <h1 className="font-display mt-1 text-3xl font-semibold text-stone-900">
            {contrato.titulo}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Contrato con {ETIQUETAS_TIPO_CONTRATO[contrato.tipo].toLowerCase()}
            {contrato.vigencia_desde && ` · vigente desde ${formatoFechaCorta(contrato.vigencia_desde)}`}
            {contrato.vigencia_hasta && ` hasta ${formatoFechaCorta(contrato.vigencia_hasta)}`}
          </p>
        </header>

        {sp.ok && (
          <p
            role="status"
            className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200"
          >
            Firma registrada. Gracias: quedó constancia de la aceptación con la fecha y su huella
            digital. Podés cerrar esta página.
          </p>
        )}
        {sp.rechazado && (
          <p
            role="status"
            className="mb-4 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700 ring-1 ring-stone-200"
          >
            Registramos que rechazaste el contrato. El hotel va a tomar contacto.
          </p>
        )}
        {sp.error === 'nombre' && (
          <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
            Escribí tu nombre y apellido para poder firmar.
          </p>
        )}
        {sp.error && sp.error !== 'nombre' && (
          <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
            {MENSAJES_NO_FIRMABLE[sp.error as keyof typeof MENSAJES_NO_FIRMABLE] ??
              'No pudimos registrar la firma.'}
          </p>
        )}

        <article className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-sm leading-relaxed whitespace-pre-line text-stone-700">
            {contrato.contenido}
          </p>
        </article>

        {yaFirmado ? (
          <p className="mt-4 rounded-2xl bg-white px-5 py-4 text-center text-sm text-stone-600 ring-1 ring-stone-200">
            Este contrato ya fue firmado
            {fila.firmante_nombre ? ` por ${fila.firmante_nombre}` : ''} el{' '}
            {new Date(fila.fecha_firma!).toLocaleDateString('es-AR')}.
          </p>
        ) : motivo ? (
          <p className="mt-4 rounded-2xl bg-white px-5 py-4 text-center text-sm text-stone-600 ring-1 ring-stone-200">
            {MENSAJES_NO_FIRMABLE[motivo]}
          </p>
        ) : (
          <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="font-display text-lg font-semibold text-stone-900">Aceptación</h2>
            <p className="mt-1 text-sm text-stone-500">
              Al firmar dejás constancia de que leíste y aceptás el texto de arriba. Se registran la
              fecha, tu dirección IP y una huella digital del documento.
            </p>

            <form action={firmarContrato} className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="token" value={token} />
              <input
                name="firmante_nombre"
                required
                placeholder="Nombre y apellido"
                aria-label="Nombre y apellido de quien firma"
                className="rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-lago-600"
              />
              <button className="rounded-lg bg-lago-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-lago-800">
                Firmar el contrato
              </button>
            </form>

            <form action={rechazarContrato} className="mt-2">
              <input type="hidden" name="token" value={token} />
              <button className="w-full rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 transition hover:bg-stone-50">
                No acepto
              </button>
            </form>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-stone-400">
          Constancia de aceptación con trazabilidad. No constituye firma digital con validez legal
          en los términos de la Ley 25.506.
        </p>
      </div>
    </main>
  )
}
