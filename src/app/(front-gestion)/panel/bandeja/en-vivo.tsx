'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { marcarLeida } from './actions'

/**
 * Actualización en vivo de la bandeja.
 *
 * No mantiene una copia de los mensajes en el cliente (como el chat interno de
 * `conversaciones`): ante cualquier cambio pide al servidor que vuelva a
 * renderizar. Así la lista, el hilo y la ficha del contacto salen de UNA sola
 * fuente —la consulta del servidor— y no pueden contradecirse. Lo que se esté
 * escribiendo en la caja de respuesta no se pierde: `router.refresh()` conserva
 * el estado de los componentes de cliente.
 *
 * Realtime respeta RLS (migración 0125): quien no ve la bandeja no recibe nada.
 */
export function EnVivo() {
  const router = useRouter()
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = crearClienteNavegador()
    // Varios eventos juntos (un mensaje cambia también su conversación) se
    // agrupan en una sola recarga.
    const refrescar = () => {
      if (pendiente.current) return
      pendiente.current = setTimeout(() => {
        pendiente.current = null
        router.refresh()
      }, 400)
    }
    const canal = supabase
      .channel('bandeja-crm')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_mensajes' }, refrescar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversaciones' }, refrescar)
      .subscribe()

    return () => {
      if (pendiente.current) clearTimeout(pendiente.current)
      supabase.removeChannel(canal)
    }
  }, [router])

  return null
}

/** Al abrir una conversación con mensajes sin leer, los marca como leídos. */
export function MarcarLeida({ conversacionId, noLeidos }: { conversacionId: string; noLeidos: number }) {
  useEffect(() => {
    if (noLeidos > 0) void marcarLeida(conversacionId)
  }, [conversacionId, noLeidos])
  return null
}

/**
 * Lleva el hilo al último mensaje, como cualquier chat.
 *
 * Las imágenes y los videos cargan DESPUÉS del primer scroll y empujan el final
 * hacia abajo: con un solo `scrollIntoView` el hilo quedaba a mitad de una foto.
 * Por eso se vuelve a bajar cada vez que algo termina de cargar adentro del hilo
 * (el evento `load` no burbujea: se escucha en la fase de captura).
 *
 * Pero sólo si quien lee estaba al final: si subió a mirar un mensaje viejo, una
 * foto que termina de cargar no lo arrastra de vuelta.
 */
export function AlFinal({ marca }: { marca: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fin = ref.current
    const hilo = fin?.parentElement
    if (!fin || !hilo) return

    fin.scrollIntoView({ block: 'end' })

    const alFinal = () => hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 120
    let seguir = true
    const alScrollear = () => {
      seguir = alFinal()
    }
    const alCargar = () => {
      if (seguir) fin.scrollIntoView({ block: 'end' })
    }
    hilo.addEventListener('scroll', alScrollear, { passive: true })
    hilo.addEventListener('load', alCargar, true)
    return () => {
      hilo.removeEventListener('scroll', alScrollear)
      hilo.removeEventListener('load', alCargar, true)
    }
  }, [marca])

  return <div ref={ref} />
}
