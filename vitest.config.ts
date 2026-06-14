import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Permite usar el alias "@/..." (igual que tsconfig) dentro de los tests.
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
