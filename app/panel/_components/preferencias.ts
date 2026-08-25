'use client'

import { useSyncExternalStore } from 'react'

/**
 * Preferencias de interfaz que viven en el navegador de quien usa el sistema:
 * qué grupos del menú quedaron plegados, qué secciones de Configuración.
 *
 * Por qué `useSyncExternalStore` y no `useState` + `useEffect`. `localStorage`
 * no existe en el servidor, así que sembrar el estado inicial con él rompe la
 * hidratación; y leerlo en un efecto para después llamar a `setState` es
 * justamente lo que `react-hooks/set-state-in-effect` marca como error, porque
 * provoca un render extra y un parpadeo. `useSyncExternalStore` está hecho para
 * esto: recibe una lectura para el cliente y otra para el servidor, y React se
 * encarga de que la primera pintura coincida.
 *
 * No va al servidor a propósito: no justifica una columna en `perfiles`, y cada
 * quien usa su propia máquina en el mostrador.
 */

const oyentes = new Set<() => void>()

function avisar() {
  for (const oyente of oyentes) oyente()
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente)
  // `storage` sólo dispara en las OTRAS pestañas. Sirve para que plegar algo en
  // una no deje a la de al lado mostrando lo contrario.
  if (oyentes.size === 1) window.addEventListener('storage', avisar)
  return () => {
    oyentes.delete(oyente)
    if (oyentes.size === 0) window.removeEventListener('storage', avisar)
  }
}

/**
 * Lee una preferencia booleana.
 *
 * El prefijo `use` rompe el castellano del resto del repo y es a propósito: no
 * es un nombre, es una marca que React y `react-hooks/rules-of-hooks` leen para
 * saber que esto es un hook y verificar dónde se lo llama. Sin ese prefijo el
 * lint no puede protegernos de llamarlo dentro de un `if` o de un `.map`.
 *
 * Devuelve un primitivo, no un objeto: `useSyncExternalStore` compara el
 * resultado de `getSnapshot` entre renders y un objeto nuevo cada vez lo haría
 * entrar en un bucle infinito.
 */
export function usePreferencia(clave: string, porDefecto: boolean): boolean {
  return useSyncExternalStore(
    suscribir,
    () => {
      try {
        const guardado = window.localStorage.getItem(clave)
        return guardado === null ? porDefecto : guardado === '1'
      } catch {
        // Modo privado o cuota llena: se cae al default en vez de romper.
        return porDefecto
      }
    },
    // En el servidor se usa siempre el default. Con `porDefecto = true` para
    // todo lo plegable, la primera pintura muestra TODO desplegado, que es el
    // lado seguro para equivocarse (`CLAUDE.md`: «nada oculto»).
    () => porDefecto,
  )
}

/** Guarda una preferencia y avisa a todos los componentes que la miran. */
export function guardarPreferencia(clave: string, valor: boolean): void {
  try {
    window.localStorage.setItem(clave, valor ? '1' : '0')
  } catch {
    // Que no se recuerde la preferencia es cosmético; perder el clic, no.
  }
  avisar()
}
