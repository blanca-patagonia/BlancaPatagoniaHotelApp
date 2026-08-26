#!/usr/bin/env node
/**
 * PreToolUse · Write|Edit — impide escribir secretos en el código.
 *
 * Se bloquea ANTES de escribir y no se corrige después: un secreto commiteado
 * queda en el historial de git para siempre, y limpiarlo exige reescribir la
 * historia de todo el equipo.
 */
import { basename } from 'node:path'
import { leerEvento, bloquear, permitir } from './lib-hook.mjs'

const evento = await leerEvento()
const entrada = evento?.tool_input ?? {}
const ruta = entrada.file_path ?? ''

// Estos archivos llevan placeholders legítimos por diseño.
const EXENTOS = ['.env.example']
if (EXENTOS.includes(basename(ruta)) || ruta.endsWith('.md')) permitir()

// Write trae `content`; Edit trae `new_string`. Se revisan los dos.
const contenido = [entrada.content, entrada.new_string].filter(Boolean).join('\n')
if (!contenido) permitir()

const PATRONES = [
  { patron: /sb_secret_[A-Za-z0-9_-]{8,}/, nombre: 'clave secreta de Supabase' },
  { patron: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, nombre: 'JWT' },
  { patron: /\bsk-[A-Za-z0-9]{20,}/, nombre: 'clave de API tipo sk-' },
  { patron: /APP_USR-[A-Za-z0-9-]{20,}/, nombre: 'token de MercadoPago' },
  { patron: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/, nombre: 'clave de Stripe' },
  { patron: /\bwhsec_[A-Za-z0-9]{16,}/, nombre: 'secreto de webhook' },
  { patron: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, nombre: 'clave privada' },
  {
    // Asignación literal con valor de largo plausible. Se exige que el valor no
    // parezca un placeholder para no bloquear ejemplos y plantillas.
    patron: /(?:password|contrasenia|contraseña|secret|token|api[_-]?key)\s*[:=]\s*['"`](?!tu-|your-|<|\.\.\.|xxx|placeholder|ejemplo|example)[^'"`\s]{12,}['"`]/i,
    nombre: 'contraseña o token literal',
  },
]

for (const { patron, nombre } of PATRONES) {
  if (patron.test(contenido)) {
    bloquear({
      que: `parece haber un secreto en el contenido a escribir (${nombre}).`,
      detalle: `Archivo: ${ruta || 'desconocido'}\nUn secreto commiteado queda en el historial de git para siempre.`,
      comoSeguir: 'Movelo a .env.local y leelo con process.env (ver lib/env.ts).',
    })
  }
}

permitir()
