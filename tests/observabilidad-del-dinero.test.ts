import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Test-contrato: en el camino del dinero no queda nada en `console`.
 *
 * ── El hallazgo que cierra (auditoría 2026-09, P1-6) ────────────────────────
 *
 * La verificación de firma de los dos webhooks de pago reportaba con
 * `console.error`. Eso va al stdout de Vercel, que **nadie del hotel abre**, así
 * que el síntoma de un secreto mal configurado o de un atacante probando firmas
 * era exactamente ninguno: los cobros simplemente dejaban de llegar.
 *
 * Desde el ADR 0029 hay una tabla `errores` y una pantalla que la muestra
 * (`/panel/errores`). Lo que faltaba era **usarla** donde más importa.
 *
 * ── Por qué un test que lee archivos ────────────────────────────────────────
 *
 * Porque el sink no escribe bajo Vitest a propósito (`sinkActivo()` corta si
 * `process.env.VITEST`), así que no se puede comprobar «apareció la fila»
 * ejecutando. Lo que sí se puede fijar es la regla: en estos archivos no se
 * loguea con `console`. Es el mismo enfoque que `tests/pwa.test.ts`, que lee
 * `public/sw.js` y falla si se separa de la lista blanca del dominio.
 */

/** Los archivos por los que pasa la plata. */
const CAMINO_DEL_DINERO = [
  'app/api/webhooks/pagos/[proveedor]/route.ts',
  'lib/payments/servicio.ts',
  'lib/payments/mercadopago.ts',
  'lib/payments/stripe.ts',
  'lib/payments/simulado.ts',
]

function leer(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/** Descarta las apariciones dentro de comentarios, que son documentación. */
function lineasConConsole(contenido: string): string[] {
  return contenido
    .split('\n')
    .map((l, i) => ({ n: i + 1, texto: l }))
    .filter(({ texto }) => {
      const limpia = texto.trim()
      if (limpia.startsWith('*') || limpia.startsWith('//')) return false
      return /\bconsole\.(log|error|warn|info|debug)\s*\(/.test(limpia)
    })
    .map(({ n, texto }) => `${n}: ${texto.trim()}`)
}

describe('el camino del dinero se registra donde alguien lo ve', () => {
  for (const archivo of CAMINO_DEL_DINERO) {
    it(`${archivo} no loguea con console`, () => {
      const encontradas = lineasConConsole(leer(archivo))

      expect(
        encontradas,
        `Estas líneas van al stdout de Vercel, que nadie del hotel abre. ` +
          `Usá registrarError/registrarAviso de lib/registro.ts para que aparezcan ` +
          `en /panel/errores:\n${encontradas.join('\n')}`,
      ).toEqual([])
    })
  }

  it('los eventos que se registran tienen nombre estable', () => {
    /*
      Los nombres de evento son con lo que se busca en la pantalla de errores. Si
      cada archivo inventa el suyo, «¿nos están rechazando firmas?» deja de ser
      una búsqueda y pasa a ser una lectura de código.

      Se fijan los del webhook de pagos, que son los que alguien va a buscar
      cuando el hotel deje de enterarse de los cobros.
    */
    const esperados = [
      'webhook_pago_sin_secreto',
      'webhook_pago_sin_firma',
      'webhook_pago_firma_malformada',
      'webhook_pago_timestamp_vencido',
      'webhook_pago_firma_invalida',
      'webhook_pago_importe_distinto',
      'webhook_pago_sin_reserva',
      'webhook_pago_sin_cotizacion',
    ]

    const todo = CAMINO_DEL_DINERO.map(leer).join('\n')
    for (const evento of esperados) {
      expect(todo, `ya no se registra «${evento}»`).toContain(`'${evento}'`)
    }
  })

  it('la firma rechazada NO le dice al que llama por qué falló', () => {
    /*
      El motivo va al registro y nunca a la respuesta HTTP: explicarle a quien
      manda una firma inválida *por qué* no coincide es ayudarlo a construir una
      válida.

      Se comprueba sobre el handler: sus respuestas de error son genéricas.
    */
    const handler = leer('app/api/webhooks/pagos/[proveedor]/route.ts')

    expect(handler).toContain("{ error: 'firma inválida' }")
    expect(handler, 'la respuesta del webhook filtra el motivo del rechazo').not.toMatch(
      /Response\.json\(\{\s*error:\s*`[^`]*\$\{\s*(motivo|leido\.motivo)/,
    )
  })
})
