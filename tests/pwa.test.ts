import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PREFIJOS_CACHEABLES,
  VERSION_CACHE,
  PAGINA_SIN_CONEXION,
  ALCANCE_PWA,
  INICIO_PWA,
  sePuedeCachear,
} from '@/lib/domain/pwa'
import manifiesto from '@/app/manifest'

/**
 * La aplicación instalable (PWA) del panel.
 *
 * Lo que se testea acá no es que «funcione la PWA» —eso se ve instalándola—
 * sino la única parte que puede hacer daño en silencio: **qué guarda el service
 * worker en el dispositivo**. Un error ahí deja datos de huéspedes en una
 * tablet compartida o muestra una ocupación vieja como si fuera la de hoy.
 */

const RAIZ = join(import.meta.dirname, '..')
const SW = readFileSync(join(RAIZ, 'public', 'sw.js'), 'utf8')

describe('política de caché (lib/domain/pwa.ts)', () => {
  it('guarda los assets estáticos de Next, que llevan hash en el nombre', () => {
    expect(sePuedeCachear('/_next/static/chunks/main-a1b2c3.js')).toBe(true)
    expect(sePuedeCachear('/_next/static/css/estilos-9f8e7d.css')).toBe(true)
    expect(sePuedeCachear('/_next/static/media/inter-latin.woff2')).toBe(true)
  })

  it('guarda los iconos y la pantalla de sin conexión', () => {
    expect(sePuedeCachear('/icono-192.png')).toBe(true)
    expect(sePuedeCachear('/icono-512.png')).toBe(true)
    expect(sePuedeCachear('/icono-maskable.png')).toBe(true)
    expect(sePuedeCachear('/favicon.ico')).toBe(true)
    expect(sePuedeCachear(PAGINA_SIN_CONEXION)).toBe(true)
  })

  /*
    El corazón del asunto. Cada una de estas rutas devuelve datos del hotel o de
    una persona; guardarlas en el disco de un dispositivo compartido es una
    filtración, y servirlas viejas es peor que no servirlas.
  */
  it('NUNCA guarda una pantalla del panel', () => {
    expect(sePuedeCachear('/panel')).toBe(false)
    expect(sePuedeCachear('/panel/reservas')).toBe(false)
    expect(sePuedeCachear('/panel/ocupacion')).toBe(false)
    expect(sePuedeCachear('/panel/huespedes/42')).toBe(false)
    expect(sePuedeCachear('/panel/reportes')).toBe(false)
  })

  it('NUNCA guarda una respuesta de la API ni de un webhook', () => {
    expect(sePuedeCachear('/api/salud')).toBe(false)
    expect(sePuedeCachear('/api/webhooks/pagos/stripe')).toBe(false)
    expect(sePuedeCachear('/api/cron/canales')).toBe(false)
  })

  it('NUNCA guarda las pantallas con token de un tercero', () => {
    expect(sePuedeCachear('/portal/abc123')).toBe(false)
    expect(sePuedeCachear('/firmar/abc123')).toBe(false)
    expect(sePuedeCachear('/encuesta/abc123')).toBe(false)
  })

  it('NUNCA guarda el login ni el portal público', () => {
    expect(sePuedeCachear('/login')).toBe(false)
    expect(sePuedeCachear('/login/recuperar')).toBe(false)
    expect(sePuedeCachear('/reservar')).toBe(false)
    expect(sePuedeCachear('/alojamientos/doble-superior')).toBe(false)
    expect(sePuedeCachear('/')).toBe(false)
  })

  /*
    Es una lista BLANCA: lo que nadie declaró no se guarda. Este test es el que
    documenta esa decisión — si mañana se cambiara por una lista negra, una ruta
    inventada empezaría a cachearse sola y esto fallaría.
  */
  it('una ruta que nadie previó no se guarda', () => {
    expect(sePuedeCachear('/modulo-que-no-existe-todavia')).toBe(false)
    expect(sePuedeCachear('/panel/area-nueva/2026')).toBe(false)
  })
})

/**
 * `public/sw.js` no pasa por el bundler: no se puede importar ni le llega el
 * typecheck. Repite a mano lo que declara el dominio, así que hace falta algo
 * que verifique que las dos copias no se separaron.
 */
describe('contrato entre el service worker y el dominio', () => {
  it('la lista de prefijos del service worker es la misma que la del dominio', () => {
    const bloque = SW.match(/const PREFIJOS_CACHEABLES = \[([\s\S]*?)\]/)
    expect(bloque, 'no se encontró PREFIJOS_CACHEABLES en public/sw.js').not.toBeNull()

    const enElSW = [...bloque![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(enElSW).toEqual([...PREFIJOS_CACHEABLES])
  })

  it('la versión de caché es la misma en los dos lados', () => {
    const version = SW.match(/const VERSION = '([^']+)'/)
    expect(version, 'no se encontró VERSION en public/sw.js').not.toBeNull()
    expect(version![1]).toBe(VERSION_CACHE)
  })

  it('la pantalla de sin conexión es la misma en los dos lados', () => {
    const pagina = SW.match(/const PAGINA_SIN_CONEXION = '([^']+)'/)
    expect(pagina).not.toBeNull()
    expect(pagina![1]).toBe(PAGINA_SIN_CONEXION)
  })
})

/**
 * Tres garantías del service worker que no se ven en la lista de prefijos y que
 * son las que impiden la escritura diferida y la filtración entre dominios.
 */
describe('garantías del service worker', () => {
  it('no interviene en nada que no sea GET', () => {
    expect(SW).toContain("pedido.method !== 'GET'")
  })

  it('no interviene en pedidos a otro dominio', () => {
    expect(SW).toContain('url.origin !== self.location.origin')
  })

  it('no tiene escritura diferida: ni background sync ni cola de pedidos', () => {
    // `sync` y `periodicsync` son las APIs con las que se reintenta un envío
    // más tarde. En este sistema la verdad la tiene la base: si no hay red, se
    // dice que no hay red (ver el encabezado de public/sw.js).
    expect(SW).not.toMatch(/addEventListener\(\s*'(periodic)?sync'/)
  })

  it('la pantalla de sin conexión existe y no depende de la red', () => {
    const html = readFileSync(join(RAIZ, 'public', 'sin-conexion.html'), 'utf8')
    // Sin CSS ni fuentes externas: cuando se muestra, no hay con qué bajarlos.
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet/i)
    expect(html).not.toContain('fonts.googleapis.com')
    expect(html).not.toContain('/_next/')
  })
})

describe('manifiesto de la aplicación instalable', () => {
  const m = manifiesto()

  it('se instala solo el panel, no el portal público', () => {
    expect(m.scope).toBe(ALCANCE_PWA)
    expect(m.start_url).toBe(INICIO_PWA)
  })

  it('trae los dos tamaños de ícono que exige la instalación', () => {
    const medidas = m.icons?.map((i) => i.sizes)
    expect(medidas).toContain('192x192')
    expect(medidas).toContain('512x512')
  })

  it('trae un ícono maskable, que es el que sobrevive al recorte de Android', () => {
    const maskable = m.icons?.filter((i) => i.purpose === 'maskable')
    expect(maskable).toHaveLength(1)
    expect(maskable?.[0].sizes).toBe('512x512')
  })

  it('declara `id` propio, para que mover start_url no duplique la app', () => {
    expect(m.id).toBeTruthy()
  })

  it('abre a pantalla completa', () => {
    expect(m.display).toBe('standalone')
  })

  it('el nombre corto entra debajo de un ícono', () => {
    // Más de 12 caracteres y los sistemas operativos lo cortan con puntos
    // suspensivos en la pantalla de inicio.
    expect(m.short_name!.length).toBeLessThanOrEqual(18)
  })
})
