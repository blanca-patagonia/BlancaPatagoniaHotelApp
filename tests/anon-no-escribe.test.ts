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
 * `tests/rls-escritura-por-rol.test.ts`, que es dirigido por consecuencia
 * —escalada de privilegio, dinero, inventario— y lo dice de frente: no es una
 * matriz completa.
 *
 * Este archivo cierra el eje más expuesto de esa mitad, y lo cierra **entero**:
 * `anon` no escribe en ninguna tabla, ninguna operación.
 *
 * ── Por qué `anon` y por qué exhaustivo ─────────────────────────────────────
 *
 * Porque es el único rol alcanzable **desde internet sin credenciales**. La clave
 * publicable viaja en el navegador —tiene que hacerlo, el portal público la usa—
 * así que cualquiera puede mandar un `POST /rest/v1/<tabla>` a mano, sin pasar por
 * ninguna pantalla ni por ninguna Server Action. Para los otros tres roles hace
 * falta una cuenta del hotel; para éste no hace falta nada.
 *
 * Y exhaustivo porque el modo de falla es una **tabla nueva**: la migración que la
 * crea se acuerda de `enable row level security` —está en la convención del
 * proyecto— pero puede olvidarse del `revoke ... from anon`, y entonces `anon`
 * hereda el grant que la plataforma le da al rol. No hay ningún síntoma: la tabla
 * anda bien para todos.
 *
 * ── Cómo se distingue «denegado» de «datos inválidos» ───────────────────────
 *
 * ⚠️ Es la parte delicada, y es lo que permite escribir este test sin armar una
 * fila válida para cada tabla del esquema.
 *
 * Se manda un `insert` de una fila **vacía**. Hay dos desenlaces y significan
 * cosas opuestas:
 *
 *  · `42501` — permiso denegado, o «new row violates row-level security policy».
 *    Es lo que se busca: la barrera actuó **antes** de mirar el contenido.
 *  · Cualquier otra cosa —`23502` not-null, `23503` clave foránea, o incluso
 *    éxito— significa que la barrera **dejó pasar** y lo que falló fue la
 *    validación de datos. Eso es un agujero aunque la fila no haya entrado: con
 *    una fila bien armada entraría.
 *
 * Por eso se afirma el **código** y no «hubo error». Afirmar que hubo error daría
 * verde con `23502`, que es justamente el caso peligroso.
 *
 * ── Este archivo no escribe nada ────────────────────────────────────────────
 *
 * El `insert` va vacío (no puede entrar en ninguna tabla con columnas
 * obligatorias) y el `update`/`delete` filtran por `id is null`, que sobre una
 * clave primaria no alcanza **ninguna** fila. Una auditoría que corre contra una
 * base con datos no puede permitirse tocarlos para demostrar que podía.
 *
 * `is null` además sirve para cualquier tipo de columna, que es el motivo por el
 * que se usa eso y no un valor: en este esquema hay `id uuid`, `id bigint` y hasta
 * un `id boolean` (`datos_fiscales`), y un uuid literal daría `22P02` en la mitad
 * de las tablas — un error de tipo que se leería como si la barrera hubiera
 * actuado.
 */

/** Códigos que significan «la barrera actuó». */
const DENEGADO = new Set([
  // Falta el privilegio de tabla, o la política rechazó la fila nueva.
  '42501',
  /*
    PostgREST no encuentra la tabla en su caché de esquema para este rol. Sin
    ningún privilegio, la tabla directamente **no existe** para `anon`: es la misma
    denegación vista una capa más arriba. Los dos códigos aparecen según la versión.
  */
  'PGRST205',
  'PGRST106',
])

/**
 * Columna por la que filtrar el `update` y el `delete`.
 *
 * Casi todas las tablas tienen `id`. Las dos excepciones no son un descuido:
 * `puntos_venta` se identifica por su número fiscal y `canal_config` tiene una
 * fila por canal. Se declaran acá para que el sondeo no falle con «la columna no
 * existe» y ese error se lea como una denegación que no ocurrió.
 */
const CLAVE_POR_TABLA: Record<string, string> = {
  puntos_venta: 'numero',
  canal_config: 'canal',
}

function claveDe(tabla: string): string {
  return CLAVE_POR_TABLA[tabla] ?? 'id'
}

describe.skipIf(!hayDB || !hayAnon)('borde público · anon no escribe en ninguna tabla', () => {
  let tablas: string[] = []

  beforeAll(async () => {
    /*
      Las tablas se descubren de la base y no de una lista escrita a mano: es el
      punto entero del archivo. Con una lista, la tabla nueva —que es el caso que
      esto vigila— quedaría afuera y el test seguiría en verde.
    */
    const { data, error } = await clienteDePrueba().rpc('tablas_publicas')
    if (error) throw new Error(`No se pudo listar las tablas: ${error.message}`)

    tablas = (data as { tabla: string }[] | string[]).map((t) =>
      typeof t === 'string' ? t : t.tabla,
    )

    if (tablas.length === 0) throw new Error('La base no devolvió ninguna tabla')
  }, 60_000)

  it('la base devolvió una cantidad de tablas plausible', () => {
    /*
      Guarda contra el falso verde más tonto de todos: si `tablas_publicas()`
      devolviera vacío, los bucles de abajo no probarían nada y la suite pasaría
      igual. Es el mismo defecto que tuvo la primera versión del test de lectura,
      que se comparaba contra sí misma y por eso no podía fallar nunca.
    */
    expect(tablas.length).toBeGreaterThan(40)
  })

  /*
    Los casos se acumulan y se reportan TODOS juntos, en un `it` por operación.

    Con un `expect` por tabla dentro del bucle, la primera que falla esconde a las
    demás, y en una auditoría lo que importa es la lista completa: saber que hay
    una tabla abierta sirve la mitad que saber que hay siete.

    Y va en un `it` y no en un `it.each` porque la lista se conoce recién en el
    `beforeAll`, y Vitest arma los casos antes de eso.
  */
  it('anon no puede INSERTAR en ninguna tabla', async () => {
    const anon = clienteAnonimo()
    const infractores: string[] = []

    for (const tabla of tablas) {
      const { error } = await anon.from(tabla).insert({})

      if (!error) {
        // Sin error el insert entró: el peor caso posible.
        infractores.push(`${tabla} (¡el insert ENTRÓ!)`)
        continue
      }
      if (!DENEGADO.has(error.code ?? '')) {
        infractores.push(`${tabla} (${error.code}: la barrera dejó pasar, falló la validación)`)
      }
    }

    expect(
      infractores,
      'anon puede escribir en estas tablas. Falta `revoke insert on <tabla> from anon` ' +
        'en su migración: **RLS activo NO alcanza** si el grant de tabla sigue puesto',
    ).toEqual([])
  }, 120_000)

  it('anon no puede ACTUALIZAR en ninguna tabla', async () => {
    const anon = clienteAnonimo()
    const infractores: string[] = []

    for (const tabla of tablas) {
      /*
        `is null` sobre la clave primaria no alcanza ninguna fila, así que este
        sondeo no puede modificar datos ni cuando encuentra un agujero.

        Por lo mismo, la ausencia de error no prueba que el `update` haya
        cambiado algo —no matcheó nada—: lo que prueba es que el **grant** está,
        que es exactamente lo que se audita.
      */
      const { error } = await anon.from(tabla).update({}).is(claveDe(tabla), null)

      if (!error) {
        infractores.push(`${tabla} (anon conserva UPDATE)`)
        continue
      }
      if (!DENEGADO.has(error.code ?? '')) {
        infractores.push(`${tabla} (${error.code}: la barrera dejó pasar)`)
      }
    }

    expect(
      infractores,
      'anon conserva UPDATE sobre estas tablas. Falta `revoke update on <tabla> from anon`',
    ).toEqual([])
  }, 120_000)

  it('anon no puede BORRAR en ninguna tabla', async () => {
    const anon = clienteAnonimo()
    const infractores: string[] = []

    for (const tabla of tablas) {
      const { error } = await anon.from(tabla).delete().is(claveDe(tabla), null)

      if (!error) {
        infractores.push(`${tabla} (anon conserva DELETE)`)
        continue
      }
      if (!DENEGADO.has(error.code ?? '')) {
        infractores.push(`${tabla} (${error.code}: la barrera dejó pasar)`)
      }
    }

    expect(
      infractores,
      'anon conserva DELETE sobre estas tablas. Es el más caro de los tres: borrar ' +
        'no se deshace sin restaurar un backup, y restaurar un backup nunca se probó',
    ).toEqual([])
  }, 120_000)

  it('la clave declarada a mano existe en esas dos tablas', () => {
    /*
      Si mañana `puntos_venta` gana un `id`, esta excepción queda apuntando a una
      columna que ya no es la clave y el sondeo seguiría andando por casualidad.
      Se verifica que las dos tablas sigan existiendo; que la columna sea la
      correcta lo demuestra el propio sondeo, que fallaría con 42703.
    */
    for (const tabla of Object.keys(CLAVE_POR_TABLA)) {
      expect(tablas, `la excepción «${tabla}» apunta a una tabla que ya no existe`).toContain(tabla)
    }
  })
})
