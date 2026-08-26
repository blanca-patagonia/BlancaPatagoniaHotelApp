#!/usr/bin/env node
/**
 * PreToolUse · Write|Edit — protege los archivos que no se editan a mano.
 */
import { basename } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { leerEvento, bloquear, permitir } from './lib-hook.mjs'

const evento = await leerEvento()
const ruta = evento?.tool_input?.file_path ?? ''
if (!ruta) permitir()

const base = basename(ruta)
const raiz = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

// ── Entorno y secretos ──────────────────────────────────────────────────────
if (/^\.env(\.|$)/.test(base) && base !== '.env.example') {
  bloquear({
    que: 'los archivos de entorno no se editan desde el agente.',
    detalle: `Archivo: ${ruta}`,
    comoSeguir: 'Editalo vos a mano. La plantilla versionada es .env.example.',
  })
}

// ── Lockfiles ───────────────────────────────────────────────────────────────
if (['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(base)) {
  bloquear({
    que: 'los lockfiles los genera el gestor de paquetes.',
    detalle: `Archivo: ${ruta}`,
    comoSeguir: "Corré 'npm install <paquete>' y dejá que actualice el lock.",
  })
}

// ── Autogenerados ───────────────────────────────────────────────────────────
if (base === 'next-env.d.ts') {
  bloquear({
    que: 'lo genera Next.js en cada build.',
    detalle: `Archivo: ${ruta}`,
    comoSeguir: 'No hace falta tocarlo.',
  })
}

if (/(^|\/)\.next\//.test(ruta)) {
  bloquear({
    que: 'es la salida del build.',
    detalle: `Archivo: ${ruta}`,
    comoSeguir: 'Cambiá el código fuente y volvé a buildear.',
  })
}

// ── Migraciones ya aplicadas ────────────────────────────────────────────────
// Se distingue editar una que existe (se bloquea) de crear una nueva (se
// permite). Una migración aplicada es historia: se corrige con la siguiente.
if (/supabase\/migrations\/.+\.sql$/.test(ruta) && existsSync(ruta)) {
  let proxima = '00XX'
  try {
    const numeros = readdirSync(`${raiz}/supabase/migrations`)
      .map((n) => Number((n.match(/^(\d{4})/) ?? [])[1]))
      .filter(Number.isFinite)
    proxima = String((numeros.length ? Math.max(...numeros) : 0) + 1).padStart(4, '0')
  } catch {
    /* si no se puede leer el directorio, el mensaje sale con 00XX */
  }
  bloquear({
    que: 'esa migración ya está aplicada y no se reescribe.',
    detalle: `Archivo: ${ruta}`,
    comoSeguir: `Creá supabase/migrations/${proxima}_<descripcion>.sql con el cambio.`,
  })
}

// ── AGENTS.md: se avisa, no se bloquea ──────────────────────────────────────
// El archivo tiene contenido propio del equipo; el hook no puede saber qué
// parte se está tocando, así que informa en vez de estorbar.
if (base === 'AGENTS.md') {
  console.error(
    'Aviso: AGENTS.md contiene un bloque generado por Next.js entre los marcadores\n' +
      'BEGIN:nextjs-agent-rules y END:nextjs-agent-rules. Preservalo textualmente.',
  )
}

permitir()
