/*
  Service worker del panel de Blanca Patagonia.

  ⚠️ LEER ANTES DE TOCAR ESTE ARCHIVO ⚠️

  Un service worker roto NO se arregla con un deploy: queda instalado en el
  dispositivo de cada persona y sigue interceptando pedidos con la versión vieja.
  Es el error clásico de las PWA y deja el sistema inutilizable en el teléfono de
  quien ya lo abrió. Por eso este archivo hace lo MÍNIMO posible.

  ── Qué hace, en una línea ──────────────────────────────────────────────────

  Guarda los assets estáticos de Next (que llevan hash en el nombre) y una
  pantalla de «sin conexión». Nada más. Ningún dato, nunca.

  ── Qué NO hace, y por qué ──────────────────────────────────────────────────

  · **No cachea nada bajo `/panel`.** Una tablet de recepción es compartida:
    guardar HTML autenticado dejaría nombres de huéspedes, documentos y datos de
    pago en el disco, legibles después de cerrar sesión. Y una grilla de
    ocupación vieja mostraría libre una unidad ya vendida.
  · **No cachea `/api`.** Mismo motivo.
  · **No toca nada que no sea GET.** No existe la escritura diferida en este
    sistema: la verdad la tiene la base. Si no hay red, se dice que no hay red.
  · **No hace background sync.** Encolar un check-in o un cobro para reproducirlo
    más tarde va en contra de todo el diseño del sistema.

  ── Cómo apagarlo si algo sale mal ──────────────────────────────────────────

  Reemplazar TODO el contenido de este archivo por estas cuatro líneas y
  desplegar. Los dispositivos que ya lo tengan instalado lo van a descargar
  —`Cache-Control: no-store` en `next.config.ts` lo garantiza—, se van a
  desregistrar solos y van a volver a funcionar como un sitio web normal:

      self.addEventListener('install', () => self.skipWaiting())
      self.addEventListener('activate', (e) => e.waitUntil(
        self.registration.unregister().then(() => caches.keys())
          .then((k) => Promise.all(k.map((n) => caches.delete(n))))
      ))

  ── Sincronía con el dominio ────────────────────────────────────────────────

  `VERSION` y `PREFIJOS_CACHEABLES` repiten lo que declara `lib/domain/pwa.ts`.
  No hay forma de importarlo: este archivo no pasa por el bundler. Lo sostiene
  `tests/pwa.test.ts`, que lee este archivo y falla si las dos listas dejan de
  coincidir. Al cambiar algo acá, cambiarlo allá.
*/

// Al tocar este archivo hay que subir la versión: el `activate` borra toda
// caché con otro nombre, y eso es lo que hace que la nueva reemplace a la vieja
// en lugar de convivir con ella.
const VERSION = 'blanca-patagonia-v1'

// Lista BLANCA. Lo que no está acá no se guarda. Ver `lib/domain/pwa.ts`.
const PREFIJOS_CACHEABLES = [
  '/_next/static/',
  '/icono-',
  '/apple-icon',
  '/favicon.ico',
  '/sin-conexion.html',
]

const PAGINA_SIN_CONEXION = '/sin-conexion.html'

function sePuedeCachear(pathname) {
  return PREFIJOS_CACHEABLES.some((prefijo) => pathname.startsWith(prefijo))
}

/*
  Instalación: se guarda la pantalla de «sin conexión» y nada más.

  `skipWaiting` hace que una versión nueva tome el control sin esperar a que se
  cierren las pestañas abiertas. Es seguro acá justamente porque no se cachea
  HTML: no puede pasar que una pestaña quede mezclando una página vieja con
  assets nuevos.
*/
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.add(PAGINA_SIN_CONEXION))
      .then(() => self.skipWaiting()),
  )
})

/*
  Activación: se borra toda caché de una versión anterior y se toma el control
  de las pestañas que ya estaban abiertas.
*/
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter((nombre) => nombre !== VERSION)
            .map((nombre) => caches.delete(nombre)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request

  // Solo lecturas. Un POST/PUT/DELETE va derecho a la red, sin intermediarios.
  if (pedido.method !== 'GET') return

  const url = new URL(pedido.url)

  // Solo el propio dominio. Lo de afuera no se intercepta ni se guarda.
  if (url.origin !== self.location.origin) return

  /*
    Navegaciones (abrir o recargar una pantalla del panel): SIEMPRE a la red.

    La respuesta no se guarda nunca —lleva datos del hotel— así que sin red no
    hay pantalla que mostrar: se sirve la de «sin conexión», que es estática y
    dice qué pasa. Es honesto y es lo único seguro.
  */
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      fetch(pedido).catch(() =>
        caches.match(PAGINA_SIN_CONEXION).then(
          (respuesta) =>
            respuesta ??
            new Response('Sin conexión.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            }),
        ),
      ),
    )
    return
  }

  // Fuera de la lista blanca no se interviene: el navegador hace su pedido
  // normal y nada queda guardado.
  if (!sePuedeCachear(url.pathname)) return

  /*
    Assets estáticos: primero la caché.

    Es correcto porque Next les pone un hash en el nombre: si el contenido
    cambia, la URL cambia, así que no hay manera de servir una versión vieja de
    algo que se actualizó.
  */
  evento.respondWith(
    caches.match(pedido).then((guardado) => {
      if (guardado) return guardado

      return fetch(pedido).then((respuesta) => {
        // Solo se guarda una respuesta completa y correcta. Un 404 o una
        // respuesta parcial en la caché es peor que no tener nada.
        if (!respuesta.ok || respuesta.status !== 200) return respuesta

        const copia = respuesta.clone()
        caches.open(VERSION).then((cache) => cache.put(pedido, copia))
        return respuesta
      })
    }),
  )
})
