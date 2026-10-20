import { test, expect, type Page } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { AREAS_OCULTAS } from '../src/lib/domain/permisos'

/**
 * Recorre TODAS las pantallas del panel como admin y falla si alguna se rompe.
 *
 * Origen (2026-10-20): un recorrido a mano de las 74 pantallas encontró en una
 * pasada que la búsqueda de usuarios y de promociones nunca había funcionado,
 * que «Canales» y «Plantillas» fallaban por migraciones sin aplicar y que una
 * ficha inexistente mostraba la pantalla de error. Ningún test lo veía: los de
 * servidor no renderizan, y los de base no navegan.
 *
 * Las rutas salen de la carpeta del panel: una pantalla nueva entra sola.
 */

const PANEL = join(__dirname, '..', 'src', 'app', '(front-gestion)', 'panel')

function rutasDelPanel(): string[] {
  return (readdirSync(PANEL, { recursive: true }) as string[])
    .filter((f) => f.endsWith(`${sep}page.tsx`) || f === 'page.tsx')
    .map((f) => f.split(sep).slice(0, -1))
    .filter((partes) => !partes.some((p) => p.startsWith('[') || p.startsWith('_') || p.startsWith('(')))
    .map((partes) => '/panel' + (partes.length ? '/' + partes.join('/') : ''))
    .sort()
}

/** Una pantalla de un área apagada (AREAS_OCULTAS) redirige al inicio: es lo esperado. */
function estaApagada(ruta: string): boolean {
  const area = ruta.split('/')[2]?.replaceAll('-', '_')
  return Boolean(area && (AREAS_OCULTAS as readonly string[]).includes(area))
}

const SEÑALES_DE_FALLA = /Algo salió mal|Application error|Unhandled Runtime Error|No se pudo leer|No se pudieron leer/

async function entrar(page: Page) {
  await page.goto('/login')
  await page.fill('input[name="email"]', process.env.E2E_EMAIL ?? 'admin@blancapatagonia.local')
  await page.fill('input[name="password"]', process.env.E2E_PASSWORD ?? 'blancadev1234')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/panel/)
}

interface Falla {
  ruta: string
  motivo: string
}

async function revisar(page: Page, ruta: string, fallas: Falla[]) {
  const errores: string[] = []
  const alError = (e: Error) => errores.push(e.message)
  page.on('pageerror', alError)
  /*
    `networkidle` y no `load`: una pantalla de un área apagada redirige DESPUÉS
    de cargar (el `redirect` llega por el flujo de React), y si se navega a la
    siguiente en ese momento el navegador corta una de las dos (ERR_ABORTED).
  */
  const ir = () => page.goto(ruta, { waitUntil: 'networkidle' })
  const resp = await ir()
    .catch(() => ir())
    .catch((e: Error) => {
      fallas.push({ ruta, motivo: `no cargó: ${e.message.slice(0, 120)}` })
      return null
    })
  page.off('pageerror', alError)
  if (!resp) return
  if (resp.status() >= 400) fallas.push({ ruta, motivo: `HTTP ${resp.status()}` })

  const final = new URL(page.url()).pathname
  if (final !== ruta.split('?')[0] && !(estaApagada(ruta) && final === '/panel')) {
    fallas.push({ ruta, motivo: `redirigió a ${final}` })
  }
  const texto = await page.locator('main').innerText().catch(() => '')
  // La Ayuda explica qué hacer «cuando aparece la pantalla de algo salió mal».
  const señal = ruta === '/panel/ayuda' ? null : SEÑALES_DE_FALLA.exec(texto)
  if (señal) fallas.push({ ruta, motivo: `muestra «${señal[0]}»` })
  for (const e of errores) fallas.push({ ruta, motivo: `error de JavaScript: ${e.slice(0, 120)}` })
}

test('todas las pantallas del panel cargan sin errores (admin)', async ({ page }) => {
  await entrar(page)
  const rutas = rutasDelPanel()
  expect(rutas.length, 'no se encontraron pantallas: ¿cambió la carpeta del panel?').toBeGreaterThan(40)

  const fallas: Falla[] = []
  for (const ruta of rutas) await revisar(page, ruta, fallas)

  // Las fichas de detalle: se entra a la primera de cada listado, si hay datos.
  for (const listado of ['/panel/reservas', '/panel/huespedes', '/panel/agencias', '/panel/proveedores']) {
    await page.goto(listado)
    const enlace = page.locator(`main a[href^="${listado}/"]`).filter({ hasNotText: /Nuev|Exportar/ }).first()
    const href = await enlace.getAttribute('href').catch(() => null)
    if (href && /\/[0-9a-f-]{36}$/.test(href)) await revisar(page, href, fallas)
  }

  /*
    Un enlace a algo que no existe muestra «No encontramos eso», no la pantalla
    de error. Se mira el contenido y no el código HTTP: con `loading.tsx` la
    respuesta empieza a salir (200) antes de que la página decida el 404.
  */
  await page.goto('/panel/reservas/00000000-0000-4000-8000-000000000000', { waitUntil: 'networkidle' })
  const textoInexistente = await page.locator('body').innerText()
  if (!textoInexistente.includes('No encontramos eso')) {
    fallas.push({ ruta: '/panel/reservas/<inexistente>', motivo: 'no muestra la pantalla de «no encontrado»' })
  }

  expect(fallas, fallas.map((f) => `${f.ruta}: ${f.motivo}`).join('\n')).toEqual([])
})

test('el portal público cotiza sin sesión', async ({ page }) => {
  const desde = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const hasta = new Date(Date.now() + 32 * 86_400_000).toISOString().slice(0, 10)
  const resp = await page.goto(`/es/reservar?check_in=${desde}&check_out=${hasta}&huespedes=2`)
  expect(resp?.status()).toBe(200)
  await expect(page.locator('main')).toContainText('USD')
  await expect(page.locator('main')).not.toContainText(/Algo salió mal|No se pudo/)
})
