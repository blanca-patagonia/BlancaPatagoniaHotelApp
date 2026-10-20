import { defineConfig, devices } from '@playwright/test'

/**
 * Pruebas de punta a punta en un navegador real (`npm run e2e`).
 *
 * Necesitan la app corriendo (`npm run dev` o `npm run build && npm start`) y
 * una base con el usuario admin sembrado. Por omisión apuntan a
 * http://localhost:3000; con otra URL: `E2E_URL=https://… npm run e2e`.
 *
 * No levantan la app solas a propósito: en desarrollo ya está corriendo, y en el
 * CI el workflow `e2e.yml` la levanta con la base de tests.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 10 * 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:3000',
    ...devices['Desktop Chrome'],
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Rio_Gallegos',
  },
})
