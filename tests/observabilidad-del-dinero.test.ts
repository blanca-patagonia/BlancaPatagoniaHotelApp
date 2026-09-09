import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/**
 * Test-contrato: nada del servidor se registra en un lugar que nadie mira.
 *
 * ── El hallazgo que cierra (auditoría 2026-09, P1-6) ────────────────────────
 *
 * Había **67 `console.error/warn` crudos** y sólo 5 archivos usaban
 * `registrarError`. Lo más caro era la verificación de firma de los dos webhooks
 * de pago: iba al stdout de Vercel, que nadie del hotel abre, así que el síntoma
 * de un secreto mal configurado —o de alguien probando firmas— era exactamente
 * ninguno. Los cobros dejaban de llegar y listo.
 *
 * Desde el ADR 0029 hay una tabla `errores` y una pantalla que la muestra
 * (`/panel/errores`). Lo que faltaba era **usarla**.
 *
 * ── Por qué un test que lee archivos ────────────────────────────────────────
 *
 * Porque el sink no escribe bajo Vitest a propósito (`sinkActivo()` corta si
 * `process.env.VITEST`), así que no se puede comprobar «apareció la fila»
 * ejecutando. Lo que sí se puede fijar es la regla. Es el mismo enfoque que
 * `tests/pwa.test.ts`, que lee `public/sw.js` y falla si se separa de la lista
 * blanca del dominio.
 *
 * ── Las excepciones son parte del contrato ──────────────────────────────────
 *
 * `EXCEPCIONES` no es una lista de perdones: cada entrada lleva **por qué** ese
 * archivo puede usar `console`, y el test verifica que el motivo esté escrito. Una
 * excepción sin justificar es una regla que se erosiona.
 */

/* ─────────────────────────────────────────────── el camino del dinero ──── */

/** Los archivos por los que pasa la plata. Acá la regla es absoluta. */
const CAMINO_DEL_DINERO = [
  'app/api/webhooks/pagos/[proveedor]/route.ts',
  'lib/payments/servicio.ts',
  'lib/payments/mercadopago.ts',
  'lib/payments/stripe.ts',
  'lib/payments/simulado.ts',
]

/* ───────────────────────────────────────────────── el resto del sistema ──── */

/**
 * Dónde `console` es la respuesta correcta, y por qué.
 *
 * Las cuatro razones, y ninguna es «no llegué a migrarlo»:
 *
 *  · **Circularidad** — el sink escribe en la misma base que el archivo vigila.
 *  · **Es cliente** — `lib/registro.ts` es `server-only`.
 *  · **Es la salida** — el proveedor de correo «consola» ES una consola.
 *  · **Volumen** — persistir cada caída transitoria de un servicio público
 *    ahogaría las señales que sí importan.
 */
const EXCEPCIONES: Record<string, string> = {
  'app/api/salud/route.ts':
    'El sink escribe en la MISMA base que este endpoint sondea: registrar acá sería escribir en lo que se acaba de comprobar que está caído.',
  'app/error.tsx':
    'Componente de cliente y lib/registro.ts es server-only. El servidor ya captura la excepción en instrumentation.ts con el mismo digest que se muestra en pantalla.',
  'app/global-error.tsx':
    'Componente de cliente y lib/registro.ts es server-only. Además corre cuando el layout raíz falló: no hay nada del servidor sobre lo que apoyarse.',
  'app/panel/error.tsx':
    'Componente de cliente y lib/registro.ts es server-only. El servidor ya captura la excepción en instrumentation.ts con el mismo digest que se muestra en pantalla.',
  'app/panel/_components/pwa.tsx': 'Componente de cliente: corre en el navegador, sin acceso a la base.',
  'lib/email/index.ts':
    'El proveedor «consola» ES la consola: escribir el correo ahí es literalmente lo que hace.',
  'lib/whatsapp/index.ts':
    'El proveedor «simulado» ES la consola: mismo motivo que el de email, escribir el WhatsApp ahí es lo que hace.',
  'lib/integraciones/seleccion.ts':
    'Advertencia de arranque: corre al elegir proveedor, antes de que haya nada cableado.',
  'lib/divisas/index.ts':
    'Caídas y 502 de un servicio público, frecuentes y transitorias. Una cotización vieja nunca bloquea una operación (ADR 0020), así que persistir cada una ahogaría las señales reales. La única que SÍ se registra es la respuesta inválida, que significa que la fuente cambió de formato.',
}

const RAIZ = process.cwd()
const CARPETAS = ['app', 'lib']
/** `lib/registro.ts` es quien escribe en la consola: es su trabajo. */
const EL_REGISTRO = join('lib', 'registro.ts')

function fuentes(dir: string): string[] {
  const salida: string[] = []
  for (const entrada of readdirSync(dir)) {
    const completo = join(dir, entrada)
    if (statSync(completo).isDirectory()) {
      salida.push(...fuentes(completo))
    } else if (/\.tsx?$/.test(entrada)) {
      salida.push(completo)
    }
  }
  return salida
}

function leer(rel: string): string {
  return readFileSync(resolve(RAIZ, rel), 'utf8')
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
    */
    const handler = leer('app/api/webhooks/pagos/[proveedor]/route.ts')

    expect(handler).toContain("{ error: 'firma inválida' }")
    expect(handler, 'la respuesta del webhook filtra el motivo del rechazo').not.toMatch(
      /Response\.json\(\{\s*error:\s*`[^`]*\$\{\s*(motivo|leido\.motivo)/,
    )
  })
})

describe('el resto del sistema tampoco loguea a la nada', () => {
  const archivos = CARPETAS.flatMap((c) => fuentes(resolve(RAIZ, c)))
    .map((f) => relative(RAIZ, f))
    .filter((f) => f !== EL_REGISTRO)

  it('sólo usan console los archivos declarados como excepción', () => {
    const infractores = archivos.filter((f) => {
      const rel = f.split(sep).join('/')
      if (EXCEPCIONES[rel]) return false
      return lineasConConsole(readFileSync(resolve(RAIZ, f), 'utf8')).length > 0
    })

    expect(
      infractores.map((f) => f.split(sep).join('/')),
      'Estos archivos loguean con `console`, que va a un lugar que nadie del hotel ' +
        'mira. Migralos a `registrarError`/`registrarAviso`, o —si console es de ' +
        'verdad lo correcto— sumalos a EXCEPCIONES con el motivo escrito',
    ).toEqual([])
  })

  it('cada excepción existe y tiene su motivo escrito', () => {
    /*
      Una excepción sin justificar es una regla que se erosiona, y una que apunta
      a un archivo que ya no existe es una que se olvidó de limpiar.
    */
    const declarados = archivos.map((f) => f.split(sep).join('/'))

    for (const [archivo, motivo] of Object.entries(EXCEPCIONES)) {
      expect(declarados, `la excepción «${archivo}» apunta a un archivo que ya no existe`).toContain(
        archivo,
      )
      expect(
        motivo.length,
        `la excepción de «${archivo}» no explica por qué console es lo correcto ahí`,
      ).toBeGreaterThan(40)
    }
  })

  it('ninguna excepción sobra: todas siguen usando console', () => {
    // Si un archivo dejó de usar `console`, sacarlo de la lista es lo que impide
    // que mañana alguien lo vuelva a agregar amparándose en una excepción vieja.
    for (const archivo of Object.keys(EXCEPCIONES)) {
      const usos = lineasConConsole(leer(archivo))
      expect(
        usos.length,
        `«${archivo}» ya no usa console: sacalo de EXCEPCIONES`,
      ).toBeGreaterThan(0)
    }
  })
})
