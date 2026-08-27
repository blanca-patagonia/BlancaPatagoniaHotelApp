'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { ALCANCE_PWA } from '@/lib/domain/pwa'
import { Icono } from './iconos'

/**
 * Registro del service worker, aviso de «sin conexión» y cartel de instalación.
 *
 * ── Por qué `useSyncExternalStore` y no `useState` + `useEffect` ────────────
 *
 * Los cuatro datos que necesita esta pantalla —hay red, es iOS, ya está
 * instalada, el cartel fue descartado— viven **fuera de React**: los tiene el
 * navegador. Leerlos en un efecto y volcarlos con `setState` provoca un render
 * en cascada (la app pinta, el efecto corre, la app vuelve a pintar), que es lo
 * que marca la regla `react-hooks/set-state-in-effect`.
 *
 * `useSyncExternalStore` es la primitiva hecha para esto: describe cómo leer el
 * valor y cómo suscribirse a sus cambios, y React lo integra sin el rebote. Su
 * tercer argumento es el valor que se usa **en el servidor**, donde `navigator`
 * y `localStorage` no existen: sin él, el render del servidor rompe.
 */

/**
 * `beforeinstallprompt` no está en las definiciones estándar del DOM —es una
 * extensión de Chromium, no una norma— así que hay que declararlo. Se tipa en
 * vez de usar `any` porque `prompt()` y `userChoice` son justamente lo que se
 * llama más abajo.
 */
interface EventoInstalacion extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const CLAVE_DESCARTADO = 'bp:instalacion-descartada'

/* ── Conectividad ─────────────────────────────────────────────────────────── */

function suscribirConectividad(alCambiar: () => void): () => void {
  window.addEventListener('online', alCambiar)
  window.addEventListener('offline', alCambiar)
  return () => {
    window.removeEventListener('online', alCambiar)
    window.removeEventListener('offline', alCambiar)
  }
}

/* ── Valores que no cambian durante la visita ─────────────────────────────── */

/*
  Ni el sistema operativo ni el hecho de estar instalada cambian mientras la
  pestaña está abierta, así que la suscripción no tiene a qué escuchar. Devuelve
  una función de baja vacía, que es la forma de decir «esto no se mueve».
*/
const SIN_CAMBIOS = () => () => {}

/* ── Descarte del cartel, guardado en el navegador ────────────────────────── */

/*
  Un `Set` de oyentes, que es lo mínimo que pide `useSyncExternalStore` para
  enterarse de un cambio. `localStorage` avisa por el evento `storage` cuando lo
  toca OTRA pestaña, pero no cuando lo toca ésta; sin este aviso propio, el
  cartel no se iría hasta recargar.
*/
const oyentesDescarte = new Set<() => void>()

function suscribirDescarte(alCambiar: () => void): () => void {
  oyentesDescarte.add(alCambiar)
  return () => {
    oyentesDescarte.delete(alCambiar)
  }
}

function leerDescarte(): boolean {
  try {
    return localStorage.getItem(CLAVE_DESCARTADO) === '1'
  } catch {
    // Modo privado o almacenamiento bloqueado: se muestra el cartel igual.
    return false
  }
}

function guardarDescarte(): void {
  try {
    localStorage.setItem(CLAVE_DESCARTADO, '1')
  } catch {
    // Que no se pueda recordar la decisión no es motivo para fallar: el cartel
    // se oculta igual en esta visita.
  }
  oyentesDescarte.forEach((avisar) => avisar())
}

/* ── Componente ───────────────────────────────────────────────────────────── */

export function SoportePWA() {
  const sinConexion = useSyncExternalStore(
    suscribirConectividad,
    () => !navigator.onLine,
    () => false, // En el servidor se asume que hay conexión.
  )

  const yaInstalada = useSyncExternalStore(
    SIN_CAMBIOS,
    () => window.matchMedia('(display-mode: standalone)').matches,
    () => false,
  )

  const enIOS = useSyncExternalStore(
    SIN_CAMBIOS,
    () => /iPad|iPhone|iPod/.test(navigator.userAgent),
    () => false,
  )

  const descartado = useSyncExternalStore(suscribirDescarte, leerDescarte, () => true)

  // Éste sí es estado de React: nace de un evento del navegador y se consume al
  // usarlo. Como el `setState` ocurre dentro del callback de la suscripción y no
  // en el cuerpo del efecto, no provoca el render en cascada.
  const [instalacion, setInstalacion] = useState<EventoInstalacion | null>(null)

  /*
    Registro del service worker.

    ⚠️ Solo en producción. En desarrollo, Next recompila los chunks de
    `/_next/static` a cada cambio y no les fija un hash estable: una caché
    «primero lo guardado» devolvería JavaScript viejo, y la pantalla dejaría de
    reflejar el código que se está editando. Es el tipo de bug que hace perder
    una tarde buscando en el lugar equivocado.
  */
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js', { scope: `${ALCANCE_PWA}/` }).catch((error) => {
      // Que falle el registro no puede romper el panel: sin service worker el
      // sistema funciona igual, solo deja de ser instalable.
      console.error('[pwa] no se pudo registrar el service worker:', error)
    })
  }, [])

  useEffect(() => {
    const alPoderInstalar = (evento: Event) => {
      // Sin esto, Chrome muestra su propio cartel y el botón de acá queda
      // desconectado del navegador.
      evento.preventDefault()
      setInstalacion(evento as EventoInstalacion)
    }

    window.addEventListener('beforeinstallprompt', alPoderInstalar)
    return () => window.removeEventListener('beforeinstallprompt', alPoderInstalar)
  }, [])

  async function instalar() {
    if (!instalacion) return
    await instalacion.prompt()
    await instalacion.userChoice
    // El evento se consume: el navegador no lo vuelve a disparar en esta visita,
    // así que el cartel se va con él.
    setInstalacion(null)
  }

  /*
    En iOS no existe `beforeinstallprompt`: Safari no lo implementa y no hay
    forma de disparar la instalación por código. La única vía es explicarle a la
    persona qué tocar.
  */
  const mostrarInstalacion =
    !yaInstalada && !descartado && (instalacion !== null || enIOS)

  return (
    <>
      {sinConexion && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-lenga-300 bg-lenga-50 px-4 py-2.5 text-sm text-lenga-900"
        >
          <Icono nombre="alerta" tam={16} />
          <span>
            <strong>Sin conexión.</strong> El sistema necesita internet para mostrar y
            guardar datos. Lo que ya guardaste está a salvo.
          </span>
        </div>
      )}

      {mostrarInstalacion && (
        <div className="flex flex-col gap-3 rounded-lg border border-lago-200 bg-lago-50 px-4 py-3 text-sm text-stone-700 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Icono nombre="ayuda" tam={16} />
            <span>
              {enIOS ? (
                <>
                  <strong>Instalalo en el teléfono.</strong> Tocá el botón de compartir
                  de Safari y elegí «Agregar a inicio».
                </>
              ) : (
                <>
                  <strong>Instalalo en el teléfono.</strong> Se abre desde un ícono, a
                  pantalla completa, sin la barra del navegador.
                </>
              )}
            </span>
          </div>

          <div className="flex shrink-0 gap-2">
            {instalacion && (
              <button
                type="button"
                onClick={instalar}
                className="min-h-11 rounded-lg bg-lago-600 px-4 text-sm font-semibold text-white transition hover:bg-lago-700 sm:min-h-0 sm:py-2"
              >
                Instalar
              </button>
            )}
            <button
              type="button"
              onClick={guardarDescarte}
              className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm text-stone-600 transition hover:bg-white sm:min-h-0 sm:py-2"
            >
              Ahora no
            </button>
          </div>
        </div>
      )}
    </>
  )
}
