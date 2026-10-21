#!/usr/bin/env node
/**
 * `npm run configurar` — carga las claves de una integración, las prueba y las
 * guarda en `.env.local` (ADR 0044).
 *
 *   npm run configurar              → menú con todas las integraciones
 *   npm run configurar -- whatsapp  → directo a una (id del catálogo)
 *
 * Qué hace, en orden:
 *   1. Muestra qué ya está cargado y pregunta SÓLO lo que falta.
 *   2. Las claves que INVENTA el hotel (token de verificación de Meta, secreto
 *      de Telegram…) las genera solo: no hace falta abrir `openssl`.
 *   3. Lo que escribís no se ve en pantalla si es una clave.
 *   4. Prueba la conexión con el proveedor (consulta de sólo lectura) ANTES de
 *      guardar, y si falla pregunta si guardar igual: una clave mal pegada es el
 *      error más común y es mejor enterarse ahora.
 *   5. Guarda en `.env.local` (copia de seguridad en `.env.local.bak`), con
 *      permiso sólo para quien lo creó.
 *   6. Ofrece conectar el canal (registrar el webhook en Meta / Telegram /
 *      Resend) si el sistema ya tiene una dirección pública.
 *
 * ⚠️ Es para correr en TU terminal (`! npm run configurar` desde Claude Code, o
 * en una terminal normal): las claves se escriben acá y no pasan por ningún chat.
 *
 * Importa el catálogo y las pruebas directo del código de la app, en TypeScript
 * (Node ≥ 22 lo carga sin compilar). Así la terminal y la pantalla
 * `/panel/config/integraciones` dicen siempre lo mismo.
 *
 * `ENV_ARCHIVO=ruta` elige otro archivo (para probar sin tocar `.env.local`).
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import {
  ETIQUETAS_ESTADO_INTEGRACION,
  INTEGRACIONES,
  diagnosticar,
  urlPublicaValida,
  urlWebhook,
} from '../src/lib/domain/integraciones.ts'
import { probarIntegracion, tieneSonda, conectarTelegram } from '../src/lib/integraciones/sondas.ts'
import { conectarInstagram, conectarMessenger, conectarWhatsApp, crearWebhookDeCorreo } from '../src/lib/integraciones/meta.ts'

const ARCHIVO = process.env.ENV_ARCHIVO ?? join(process.cwd(), '.env.local')

/** Variables que inventa el hotel: se ofrecen generadas. Valor = bytes. */
const GENERABLES = {
  META_WEBHOOK_VERIFY_TOKEN: 16,
  TELEGRAM_WEBHOOK_SECRET: 24,
  CRON_SECRET: 32,
  PAYWAY_INTERNAL_SECRET: 32,
}

/** Variables que NO son claves: se muestran al escribir. */
const esSecreta = (nombre, def) => def?.secreta ?? true

// ── Archivo .env ─────────────────────────────────────────────────────────────

function leerEnv() {
  if (!existsSync(ARCHIVO)) return new Map()
  const m = new Map()
  for (const linea of readFileSync(ARCHIVO, 'utf8').split('\n')) {
    const r = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea)
    if (!r) continue
    let v = r[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    m.set(r[1], v)
  }
  return m
}

function formatear(valor) {
  return /[\s#"'$`\\]/.test(valor) ? `"${valor.replace(/(["\\$`])/g, '\\$1')}"` : valor
}

/** Escribe las variables sin tocar el resto del archivo: reemplaza las que existen, agrega las nuevas. */
function guardarEnv(cambios) {
  const hay = existsSync(ARCHIVO)
  if (hay) {
    copyFileSync(ARCHIVO, `${ARCHIVO}.bak`)
    // La copia tiene las claves de antes: mismo permiso que el original, no el de la umask.
    try {
      chmodSync(`${ARCHIVO}.bak`, 0o600)
    } catch {
      // En Windows no aplica.
    }
  }
  const lineas = hay ? readFileSync(ARCHIVO, 'utf8').split('\n') : []
  const pendientes = new Map(Object.entries(cambios))
  const salida = lineas.map((l) => {
    const r = /^\s*([A-Z0-9_]+)\s*=/.exec(l)
    if (r && pendientes.has(r[1])) {
      const v = pendientes.get(r[1])
      pendientes.delete(r[1])
      return `${r[1]}=${formatear(v)}`
    }
    return l
  })
  while (salida.length && salida[salida.length - 1] === '') salida.pop()
  if (pendientes.size) {
    if (salida.length) salida.push('')
    salida.push(`# Agregadas por «npm run configurar» el ${new Date().toISOString().slice(0, 10)}`)
    for (const [k, v] of pendientes) salida.push(`${k}=${formatear(v)}`)
  }
  writeFileSync(ARCHIVO, `${salida.join('\n')}\n`, { mode: 0o600 })
  try {
    chmodSync(ARCHIVO, 0o600)
  } catch {
    // En Windows no aplica.
  }
}

// ── Preguntas ────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) })
let silencio = false
const escribirOriginal = rl._writeToOutput?.bind(rl)
if (escribirOriginal) {
  // Mientras se escribe una clave no se muestra lo que se tipea (sí el salto de línea).
  rl._writeToOutput = (s) => {
    if (!silencio || s === '\r\n' || s === '\n') escribirOriginal(s)
  }
}

// Con la entrada redirigida (pruebas) las líneas llegan todas juntas: se encolan.
const cola = []
const esperando = []
rl.on('line', (l) => (esperando.length ? esperando.shift()(l) : cola.push(l)))
rl.on('close', () => {
  while (esperando.length) esperando.shift()('')
})

function leer(texto, { oculto = false } = {}) {
  process.stdout.write(texto)
  silencio = oculto && Boolean(process.stdin.isTTY)
  return new Promise((resolve) => {
    const entregar = (l) => {
      silencio = false
      resolve(l.trim())
    }
    if (cola.length) entregar(cola.shift())
    else esperando.push(entregar)
  })
}

async function confirmar(texto, porDefecto = true) {
  const r = (await leer(`${texto} ${porDefecto ? '[S/n]' : '[s/N]'} `)).toLowerCase()
  if (!r) return porDefecto
  return r.startsWith('s') || r === 'y'
}

// ── Una integración ──────────────────────────────────────────────────────────

async function configurar(i, entorno) {
  const nuevas = {}
  const actual = (n) => nuevas[n] ?? entorno.get(n) ?? ''

  console.log(`\n━━ ${i.nombre} ━━`)
  console.log(i.paraQue)
  if (i.limitacion) console.log(`⚠️  ${i.limitacion}`)
  console.log('\nCómo se consigue:')
  i.pasos.forEach((p, n) => console.log(`  ${n + 1}. ${p}`))
  console.log('')

  for (const v of i.variables) {
    if (actual(v.nombre)) {
      console.log(`✓ ${v.nombre} ya está cargada.`)
      continue
    }
    console.log(`\n${v.nombre}${v.obligatoria ? '' : ' (opcional, Enter para saltear)'}`)
    console.log(`  ${v.ayuda}`)
    if (GENERABLES[v.nombre]) {
      if (await confirmar('  La invento yo por vos.', true)) {
        nuevas[v.nombre] = randomBytes(GENERABLES[v.nombre]).toString('hex')
        console.log('  ✓ Generada.')
        continue
      }
    }
    const valor = await leer('  Valor: ', { oculto: esSecreta(v.nombre, v) })
    if (valor) nuevas[v.nombre] = valor
    else if (v.obligatoria) console.log('  (queda sin cargar)')
  }

  // El interruptor que la enciende (PAGO_PROVIDER, EMAIL_PROVIDER…).
  if (i.interruptor) {
    const actualInt = actual(i.interruptor.variable)
    const incluye = i.interruptor.lista ? actualInt.split(',').map((x) => x.trim()).includes(i.interruptor.valor) : actualInt === i.interruptor.valor
    if (!incluye) {
      const nuevo = i.interruptor.lista ? [...actualInt.split(',').map((x) => x.trim()).filter(Boolean), i.interruptor.valor].join(',') : i.interruptor.valor
      if (await confirmar(`\nPoner ${i.interruptor.variable}=${nuevo} para encenderla`, true)) nuevas[i.interruptor.variable] = nuevo
    }
  }

  const merged = { ...Object.fromEntries(entorno), ...nuevas }

  // Probar ANTES de guardar.
  let guardar = Object.keys(nuevas).length > 0
  if (guardar && i.probable && tieneSonda(i.id)) {
    console.log('\nProbando la conexión…')
    const r = await probarIntegracion(i.id, merged)
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.detalle}`)
    if (!r.ok) guardar = await confirmar('  Guardar igual', false)
  }

  if (guardar) {
    guardarEnv(nuevas)
    for (const [k, v] of Object.entries(nuevas)) entorno.set(k, v)
    console.log(`\n✓ Guardado en ${ARCHIVO} (${Object.keys(nuevas).length} variable/s). Copia anterior: ${ARCHIVO}.bak`)
  } else if (Object.keys(nuevas).length === 0) {
    console.log('\nNo había nada nuevo para guardar.')
  }

  await conectar(i, merged, entorno)
}

/** Registra el webhook del lado del proveedor, si se puede. */
async function conectar(i, merged, entorno) {
  const conectable = ['whatsapp', 'instagram', 'messenger', 'telegram', 'resend'].includes(i.id)
  if (!conectable) return
  const d = diagnosticar(i, merged)
  if (d.estado === 'sin_configurar' || d.estado === 'incompleta') return

  const sitio = merged.NEXT_PUBLIC_SITE_URL
  const pub = urlPublicaValida(sitio)
  if (!pub.valida) {
    console.log(`\nPara conectar el canal falta una dirección pública: ${pub.motivo}`)
    console.log('Cuando la tengas, volvé a correr este comando o apretá «Conectar» en la bandeja.')
    return
  }
  if (!(await confirmar('\n¿Le aviso ahora al proveedor a dónde mandar los mensajes (conectar el canal)?', true))) return

  if (i.id === 'resend') {
    const r = await crearWebhookDeCorreo(merged, urlWebhook(sitio, '/api/webhooks/email/resend'))
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.detalle}`)
    if (r.ok && r.secreto) {
      guardarEnv({ RESEND_WEBHOOK_SECRET: r.secreto })
      entorno.set('RESEND_WEBHOOK_SECRET', r.secreto)
      console.log('  ✓ El secreto del webhook se guardó en .env.local (reiniciá el sistema para que lo lea).')
    }
    return
  }
  if (i.id === 'telegram') {
    const r = await conectarTelegram(merged, urlWebhook(sitio, '/api/webhooks/telegram'))
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.detalle}`)
    return
  }
  const url = urlWebhook(sitio, '/api/webhooks/meta')
  const r = await { whatsapp: conectarWhatsApp, instagram: conectarInstagram, messenger: conectarMessenger }[i.id](merged, url)
  for (const p of r.pasos) console.log(`  ${p.ok === true ? '✓' : p.ok === false ? '✗' : '·'} ${p.titulo}. ${p.detalle}`)
}

// ── Menú ─────────────────────────────────────────────────────────────────────

async function main() {
  const entorno = leerEnv()
  const pedido = process.argv[2]
  let elegidas

  if (pedido) {
    const i = INTEGRACIONES.find((x) => x.id === pedido)
    if (!i) {
      console.log(`No existe «${pedido}». Opciones: ${INTEGRACIONES.map((x) => x.id).join(', ')}`)
      process.exit(1)
    }
    elegidas = [i]
  } else {
    console.log('Integraciones — elegí cuál configurar (o varias separadas por coma):\n')
    INTEGRACIONES.forEach((i, n) => {
      const d = diagnosticar(i, Object.fromEntries(entorno))
      console.log(`  ${String(n + 1).padStart(2)}. ${i.nombre.padEnd(40)} ${ETIQUETAS_ESTADO_INTEGRACION[d.estado]}`)
    })
    console.log('   0. Salir')
    const r = await leer('\nNúmero: ')
    elegidas = r
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => n >= 1 && n <= INTEGRACIONES.length)
      .map((n) => INTEGRACIONES[n - 1])
  }

  for (const i of elegidas) await configurar(i, entorno)
  console.log('\nListo. Para ver cómo quedó todo: npm run integraciones')
  rl.close()
}

main().catch((e) => {
  console.error(`\nError: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
