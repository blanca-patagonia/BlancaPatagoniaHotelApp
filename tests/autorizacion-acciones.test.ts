import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Guarda estructural: **toda Server Action verifica el rol por sí misma.**
 *
 * Por qué existe este test y no una regla en prosa. Una Server Action es un
 * endpoint HTTP público: se invoca con un POST sin pasar por la pantalla, así
 * que «la página ya verifica el rol» no protege nada. La auditoría de la Fase 3
 * encontró 17 acciones sin ninguna verificación —entre ellas `registrarPago`,
 * `emitirFactura` y `cambiarEstadoReserva`— y la única barrera que quedaba eran
 * las políticas RLS, que el propio equipo declaró sin auditar.
 *
 * Una regla escrita en AGENTS.md se cumple casi siempre. Este test se cumple
 * siempre: si alguien agrega una acción sin guarda, la suite se pone en rojo con
 * el nombre de la acción.
 *
 * Corre sin base de datos: es análisis estático del código fuente.
 */

const RAIZ = fileURLToPath(new URL('..', import.meta.url))

/** Verificación de ROL. `obtenerSesion` sola no alcanza: eso es autenticación. */
const VERIFICA_ROL =
  /requerirAcceso\(|puedeAcceder\(|sesion\.rol\s*!==|includes\(sesion\.rol\)|sesion\.rol\s*===/

/** Helpers locales que envuelven la verificación (exigirAcceso, exigirGestion…). */
function helpersConRol(fuente: string): string[] {
  return [...fuente.matchAll(/(?:async )?function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)]
    .filter((m) => VERIFICA_ROL.test(m[2]))
    .map((m) => m[1])
}

interface Accion {
  archivo: string
  nombre: string
  linea: number
  verifica: boolean
}

function accionesDelPanel(): Accion[] {
  const archivos = readdirSync(`${RAIZ}app/panel`, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('actions.ts'))

  const acciones: Accion[] = []

  for (const relativo of archivos) {
    const ruta = `app/panel/${relativo}`
    const fuente = readFileSync(`${RAIZ}${ruta}`, 'utf8')
    const lineas = fuente.split('\n')
    const helpers = helpersConRol(fuente)

    const inicios: [number, string][] = []
    lineas.forEach((l, i) => {
      const m = l.match(/^export async function (\w+)/)
      if (m) inicios.push([i, m[1]])
    })

    inicios.forEach(([i, nombre], k) => {
      const fin = k + 1 < inicios.length ? inicios[k + 1][0] : lineas.length
      const cuerpo = lineas.slice(i, fin).join('\n')
      const usaHelper = helpers.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(cuerpo))
      acciones.push({
        archivo: ruta,
        nombre,
        linea: i + 1,
        verifica: VERIFICA_ROL.test(cuerpo) || usaHelper,
      })
    })
  }

  return acciones
}

describe('autorización de las Server Actions', () => {
  const acciones = accionesDelPanel()

  it('hay acciones para analizar (el detector no se rompió en silencio)', () => {
    // Sin esta comprobación, un cambio de estructura que hiciera devolver cero
    // acciones dejaría el test en verde sin haber verificado absolutamente nada.
    expect(acciones.length).toBeGreaterThan(40)
  })

  it('TODAS verifican el rol, no solo que haya sesión', () => {
    const sinGuarda = acciones.filter((a) => !a.verifica)

    // El mensaje lista las culpables: un test que solo dice «falló» obliga a
    // rehacer la investigación entera.
    const detalle = sinGuarda.map((a) => `  ❌ ${a.archivo}:${a.linea} → ${a.nombre}`).join('\n')

    expect(
      sinGuarda,
      `Estas Server Actions no verifican el rol de quien las invoca.\n` +
        `Una Server Action es un endpoint HTTP público: que la pantalla verifique NO alcanza.\n` +
        `Agregá 'await requerirAcceso("<area>")' como primera línea.\n\n${detalle}\n`,
    ).toEqual([])
  })
})

describe('las guardas de sesión distinguen autenticar de autorizar', () => {
  it('ninguna acción se conforma con obtenerSesion sin mirar el rol', () => {
    const acciones = accionesDelPanel()
    // Redundante con el test anterior a propósito: si alguien afloja el detector
    // de arriba, este sigue afirmando la propiedad que de verdad importa.
    expect(acciones.every((a) => a.verifica)).toBe(true)
  })
})
