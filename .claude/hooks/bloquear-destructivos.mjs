#!/usr/bin/env node
/**
 * PreToolUse · Bash — frena los comandos que no tienen vuelta atrás.
 *
 * No es una jaula: quien quiera puede correr el comando en su terminal. Es una
 * red contra el descuido, que es como se pierde trabajo de verdad.
 */
import { leerEvento, bloquear, permitir } from './lib-hook.mjs'

const evento = await leerEvento()
const comando = evento?.tool_input?.command ?? ''
if (!comando) permitir()

const REGLAS = [
  {
    patron: /\brm\s+(?:-\w*\s+)*-\w*(?:rf|fr)\w*\b|\brm\s+-\w*r\w*\s+-\w*f|\brm\s+--recursive\s+--force/i,
    que: 'borrado recursivo forzado.',
    comoSeguir: 'Borrá con rutas explícitas, o hacelo vos en tu terminal si estás seguro.',
  },
  {
    patron: /git\s+push\s+[^\n]*(?:--force\b(?!-with-lease)|\s-f\b)/,
    que: "'git push --force' reescribe la historia remota.",
    comoSeguir: 'Usá --force-with-lease, y solo sobre tu propia rama.',
  },
  {
    patron: /git\s+reset\s+--hard/,
    que: "'git reset --hard' descarta cambios sin confirmación.",
    comoSeguir: "Guardá con 'git stash' primero si querés poder volver.",
  },
  {
    patron: /git\s+clean\s+[^\n]*-\w*f/,
    que: "'git clean -f' borra archivos sin seguimiento.",
    comoSeguir: "Revisá antes con 'git clean -n' qué se llevaría.",
  },
  {
    patron: /git\s+(?:checkout|switch)\s+(?:main|master)\s*$/m,
    que: 'el trabajo va en ramas, no directo sobre main.',
    comoSeguir: 'Creá una rama: git checkout -b audit/fase-N-<tema>',
  },
  {
    // Está documentado como trampa en CLAUDE.md: sin volver a sembrar, los
    // tests de facturación fallan por la FK contra `perfiles`.
    patron: /supabase\s+db\s+reset/,
    que: "'supabase db reset' BORRA los usuarios de auth.",
    comoSeguir: 'Si igual lo necesitás, corré después: npm run seed:usuarios',
  },
  {
    patron: /\bdrop\s+(?:database|schema|table)\b/i,
    que: 'hay un DROP en el comando.',
    comoSeguir: 'Los cambios de esquema van en una migración nueva, no a mano.',
  },
]

for (const regla of REGLAS) {
  if (regla.patron.test(comando)) {
    bloquear({ que: regla.que, detalle: `Comando: ${comando}`, comoSeguir: regla.comoSeguir })
  }
}

permitir()
