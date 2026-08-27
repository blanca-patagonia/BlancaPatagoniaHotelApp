/**
 * Política de la aplicación instalable (PWA) del panel.
 *
 * ── Por qué esto vive en el dominio ─────────────────────────────────────────
 *
 * Un service worker es un archivo suelto en `public/`: no pasa por el bundler,
 * no lo ve el typecheck y no se puede importar desde un test. Si la regla de
 * qué se guarda y qué no viviera solo ahí, sería la única decisión sensible del
 * sistema sin una red que la sostenga.
 *
 * Acá está la regla, pura y testeable. `public/sw.js` la repite —no le queda
 * otra— y `tests/pwa.test.ts` verifica que las dos listas coincidan. Si alguien
 * agrega un prefijo en el service worker y se olvida de acá, el test falla.
 *
 * ── Por qué es lista BLANCA y no lista negra ────────────────────────────────
 *
 * Una lista negra («no cachear /api, no cachear /panel») deja pasar todo lo que
 * nadie previó: una ruta nueva se cachea sola, y el error se descubre cuando un
 * dato viejo aparece en pantalla. Con lista blanca, lo que no está declarado
 * **no se guarda**, y agregar algo obliga a pensarlo.
 *
 * ── Qué NO se cachea nunca, y por qué importa en este sistema ───────────────
 *
 * · **Nada bajo `/panel`.** Una tablet de recepción es un dispositivo
 *   compartido. Guardar el HTML de una pantalla autenticada deja nombres de
 *   huéspedes, documentos y datos de pago en el disco, legibles después de
 *   cerrar sesión. Y una grilla de ocupación vieja muestra libre una unidad ya
 *   vendida: la base rechaza el overbooking igual (ADR 0002), pero quien la usa
 *   ve un fallo incomprensible en lugar de la realidad.
 * · **Nada de `/api`.** Mismo motivo, sin el HTML de por medio.
 * · **Ninguna respuesta a un POST.** El service worker no toca nada que no sea
 *   un `GET`: no existe la escritura diferida en este sistema. Si no hay red,
 *   se dice que no hay red.
 *
 * Lo único que se guarda son los assets estáticos de Next —que llevan hash en
 * el nombre, así que un contenido nuevo es una URL nueva y no hay forma de
 * servir una versión vieja— y la pantalla de «sin conexión».
 */

/**
 * Versión de la caché. **Cambiarla al tocar `public/sw.js`**: el activate borra
 * toda caché cuyo nombre no sea éste, que es el mecanismo por el que una
 * versión nueva se lleva puesta a la anterior en lugar de convivir con ella.
 */
export const VERSION_CACHE = 'blanca-patagonia-v1'

/**
 * Prefijos de ruta que el service worker puede guardar. Todo lo demás va a la
 * red y no se cachea. Ver el encabezado: es una lista blanca a propósito.
 *
 * `/_next/static/` cubre el JavaScript, el CSS y **las tipografías**: Next
 * descarga las de Google en el build y las sirve desde el propio dominio
 * (`next/font/google`), así que en tiempo de ejecución no hay pedidos a
 * `fonts.gstatic.com` que haya que contemplar.
 */
export const PREFIJOS_CACHEABLES = [
  '/_next/static/',
  '/icono-',
  '/apple-icon',
  '/favicon.ico',
  '/sin-conexion.html',
] as const

/** Pantalla que se muestra cuando no hay red. Estática, sin datos. */
export const PAGINA_SIN_CONEXION = '/sin-conexion.html'

/**
 * Alcance de la app instalable.
 *
 * Solo la gestión se instala: es la herramienta de uso diario del staff y la
 * que ya tiene vista móvil. El portal público queda como sitio web, que es lo
 * que un huésped espera —reserva una vez, no instala nada—.
 *
 * Declararlo acá tiene un efecto concreto: el navegador **no ofrece instalar**
 * desde una página fuera de este alcance, así que el cartel no aparece en
 * `/alojamientos` ni en `/reservar`.
 */
export const ALCANCE_PWA = '/panel'

/** Dónde abre la app cuando se toca su ícono. */
export const INICIO_PWA = '/panel'

/**
 * Colores de la app instalable, tomados de la paleta del ADR 0026.
 *
 * `tema` pinta la barra de estado del sistema operativo y `fondo` es lo que se
 * ve en el arranque, antes de que rinda la primera pantalla. Van juntos y del
 * mismo lado del contraste que la interfaz, o el arranque parpadea en blanco
 * antes de mostrar el azul.
 */
export const COLOR_TEMA = '#003580' // calafate-700
export const COLOR_FONDO = '#ffffff'

/**
 * ¿Se puede guardar esta ruta en la caché?
 *
 * Recibe el **pathname** (`/_next/static/chunk.js`), no la URL completa: quien
 * llama se encarga de separar el origen, porque el service worker además tiene
 * que descartar los pedidos a otros dominios y ése es un chequeo distinto.
 */
export function sePuedeCachear(pathname: string): boolean {
  return PREFIJOS_CACHEABLES.some((prefijo) => pathname.startsWith(prefijo))
}
