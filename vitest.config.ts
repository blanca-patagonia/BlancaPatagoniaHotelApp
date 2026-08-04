import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'lib/**/*.test.ts'],
    // Los tests de integración comparten la misma Postgres local: se ejecutan en
    // serie para evitar contención entre archivos.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // Permite usar el alias "@/..." (igual que tsconfig) dentro de los tests.
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` lo provee Next y no existe fuera de su build. Los tests de
      // Server Actions importan módulos que lo declaran, así que se reemplaza
      // por un stub vacío (ver `tests/stubs/server-only.ts`).
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
})
