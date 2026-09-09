import { beforeAll, describe, expect, it } from 'vitest'
import { clienteAnonimo, clienteDePrueba, hayAnon, hayDB } from './db'

/**
 * EL BORDE PÚBLICO EN ESCRITURA, TABLA POR TABLA.
 *
 * ── El pendiente que cierra ─────────────────────────────────────────────────
 *
 * La auditoría RLS venía con dos mitades desparejas. La **lectura** está cubierta
 * de forma exhaustiva por `tests/rls-por-rol.test.ts`: todas las tablas × los
 * cuatro roles, con la lista sacada de la base para que una tabla nueva sin
 * declarar haga fallar el test. La **escritura** está en
 * `tests/rls-escritura-por-rol.test.ts`, que es dirigido por consecuencia y lo
 * dice de frente: no es una matriz completa.
 *
 * Este archivo cierra el eje más expuesto de esa mitad, y lo cierra **entero**:
 * `anon` no tiene permiso de escritura sobre ninguna tabla del esquema.
 *
 * ── Lo que encontró la primera vez que corrió ───────────────────────────────
 *
 * Que `anon` conservaba **UPDATE y DELETE sobre las seis tablas del catálogo**.
 * No venía de ninguna migración de este proyecto —la 0006 le da sólo `select`—
 * sino de los privilegios por omisión de la plataforma, y nadie lo había mirado:
 * la 0072 revocó `select` sobre lo que no es catálogo y ahí se detuvo.
 *
 * Exposición real: ninguna, porque las políticas RLS de esas tablas acotan la
 * escritura a `admin` y `gerencia`. Pero es la misma forma que tuvo el hallazgo
 * de `cotizar_estadia`: **la capa que la documentación daba por puesta no
 * estaba**. Lo cerró la migración 0089.
 *
 * ── Por qué se le pregunta al CATÁLOGO y no a PostgREST ─────────────────────
 *
 * ⚠️ Es la lección de este archivo, y la primera versión se equivocó.
 *
 * Sondear con un `insert` vacío y leer el código de error parece elegante —`42501`
 * es «denegado», cualquier otra cosa es «la barrera dejó pasar»— y tiene dos
 * falsos negativos que no se ven:
 *
 *  · una **vista** responde `55000` («no se puede insertar en una vista»);
 *  · una tabla con **trigger BEFORE INSERT** responde lo que lance el trigger.
 *
 * En los dos casos el error no es de permiso, y el test lo leía como si la
 * barrera hubiera actuado. Peor todavía: sobre las tablas sin `select`, PostgREST
 * ni siquiera expone la tabla al rol y responde «no existe» **antes** de llegar a
 * la base — así que el grant de escritura podía estar puesto y el sondeo lo daba
 * por cerrado.
 *
 * `privilegios_de_escritura()` (0089) pregunta `has_table_privilege`. No tiene
 * ambigüedad, cubre vistas, y no depende de que PostgREST muestre la tabla.
 */

describe.skipIf(!hayDB)('borde público · anon no tiene escritura sobre ninguna tabla', () => {
  let expuestas: { tabla: string; privilegio: string }[] = []
  let tablas: string[] = []

  beforeAll(async () => {
    const admin = clienteDePrueba()

    const { data, error } = await admin.rpc('privilegios_de_escritura', { p_rol: 'anon' })
    if (error) throw new Error(`No se pudo auditar los privilegios: ${error.message}`)
    expuestas = (data ?? []) as { tabla: string; privilegio: string }[]

    /*
      La lista de tablas se trae aparte para la guarda de más abajo. Sin ella, una
      función de auditoría que devolviera vacío por estar rota daría el mismo
      resultado que una base bien cerrada, y el test pasaría sin haber mirado
      nada. Es el defecto que tuvo la primera versión del test de lectura, que se
      comparaba contra sí misma.
    */
    const { data: t, error: eTablas } = await admin.rpc('tablas_publicas')
    if (eTablas) throw new Error(`No se pudo listar las tablas: ${eTablas.message}`)
    tablas = (t as { tabla: string }[] | string[]).map((x) =>
      typeof x === 'string' ? x : x.tabla,
    )
  }, 60_000)

  it('la base devolvió una cantidad de tablas plausible', () => {
    expect(tablas.length).toBeGreaterThan(40)
  })

  it('anon no conserva INSERT, UPDATE ni DELETE sobre nada', () => {
    /*
      Se reportan TODAS juntas y no una por `expect`: en una auditoría, saber que
      hay una tabla abierta sirve la mitad que saber que hay siete.
    */
    const detalle = expuestas.map((e) => `${e.tabla} (${e.privilegio})`)

    expect(
      detalle,
      'El rol público conserva escritura sobre estas tablas. `anon` es el único rol ' +
        'alcanzable desde internet SIN credenciales —la clave publicable viaja en el ' +
        'navegador porque el portal la necesita—, así que acá el grant es la última ' +
        'barrera antes de RLS. Se cierra con `revoke insert, update, delete on <tabla> ' +
        'from anon` en la migración que creó la tabla. Ver el encabezado de la 0089: ' +
        'los privilegios por omisión de la plataforma la vuelven a abrir si nadie mira',
    ).toEqual([])
  })

  it('el catálogo público SIGUE siendo legible', async () => {
    /*
      El contrapeso, y hace falta.

      La 0089 revoca en bloque, y un `revoke` de más rompe el portal público de la
      forma más silenciosa posible: la web deja de mostrar tipos y tarifas, no
      falla nada visible y el hotel se entera cuando alguien pregunta por qué no
      se puede reservar.

      Se comprueba leyendo de verdad, con el cliente anónimo, y no con
      `has_table_privilege`: lo que importa no es el grant sino que el dato llegue.
    */
    if (!hayAnon) return

    const anon = clienteAnonimo()
    for (const tabla of ['tipos_unidad', 'temporadas', 'promociones', 'politicas_cancelacion']) {
      const { error } = await anon.from(tabla).select('id').limit(1)
      expect(error, `anon dejó de poder leer ${tabla}: se rompió el portal público`).toBeNull()
    }

    // `tarifas` va aparte: desde la 0031 tiene `precio_neto` revocado por columna,
    // así que `select('*')` da 42501 para todos y hay que pedir una columna legible.
    const { error } = await anon.from('tarifas').select('precio_rack').limit(1)
    expect(error, 'anon dejó de poder leer las tarifas públicas').toBeNull()
  })

  it('el staff autenticado SIGUE pudiendo escribir', async () => {
    /*
      El otro contrapeso, y hace falta de verdad.

      La 0089 revoca en bloque. Un `revoke` mal dirigido —a `public`, por ejemplo,
      que es un grupo del que `anon` y `authenticated` son los dos miembros—
      dejaría al hotel sin poder cargar una reserva, y el síntoma sería un error
      de permisos en la cara de recepción.

      Se comprueba sobre las tablas que el mostrador toca todos los días: si
      alguna perdiera la escritura, el sistema deja de funcionar para trabajar.
    */
    const { data, error } = await clienteDePrueba().rpc('privilegios_de_escritura', {
      p_rol: 'authenticated',
    })
    expect(error, error?.message).toBeNull()

    const conEscritura = new Set(
      ((data ?? []) as { tabla: string; privilegio: string }[]).map((e) => e.tabla),
    )

    for (const tabla of ['reservas', 'estadias', 'huespedes', 'pagos', 'consumos']) {
      expect(
        conEscritura.has(tabla),
        `authenticated perdió la escritura sobre ${tabla}: el revoke de la 0089 se pasó de rol`,
      ).toBe(true)
    }
  })
})
