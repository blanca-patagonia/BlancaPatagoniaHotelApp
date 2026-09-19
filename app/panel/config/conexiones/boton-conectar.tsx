'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { botonClases, Mensaje } from '../../_components/ui'

/** Cuánto esperar como máximo una confirmación antes de darse por vencido. */
const TIEMPO_MAXIMO_MS = 90_000

/**
 * Botón de conexión OAuth2: abre una ventana emergente y espera el
 * `postMessage` que manda el callback al terminar.
 *
 * Una ventana emergente (`window.open`) y no una navegación de la pestaña
 * principal: así el usuario nunca pierde el lugar en el panel mientras
 * confirma en la pantalla real del proveedor, y al terminar la ventana se
 * cierra sola.
 *
 * ── Dos huecos reales que tenía esto ─────────────────────────────────────
 *
 * 1. **Sin límite de tiempo.** Si `urlAutorizacion` responde con un error del
 *    servidor (falta `ENCRYPTION_KEY`, por ejemplo) la ventana emergente
 *    queda abierta mostrando esa falla, así que `ventana.closed` nunca da
 *    `true` y el `postMessage` de éxito nunca llega — el botón quedaba
 *    "Esperando confirmación…" para siempre, sin ningún indicio de qué
 *    pasó, y la única salida era recargar la pantalla entera.
 * 2. **Sin manejar el bloqueo del navegador.** Si el bloqueador de
 *    emergentes frena `window.open`, `ventana` es `null` y ninguno de los
 *    dos caminos de salida (mensaje, `closed`) se dispara jamás.
 *
 * Los dos ahora terminan en un mensaje explícito en vez de un cuelgue mudo.
 */
export function BotonConectar({
  proveedor,
  urlAutorizacion,
  children,
}: {
  proveedor: string
  urlAutorizacion: string
  children: React.ReactNode
}) {
  const [conectando, setConectando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function conectar() {
    setError(null)
    setConectando(true)
    const ventana = window.open(
      urlAutorizacion,
      `conectar-${proveedor}`,
      'width=480,height=640,noopener=no,noreferrer=no',
    )

    if (!ventana) {
      setConectando(false)
      setError('El navegador bloqueó la ventana emergente. Habilitala para este sitio e intentá de nuevo.')
      return
    }

    function limpiar() {
      window.clearInterval(chequeo)
      window.clearTimeout(limite)
      window.removeEventListener('message', alRecibirMensaje)
    }

    function alRecibirMensaje(evento: MessageEvent) {
      if (evento.origin !== window.location.origin) return
      let datos: { provider?: string } | null = null
      try {
        datos = JSON.parse(evento.data)
      } catch {
        return
      }
      if (datos?.provider !== proveedor) return

      limpiar()
      setConectando(false)
      router.refresh()
    }

    window.addEventListener('message', alRecibirMensaje)

    // Si cierran la ventana a mano sin llegar a confirmar, no hay que quedar
    // esperando un mensaje que nunca va a llegar.
    const chequeo = window.setInterval(() => {
      if (ventana.closed) {
        limpiar()
        setConectando(false)
        router.refresh()
      }
    }, 500)

    // Red de seguridad: si la ventana quedó abierta mostrando un error del
    // servidor (nunca se cierra sola, nunca manda el mensaje de éxito), esto
    // es lo único que saca al botón de "Esperando confirmación…" para siempre.
    const limite = window.setTimeout(() => {
      limpiar()
      ventana.close()
      setConectando(false)
      setError(
        'No llegó ninguna confirmación en un minuto y medio. Puede que falte terminar de configurar esta conexión del lado del servidor — avisale a quien administra el sistema si se repite.',
      )
    }, TIEMPO_MAXIMO_MS)
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button onClick={conectar} disabled={conectando} className={botonClases('primario')}>
        {conectando ? 'Esperando confirmación…' : children}
      </button>
      {error && <Mensaje tono="error">{error}</Mensaje>}
    </div>
  )
}
