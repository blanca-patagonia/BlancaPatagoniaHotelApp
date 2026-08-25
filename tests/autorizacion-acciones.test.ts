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
/*
  `requerirRol(...)` se sumó a la lista cuando se eliminaron los 23 literales
  `['admin','gerencia'].includes(sesion.rol)`.

  Doce se migraron a `requerirAcceso(area)`, que es lo correcto cuando el literal
  coincide con la matriz de `lib/domain/permisos.ts`. Los otros once NO se podían
  migrar sin **cambiar** permisos: el área `agencias` incluye a recepción y el área
  `mantenimiento` incluye a housekeeping, así que usar la matriz les habría dado
  acceso de escritura que no tenían. Para ésos existe `requerirRol`, que declara
  que la restricción es más estrecha que el área **a propósito**.

  Esta guarda tiene que reconocer las dos formas, o marcaría como «sin verificar»
  a acciones que verifican mejor que antes.
*/
const VERIFICA_ROL =
  /requerirAcceso\(|requerirRol\(|puedeAcceder\(|sesion\.rol\s*!==|includes\(sesion\.rol\)|sesion\.rol\s*===/

/** Helpers locales que envuelven la verificación (exigirAcceso, exigirGestion…). */
function helpersConRol(fuente: string): string[] {
  return [...fuente.matchAll(/(?:async )?function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)]
    .filter((m) => VERIFICA_ROL.test(m[2]))
    .map((m) => m[1])
}

/**
 * Excepciones declaradas, con su motivo.
 *
 * Una acción entra acá **solo** si no hay ningún área que le corresponda porque
 * opera sobre la cuenta de quien la invoca, y por lo tanto la tiene que poder
 * usar cualquier rol. Exigirle `requerirAcceso(area)` obligaría a inventar un
 * área o a dejar afuera a housekeeping de cambiar su propia contraseña.
 *
 * No es una puerta para «esta todavía no la hice»: la lista se revisa en el test
 * de abajo, que verifica que cada entrada exista de verdad y que la acción
 * exenta al menos exija sesión. Si una exención queda huérfana porque se renombró
 * o se borró la acción, la suite avisa en vez de dejar el agujero abierto.
 */
const EXENTAS: Record<string, string> = {
  'app/panel/cuenta/actions.ts:cambiarMiPassword':
    'Opera sobre la cuenta de quien la invoca (updateUser trabaja sobre el usuario del token), ' +
    'así que no hay área que verificar y la necesitan los cuatro roles. Exige sesión y, además, ' +
    'la contraseña actual.',
  'app/panel/cuenta/actions.ts:guardarMisDatos':
    'Mismo caso: edita el nombre y el teléfono de quien la invoca, apuntando a `sesion.userId` y ' +
    'no a un identificador del formulario. La necesitan los cuatro roles, así que no hay área que ' +
    'verificar. Lo que impide el auto-ascenso NO es una guarda de rol acá sino la base: la ' +
    'migración 0066 acota el UPDATE de `perfiles` por columna a `nombre` y `telefono`, y hay un ' +
    'test que lo comprueba atacándola con el cliente publicable (`tests/mis-datos.test.ts`).',
}

interface Accion {
  archivo: string
  nombre: string
  linea: number
  verifica: boolean
  /** Cuerpo de la acción, para poder afirmar cosas sobre las exentas. */
  cuerpo: string
}

function accionesDelPanel(): Accion[] {
  const archivos = readdirSync(`${RAIZ}app/panel`, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('actions.ts'))

  const acciones: Accion[] = []

  for (const relativo of archivos) {
    // `readdirSync` devuelve separadores del sistema: en Windows sería
    // `cuenta\actions.ts` y en Linux `cuenta/actions.ts`. Se normaliza para que
    // las claves y los mensajes de error sean los mismos en la máquina de
    // cualquiera y en el runner del CI.
    const ruta = `app/panel/${relativo.split('\\').join('/')}`
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
        cuerpo,
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
    const sinGuarda = acciones.filter((a) => !a.verifica && !(`${a.archivo}:${a.nombre}` in EXENTAS))

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
    const sinExentas = acciones.filter((a) => !(`${a.archivo}:${a.nombre}` in EXENTAS))
    expect(sinExentas.every((a) => a.verifica)).toBe(true)
  })
})

describe('las excepciones declaradas', () => {
  const acciones = accionesDelPanel()

  it('se mantienen pocas: una lista larga es la regla desactivada', () => {
    expect(Object.keys(EXENTAS).length).toBeLessThanOrEqual(3)
  })

  it('todas apuntan a una acción que existe', () => {
    // Sin esto, renombrar o borrar una acción deja la exención huérfana, y la
    // próxima acción que se llame igual heredaría el permiso sin que nadie lo
    // decidiera.
    const existentes = new Set(acciones.map((a) => `${a.archivo}:${a.nombre}`))
    const huerfanas = Object.keys(EXENTAS).filter((k) => !existentes.has(k))
    expect(huerfanas, `Exenciones que ya no corresponden a ninguna acción:\n${huerfanas.join('\n')}`).toEqual([])
  })

  it('aunque no verifiquen rol, exigen sesión', () => {
    // Es el piso que no se negocia: sin área que comprobar, pero nunca abierta.
    for (const clave of Object.keys(EXENTAS)) {
      const accion = acciones.find((a) => `${a.archivo}:${a.nombre}` === clave)
      expect(accion?.cuerpo, `${clave} no exige sesión`).toMatch(/requerirSesion\(/)
    }
  })

  it('cada exención dice por qué', () => {
    for (const [clave, motivo] of Object.entries(EXENTAS)) {
      expect(motivo.length, `${clave} no explica el motivo`).toBeGreaterThan(40)
    }
  })
})
