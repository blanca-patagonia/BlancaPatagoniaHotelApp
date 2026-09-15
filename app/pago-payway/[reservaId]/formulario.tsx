'use client'

/**
 * Formulario de tokenización de Payway (client component).
 *
 * Carga el SDK de Payway (`decidir.js`, ver ADR 0038) y le entrega el
 * formulario ENTERO: es el propio script el que lee los campos marcados con
 * `data-decidir` y arma el request de tokenización contra Payway, con la
 * llave PÚBLICA. Ni el número de tarjeta ni el CVV pasan nunca por un
 * `fetch` de este código ni por la Server Action — el único dato que sale de
 * acá hacia el servidor es el `token` que devuelve Payway.
 *
 * ⚠️ Los nombres de método (`new Decidir(url)`, `.setPublishableKey()`,
 * `.createToken(form, callback)`) salen de la documentación pública de los
 * SDKs de Payway (ver el docblock de `lib/payments/payway.ts`) y no se
 * probaron contra una cuenta real. Si Payway cambia esa API, el síntoma acá
 * es «no aparece nunca el token» — conviene probarlo contra el sandbox antes
 * de activar `PAGO_PROVIDER=payway` en producción.
 */

import { useId, useState } from 'react'
import Script from 'next/script'
import { botonPublico, CAMPO_PUBLICO, Campo, Mensaje } from '@/app/_publico/ui'
import { finalizarPagoPayway } from './actions'

const SCRIPT_DECIDIR = 'https://ventasonline.payway.com.ar/static/v2.6.4/decidir.js'

/** Forma mínima del objeto global que expone `decidir.js`. No hay tipos oficiales publicados. */
interface DecidirSdk {
  new (baseUrl: string): {
    setPublishableKey(key: string): void
    setTimeout(ms: number): void
    createToken(
      form: HTMLFormElement,
      callback: (status: number, respuesta: { token?: string; error?: unknown }) => void,
    ): void
  }
}

declare global {
  interface Window {
    Decidir?: DecidirSdk
  }
}

export function FormularioPayway({
  publicKey,
  urlApi,
  externalId,
  reservaId,
  monto,
  volver,
  cancelar,
}: {
  publicKey: string
  urlApi: string
  externalId: string
  reservaId: string
  monto: number
  volver: string
  cancelar: string
}) {
  const idFormulario = useId()
  const [scriptListo, setScriptListo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function tokenizarYPagar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!window.Decidir) {
      setError('No se pudo cargar la pasarela de pago. Recargá la página e intentá de nuevo.')
      return
    }

    setEnviando(true)

    // El SDK no está probado contra una cuenta real (ver docblock de arriba):
    // si su API difiere de la documentada, cualquiera de estas tres llamadas
    // puede tirar una excepción SÍNCRONA. Sin este try/catch, `enviando`
    // quedaba en `true` para siempre — el botón trabado en «Procesando…» sin
    // ningún mensaje y sin forma de reintentar salvo recargar la página.
    try {
      const decidir = new window.Decidir(urlApi)
      decidir.setPublishableKey(publicKey)
      decidir.setTimeout(8000)

      decidir.createToken(e.currentTarget, (status, respuesta) => {
        if ((status !== 200 && status !== 201) || !respuesta.token) {
          setEnviando(false)
          setError('La tarjeta no pudo tokenizarse. Revisá los datos e intentá de nuevo.')
          return
        }

        finalizarPagoPayway({ token: respuesta.token, externalId, reservaId, monto })
          .then((r) => {
            if (r.error) {
              setEnviando(false)
              setError(r.error)
              return
            }
            window.location.href = volver
          })
          .catch(() => {
            setEnviando(false)
            setError('No se pudo confirmar el pago. Intentá de nuevo.')
          })
      })
    } catch {
      setEnviando(false)
      setError('La pasarela de pago no respondió como se esperaba. Recargá la página e intentá de nuevo.')
    }
  }

  return (
    <>
      <Script src={SCRIPT_DECIDIR} strategy="afterInteractive" onReady={() => setScriptListo(true)} />

      {error && (
        <div className="mb-4">
          <Mensaje tono="error">{error}</Mensaje>
        </div>
      )}

      <form id={idFormulario} onSubmit={tokenizarYPagar} className="flex flex-col gap-4">
        <Campo etiqueta="Número de tarjeta" requerido>
          <input
            data-decidir="card_number"
            inputMode="numeric"
            autoComplete="cc-number"
            required
            className={CAMPO_PUBLICO}
          />
        </Campo>
        <Campo etiqueta="Nombre del titular, como figura en la tarjeta" requerido>
          <input data-decidir="card_holder_name" autoComplete="cc-name" required className={CAMPO_PUBLICO} />
        </Campo>
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Vencimiento (MM)" requerido>
            <input
              data-decidir="card_expiration_month"
              inputMode="numeric"
              maxLength={2}
              autoComplete="cc-exp-month"
              required
              className={CAMPO_PUBLICO}
            />
          </Campo>
          <Campo etiqueta="Vencimiento (AA)" requerido>
            <input
              data-decidir="card_expiration_year"
              inputMode="numeric"
              maxLength={2}
              autoComplete="cc-exp-year"
              required
              className={CAMPO_PUBLICO}
            />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Código de seguridad" requerido>
            <input
              data-decidir="security_code"
              inputMode="numeric"
              maxLength={4}
              autoComplete="cc-csc"
              required
              className={CAMPO_PUBLICO}
            />
          </Campo>
          <Campo etiqueta="DNI del titular" requerido>
            <input data-decidir="card_holder_doc_number" inputMode="numeric" required className={CAMPO_PUBLICO} />
          </Campo>
        </div>
        {/* Payway exige un tipo de documento; DNI es el único caso que necesita este checkout. */}
        <input type="hidden" data-decidir="card_holder_doc_type" value="dni" />

        <button
          type="submit"
          disabled={!scriptListo || enviando}
          className={botonPublico('primario', 'w-full sm:w-auto')}
        >
          {enviando ? 'Procesando…' : 'Pagar'}
        </button>
        <a href={cancelar} className="text-center text-sm text-stone-500 underline">
          Cancelar y volver
        </a>
      </form>
    </>
  )
}
