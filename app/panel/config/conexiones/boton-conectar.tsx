'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { botonClases } from '../../_components/ui'

/**
 * Botón de conexión OAuth2: abre una ventana emergente y espera el
 * `postMessage` que manda el callback al terminar.
 *
 * Una ventana emergente (`window.open`) y no una navegación de la pestaña
 * principal: así el usuario nunca pierde el lugar en el panel mientras
 * confirma en la pantalla real del proveedor, y al terminar la ventana se
 * cierra sola.
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
  const router = useRouter()

  function conectar() {
    setConectando(true)
    const ventana = window.open(
      urlAutorizacion,
      `conectar-${proveedor}`,
      'width=480,height=640,noopener=no,noreferrer=no',
    )

    function alRecibirMensaje(evento: MessageEvent) {
      if (evento.origin !== window.location.origin) return
      let datos: { provider?: string } | null = null
      try {
        datos = JSON.parse(evento.data)
      } catch {
        return
      }
      if (datos?.provider !== proveedor) return

      window.removeEventListener('message', alRecibirMensaje)
      setConectando(false)
      router.refresh()
    }

    window.addEventListener('message', alRecibirMensaje)

    // Si cierran la ventana a mano sin llegar a confirmar, no hay que quedar
    // esperando un mensaje que nunca va a llegar.
    const chequeo = window.setInterval(() => {
      if (ventana?.closed) {
        window.clearInterval(chequeo)
        window.removeEventListener('message', alRecibirMensaje)
        setConectando(false)
        router.refresh()
      }
    }, 500)
  }

  return (
    <button onClick={conectar} disabled={conectando} className={botonClases('primario')}>
      {conectando ? 'Esperando confirmación…' : children}
    </button>
  )
}
