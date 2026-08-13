import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { responderEncuesta } from './actions'

/**
 * Encuesta de satisfacción del huésped (NPS).
 *
 * Server Component puro: los puntajes son diez radios en un formulario, sin
 * JavaScript en el cliente. Se llega por el token que genera el trigger de
 * check-out.
 */

export const metadata = { title: 'Tu opinión — Blanca Patagonia' }

const PUNTAJES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

interface Fila {
  respondida_en: string | null
  reserva: {
    codigo: string
    huesped: { nombre: string } | null
  } | null
}

/**
 * Motivos con que la acción puede volver por `?error=`.
 *
 * Antes solo se mostraba «puntaje»: los otros dos que la acción ya usaba
 * —`limite` e `invalida`— no se renderizaban, así que un huésped que chocaba con
 * el límite de respuestas por hora no veía nada y creía que el formulario estaba
 * roto.
 */
const MENSAJES_ERROR: Record<string, string> = {
  puntaje: 'Elegí un puntaje del 0 al 10 para continuar.',
  limite: 'Recibimos varias respuestas desde tu conexión. Esperá un rato y probá de nuevo.',
  invalida: 'Este enlace de encuesta no es válido o ya venció.',
  guardar: 'No pudimos guardar tu respuesta. Probá de nuevo.',
}

export default async function EncuestaPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const { token } = await params
  const sp = await searchParams

  const admin = crearClienteAdmin()
  const { data } = await admin
    .from('encuestas_satisfaccion')
    .select(
      'respondida_en, reserva:reservas(codigo, huesped:huespedes!reservas_huesped_id_fkey(nombre))',
    )
    .eq('token', token)
    .maybeSingle()

  const fila = data as unknown as Fila | null
  if (!fila) notFound()

  const yaRespondio = Boolean(fila.respondida_en) || sp.ok === '1'
  const nombre = fila.reserva?.huesped?.nombre

  return (
    <main className="flex flex-1 items-center justify-center bg-gradient-to-b from-lago-50 to-stone-100 px-4 py-12">
      <div className="w-full max-w-xl">
        <header className="mb-6 text-center">
          <p className="text-xs font-medium tracking-[0.2em] text-lago-700 uppercase">
            Blanca Patagonia
          </p>
          <h1 className="font-display mt-1 text-3xl font-semibold text-stone-900">
            {yaRespondio ? '¡Gracias!' : `¿Cómo fue tu estadía${nombre ? `, ${nombre}` : ''}?`}
          </h1>
        </header>

        {yaRespondio ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
            <p className="text-stone-700">
              Ya recibimos tu respuesta. Gracias por tomarte el momento: nos sirve para mejorar.
            </p>
            <p className="mt-2 text-sm text-stone-500">Podés cerrar esta página.</p>
          </div>
        ) : (
          <form
            action={responderEncuesta}
            className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
          >
            <input type="hidden" name="token" value={token} />

            {sp.error && (
              <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
                {MENSAJES_ERROR[sp.error] ?? 'No pudimos guardar tu respuesta. Probá de nuevo.'}
              </p>
            )}

            <fieldset>
              <legend className="text-sm font-medium text-stone-800">
                ¿Qué tan probable es que recomiendes Blanca Patagonia a un amigo o colega?
              </legend>

              <div className="mt-3 flex flex-wrap justify-between gap-1.5">
                {PUNTAJES.map((p) => (
                  <label
                    key={p}
                    className="flex cursor-pointer flex-col items-center gap-1 text-xs text-stone-500"
                  >
                    <input
                      type="radio"
                      name="puntaje"
                      value={p}
                      required
                      className="peer sr-only"
                      aria-label={`Puntaje ${p} de 10`}
                    />
                    <span className="tabular flex size-9 items-center justify-center rounded-lg bg-stone-100 font-medium text-stone-700 ring-1 ring-stone-200 transition peer-checked:bg-lago-700 peer-checked:text-white peer-checked:ring-lago-700 hover:bg-stone-200">
                      {p}
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-1.5 flex justify-between text-xs text-stone-400">
                <span>Nada probable</span>
                <span>Muy probable</span>
              </div>
            </fieldset>

            <label className="mt-6 block">
              <span className="text-sm font-medium text-stone-800">
                ¿Querés contarnos algo más? <span className="text-stone-400">(opcional)</span>
              </span>
              <textarea
                name="comentario"
                rows={4}
                placeholder="Lo que más te gustó, o lo que podríamos mejorar…"
                className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600"
              />
            </label>

            <button className="mt-4 w-full rounded-lg bg-lago-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-lago-800">
              Enviar mi respuesta
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-stone-400">
          Tu respuesta es anónima para el equipo operativo y se usa solo para mejorar el servicio.
        </p>
      </div>
    </main>
  )
}
