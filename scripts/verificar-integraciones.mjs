#!/usr/bin/env node
/**
 * `npm run integraciones` — qué servicios externos están configurados y si sus
 * claves andan (ADR 0043).
 *
 * Lee `.env.local` (lo carga `--env-file-if-exists` desde el script de npm) y,
 * para cada integración del catálogo, dice si está lista, a medias o sin
 * configurar. Las que tienen algo cargado se PRUEBAN con una consulta de sólo
 * lectura al proveedor: no cobra, no manda mensajes, no cambia nada.
 *
 * Importa el catálogo y las pruebas directo del código de la app, en
 * TypeScript: Node ≥ 22 los entiende sin compilar (`--experimental-strip-types`).
 * Así la terminal y la pantalla `/panel/config/integraciones` no pueden decir
 * cosas distintas.
 *
 * Opciones:
 *   --sin-probar   sólo mirar qué variables están cargadas, sin conectarse a nada.
 *
 * Sale con código 1 si alguna integración empezada está incompleta o su prueba
 * falla, para poder usarlo antes de un deploy.
 */
import {
  ETIQUETAS_ESTADO_INTEGRACION,
  ETIQUETAS_GRUPO,
  INTEGRACIONES,
  ORDEN_GRUPOS,
  diagnosticar,
  urlWebhook,
} from '../src/lib/domain/integraciones.ts'
import { probarIntegracion, tieneSonda } from '../src/lib/integraciones/sondas.ts'

const probar = !process.argv.includes('--sin-probar')
const env = process.env

/*
  `--plantilla`: imprime el bloque de variables para pegar en `.env.local` o en
  Vercel, armado desde el catálogo. Así la plantilla no se desactualiza cuando
  se suma una integración: sale de la misma lista que la pantalla.
*/
if (process.argv.includes('--plantilla')) {
  for (const grupo of ORDEN_GRUPOS) {
    const delGrupo = INTEGRACIONES.filter((i) => i.grupo === grupo)
    if (delGrupo.length === 0) continue
    process.stdout.write(`\n# ══ ${ETIQUETAS_GRUPO[grupo]} ══\n`)
    const escritas = new Set()
    for (const i of delGrupo) {
      process.stdout.write(`\n# ── ${i.nombre}: ${i.paraQue}\n`)
      if (i.limitacion) process.stdout.write(`# ⚠️ ${i.limitacion}\n`)
      if (i.webhook) process.stdout.write(`# Webhook: <NEXT_PUBLIC_SITE_URL>${i.webhook.ruta}\n`)
      if (i.interruptor && !escritas.has(i.interruptor.variable)) {
        escritas.add(i.interruptor.variable)
        process.stdout.write(`# ${i.interruptor.lista ? `lista separada por comas; incluir «${i.interruptor.valor}»` : `valor: ${i.interruptor.valor}`}\n`)
        process.stdout.write(`${i.interruptor.variable}=\n`)
      }
      for (const v of i.variables) {
        if (escritas.has(v.nombre)) continue
        escritas.add(v.nombre)
        process.stdout.write(`# ${v.obligatoria ? '' : '(opcional) '}${v.ayuda}${v.ejemplo ? ` Ej.: ${v.ejemplo}` : ''}\n`)
        process.stdout.write(`${v.nombre}=\n`)
      }
    }
  }
  process.exit(0)
}
const MARCA = { lista: '✓', incompleta: '✗', apagada: '◐', sin_configurar: '·' }

let problemas = 0

for (const grupo of ORDEN_GRUPOS) {
  const delGrupo = INTEGRACIONES.filter((i) => i.grupo === grupo)
  if (delGrupo.length === 0) continue
  process.stdout.write(`\n${ETIQUETAS_GRUPO[grupo]}\n${'─'.repeat(ETIQUETAS_GRUPO[grupo].length)}\n`)

  for (const i of delGrupo) {
    const d = diagnosticar(i, env)
    process.stdout.write(`  ${MARCA[d.estado]} ${i.nombre.padEnd(40)} ${ETIQUETAS_ESTADO_INTEGRACION[d.estado]}\n`)
    if (d.indicacion) process.stdout.write(`      ${d.indicacion}\n`)
    if (d.estado === 'incompleta') problemas += 1

    if (probar && d.estado !== 'sin_configurar' && i.probable && tieneSonda(i.id)) {
      const r = await probarIntegracion(i.id, env)
      process.stdout.write(`      ${r.ok ? 'prueba OK' : 'prueba FALLÓ'}: ${r.detalle}\n`)
      if (!r.ok) problemas += 1
    }
    if (i.webhook && d.estado !== 'sin_configurar') {
      process.stdout.write(`      webhook: ${urlWebhook(env.NEXT_PUBLIC_SITE_URL, i.webhook.ruta)}\n`)
    }
  }
}

process.stdout.write(
  problemas === 0
    ? '\nTodo lo configurado está completo y responde.\n'
    : `\n${problemas} problema(s). El detalle de cada integración está en /panel/config/integraciones.\n`,
)
process.exit(problemas === 0 ? 0 : 1)
