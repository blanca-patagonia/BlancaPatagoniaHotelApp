import { describe, it, expect } from 'vitest'
import { buscarGlobal, TOPE_BUSQUEDA } from '@/lib/busqueda/servicio'
import { ambitosPara } from '@/lib/domain/busqueda'
import type { Rol } from '@/lib/domain/roles'

/**
 * La consulta del buscador global, sin base.
 *
 * ── Qué se prueba acá y qué no ──────────────────────────────────────────────
 *
 * `buscarGlobal` no calcula reglas: arma consultas. Entonces lo que hay que
 * fijar no es «qué devuelve la base» sino **qué le pide**, y sobre todo qué
 * NO le pide. Se le pasa un cliente falso que anota cada `from`, cada filtro
 * y cada `limit`, y se afirma sobre ese registro.
 *
 * Los tres riesgos que este archivo cubre:
 *
 *  1. **Autorización.** Los ámbitos salen de `ambitosPara(rol)`. Si esa guarda
 *     se cae, housekeeping ve la lista de huéspedes del hotel escribiendo tres
 *     letras en el encabezado. El cliente falso devuelve filas para TODAS las
 *     tablas a propósito: si el código consulta una que no debía, aparecen.
 *  2. **El buscador en vivo pega por tecla.** Responde `GET /api/buscar`
 *     mientras alguien escribe. Que un término corto no dispare ninguna
 *     consulta no es un detalle de prolijidad: es la diferencia entre cuatro
 *     consultas y cuarenta por búsqueda.
 *  3. **Los comodines de PostgREST.** `%` y `_` dentro del texto buscado son
 *     comodines de LIKE. Sin escapar, buscar «%» devuelve el hotel entero.
 */

/** Una llamada a la base, tal como la anota el cliente falso. */
interface Llamada {
  tabla: string
  select: string
  filtros: string[]
  limite: number | null
}

/** Filas que el cliente falso devuelve para cada tabla, si se las piden. */
const FILAS: Record<string, Record<string, unknown>[]> = {
  huespedes: [
    { id: 'h-1', apellido: 'Ñandú', nombre: 'Ana', email: 'ana@x.test', doc_numero: '30111222' },
    { id: 'h-2', apellido: 'Pérez', nombre: 'Luis', email: null, doc_numero: null },
  ],
  agencias: [{ id: 'a-1', nombre: 'Patagonia Travel', tipo: 'agencia' }],
  proveedores: [{ id: 'p-1', nombre: 'Lavadero del Sur', rubro: 'lavandería' }],
  reservas: [{ id: 'r-1', codigo: 'BP-0001', estado: 'confirmada', huesped: null, estadias: [] }],
}

/**
 * Cliente de Supabase falso: encadena como el real y anota lo que le pidieron.
 *
 * No hay `vi.mock` de por medio —el cliente entra por parámetro, que es
 * justamente lo que hace testeable a este módulo—.
 */
const HUESPEDES_POR_ID: Record<string, unknown>[] = [
  { id: 'h-parecido', apellido: 'Almiron', nombre: 'Juan', email: null, doc_numero: null },
]

/** Lo que devuelve la búsqueda aproximada (0118) en cada test. */
let PARECIDOS: { id: string; parecido: number }[] = []

function clienteFalso() {
  const llamadas: Llamada[] = []

  const cliente = {
    rpc(nombre: string, args: Record<string, unknown>) {
      llamadas.push({ tabla: `rpc:${nombre}`, select: '', filtros: [JSON.stringify(args)], limite: null })
      return Promise.resolve({ data: PARECIDOS, error: null })
    },
    from(tabla: string) {
      const llamada: Llamada = { tabla, select: '', filtros: [], limite: null }
      llamadas.push(llamada)
      const constructor = {
        select(cols: string) {
          llamada.select = cols
          return constructor
        },
        or(filtro: string) {
          llamada.filtros.push(filtro)
          return constructor
        },
        ilike(columna: string, patron: string) {
          llamada.filtros.push(`${columna}.ilike.${patron}`)
          return constructor
        },
        limit(n: number) {
          llamada.limite = n
          return constructor
        },
        in(columna: string, valores: string[]) {
          llamada.filtros.push(`${columna}.in.(${valores.join(',')})`)
          return constructor
        },
        // El constructor de PostgREST es «thenable»: se resuelve al esperarlo.
        then(resolver: (r: { data: unknown[] }) => unknown) {
          // La lectura por ids de la búsqueda aproximada devuelve esos huéspedes.
          const porIds = llamada.filtros.find((f) => f.startsWith('id.in.('))
          const filas = porIds
            ? HUESPEDES_POR_ID.filter((h) => porIds.includes(String(h.id)))
            : (FILAS[tabla] ?? [])
          return Promise.resolve({ data: filas }).then(resolver)
        },
      }
      return constructor
    },
  }

  return { cliente, llamadas, tablas: () => llamadas.map((l) => l.tabla) }
}

/** Atajo: corre la búsqueda y devuelve el resultado junto con lo consultado. */
async function buscar(rol: Rol, q: string | undefined, tope?: number) {
  const { cliente, llamadas, tablas } = clienteFalso()
  const resultado = await buscarGlobal(cliente as never, rol, q, tope)
  return { resultado, llamadas, tablas: tablas() }
}

describe('buscarGlobal · qué NO llega a la base', () => {
  it('no consulta nada cuando se escribió una sola letra', async () => {
    // El buscador del encabezado consulta con cada tecla. Con una letra, las
    // cuatro tablas devolverían medio sistema y el resultado sería inútil: la
    // regla de `terminoBuscado` (mínimo dos caracteres) tiene que cortar ANTES
    // de la consulta, no filtrar después.
    const { resultado, tablas } = await buscar('admin', 'a')
    expect(tablas).toEqual([])
    expect(resultado.termino).toBeNull()
    expect(resultado.total).toBe(0)
  })

  it('no consulta nada con la caja vacía, con espacios o sin parámetro', async () => {
    // `/panel/buscar` se abre sin `?q=`: entrar a la pantalla no puede costar
    // cuatro consultas.
    for (const q of ['', '   ', undefined, '\n\t']) {
      const { resultado, tablas } = await buscar('admin', q)
      expect(tablas, `se consultó algo con ${JSON.stringify(q)}`).toEqual([])
      expect(resultado.total).toBe(0)
    }
  })

  it('con término corto tampoco devuelve secciones ni glosario', async () => {
    // Las secciones se calculan en memoria, así que es tentador dejarlas pasar
    // «porque no cuestan». No: con una letra el panel entero coincide y la
    // respuesta del buscador en vivo se llena de ruido apenas se toca una tecla.
    const { resultado } = await buscar('admin', 'o')
    expect(resultado.secciones).toEqual([])
    expect(resultado.glosario).toEqual([])
  })
})

describe('buscarGlobal · autorización por rol', () => {
  it('housekeeping no consulta ninguna de las cuatro tablas', async () => {
    // Housekeeping no tiene `reservas`, `huespedes`, `agencias` ni
    // `proveedores` en `PERMISOS`. El cliente falso devuelve filas para todas,
    // así que si alguna consulta se colara, aparecería en el resultado.
    const { resultado, tablas } = await buscar('housekeeping', 'perez')
    expect(tablas).toEqual([])
    expect(resultado.ambitos).toEqual([])
    expect(resultado.huespedes).toEqual([])
    expect(resultado.reservas).toEqual([])
    expect(resultado.agencias).toEqual([])
    expect(resultado.proveedores).toEqual([])
  })

  it('recepción busca huéspedes y agencias pero nunca proveedores', async () => {
    // Recepción no entra a Proveedores. El dato de un proveedor —qué se le
    // compra, a quién— no es parte del mostrador.
    const { resultado, tablas } = await buscar('recepcion', 'sur')
    expect(tablas).toContain('huespedes')
    expect(tablas).toContain('agencias')
    expect(tablas).toContain('reservas')
    expect(tablas).not.toContain('proveedores')
    expect(resultado.proveedores).toEqual([])
  })

  it('admin consulta los nueve ámbitos', async () => {
    const { resultado, tablas } = await buscar('admin', 'sur')
    expect(new Set(tablas)).toEqual(
      new Set([
        'huespedes',
        'agencias',
        'proveedores',
        'reservas',
        'unidades',
        'tipos_unidad',
        'productos_servicios',
        'promociones',
        'perfiles',
      ]),
    )
    expect(resultado.proveedores).toHaveLength(1)
  })

  it('los ámbitos informados son exactamente los que el rol tiene permitidos', async () => {
    // La pantalla los muestra como encabezados. Si dijera un ámbito que no
    // consultó, el usuario leería «Proveedores: sin resultados» y concluiría
    // que no hay ninguno, cuando lo que pasa es que no tiene permiso.
    for (const rol of ['admin', 'gerencia', 'recepcion', 'housekeeping'] as const) {
      const { resultado } = await buscar(rol, 'sur')
      expect(resultado.ambitos, `ámbitos mal informados para ${rol}`).toEqual(ambitosPara(rol))
    }
  })
})

describe('buscarGlobal · los comodines no listan todo', () => {
  it('el porcentaje viaja escapado a los filtros de la base', async () => {
    // Sin escapar, `%` es «todo» para LIKE: buscar un porcentaje devolvería la
    // lista completa de huéspedes del hotel, con documento y correo, a
    // cualquiera que pueda abrir el buscador.
    const { llamadas } = await buscar('admin', '%%')
    const huespedes = llamadas.find((l) => l.tabla === 'huespedes')!
    expect(huespedes.filtros.join('|')).toContain('\\%')
    expect(huespedes.filtros.join('|')).not.toMatch(/ilike\.%%%/)
  })

  it('el guion bajo también se escapa: es el comodín de un carácter', async () => {
    // `_` coincide con cualquier carácter. Buscar «a_b» tiene que buscar ese
    // texto literal y no «a» + cualquier cosa + «b».
    const { llamadas } = await buscar('admin', 'a_b')
    const agencias = llamadas.find((l) => l.tabla === 'agencias')!
    expect(agencias.filtros.join('|')).toContain('a\\_b')
  })

  it('las comillas dobles del término no parten el filtro `or`', async () => {
    // El filtro `or` de PostgREST separa por comas y delimita con comillas: un
    // apodo entre comillas mal escapado rompe la consulta entera y el buscador
    // devuelve error en vez de resultados.
    const { llamadas } = await buscar('admin', 'Pérez "El Gordo"')
    const huespedes = llamadas.find((l) => l.tabla === 'huespedes')!
    expect(huespedes.filtros.join('|')).toContain('\\"El Gordo\\"')
  })

  it('la ñ y los acentos llegan intactos a la base', async () => {
    // El término se normaliza para buscar en la Ayuda, no para consultar: la
    // columna guarda «Ñandú» con su ñ y su tilde, y un ilike sobre «Nandu» no
    // la encuentra. Si alguien reusara acá el texto normalizado, buscar el
    // apellido tal cual está cargado dejaría de traerlo.
    const { llamadas } = await buscar('admin', 'Ñandú')
    const huespedes = llamadas.find((l) => l.tabla === 'huespedes')!
    expect(huespedes.filtros.join('|')).toContain('Ñandú')
  })
})

describe('buscarGlobal · las reservas del huésped encontrado', () => {
  it('busca por código y por los ids de los huéspedes que ya trajo', async () => {
    // Quien busca «Pérez» espera ver sus reservas, no sólo la ficha. Los ids
    // se reusan de la consulta anterior: pedirle a la base los mismos huéspedes
    // dos veces sería el doble de latencia en el buscador en vivo.
    const { llamadas } = await buscar('admin', 'perez')
    const reservas = llamadas.find((l) => l.tabla === 'reservas')!
    expect(reservas.filtros.join('|')).toContain('huesped_id.in.(h-1,h-2)')
    expect(reservas.filtros.join('|')).toContain('codigo.ilike.')
  })

  it('el filtro va sobre `huesped_id`, no sobre la tabla embebida', async () => {
    // La trampa de PostgREST que documenta AGENTS.md: un filtro sobre una
    // tabla embebida sin `!inner` NO filtra nada, devuelve todas las reservas
    // con el huésped en `null`. El buscador quedaría mostrando reservas al azar.
    const { llamadas } = await buscar('admin', 'perez')
    const reservas = llamadas.find((l) => l.tabla === 'reservas')!
    expect(reservas.filtros.join('|')).not.toContain('huespedes.apellido')
    expect(reservas.filtros.join('|')).not.toContain('huesped.apellido')
  })

  it('sin huéspedes encontrados no arma un `in.()` vacío', async () => {
    // Un `in.()` sin ids es sintaxis inválida: PostgREST devuelve 400 y la
    // búsqueda por código —el caso más común en el mostrador, «BP-0001»— falla
    // justo cuando el término no coincide con ningún apellido.
    const { cliente, llamadas } = clienteFalso()
    // Se vacía la tabla de huéspedes sólo para este caso.
    const original = FILAS.huespedes
    FILAS.huespedes = []
    try {
      await buscarGlobal(cliente as never, 'admin', 'BP-0001')
    } finally {
      FILAS.huespedes = original
    }
    const reservas = llamadas.find((l) => l.tabla === 'reservas')!
    expect(reservas.filtros.join('|')).not.toContain('in.(')
    expect(reservas.filtros.join('|')).toContain('codigo.ilike.')
  })
})

describe('buscarGlobal · tope y total', () => {
  it('aplica el tope por omisión a todas las consultas', async () => {
    // Sin `limit`, una búsqueda de dos letras se trae la tabla entera por cada
    // tecla. El buscador es para encontrar algo puntual, no para listar.
    const { llamadas } = await buscar('admin', 'sur')
    expect(llamadas).not.toHaveLength(0)
    for (const l of llamadas) {
      expect(l.limite, `la consulta a ${l.tabla} no tiene tope`).toBe(TOPE_BUSQUEDA)
    }
  })

  it('respeta el tope que le pasa el llamador', async () => {
    // El desplegable del encabezado muestra menos filas que la pantalla
    // completa: pide un tope más chico y tiene que llegar a las cuatro tablas.
    const { llamadas } = await buscar('admin', 'sur', 3)
    for (const l of llamadas) expect(l.limite).toBe(3)
  })

  it('el total cuenta también las secciones y el glosario', async () => {
    // La pantalla decide con el total si muestra «sin resultados». Contar sólo
    // los datos haría que una búsqueda que sí encontró la sección donde se hace
    // la tarea dijera que no encontró nada, con los resultados debajo.
    const { resultado } = await buscar('admin', 'rack')
    expect(resultado.glosario.length).toBeGreaterThan(0)
    expect(resultado.total).toBe(
      resultado.reservas.length +
        resultado.huespedes.length +
        resultado.agencias.length +
        resultado.proveedores.length +
        resultado.unidades.length +
        resultado.tipos_unidad.length +
        resultado.productos.length +
        resultado.promociones.length +
        resultado.usuarios.length +
        resultado.secciones.length +
        resultado.glosario.length,
    )
  })

  it('housekeeping igual encuentra las secciones que sí puede abrir', async () => {
    // No ve datos de huéspedes, pero el buscador le tiene que servir para
    // llegar a su propio módulo: es quien menos conoce el sistema.
    const { resultado } = await buscar('housekeeping', 'housekeeping')
    expect(resultado.secciones.map((s) => s.area)).toContain('housekeeping')
    expect(resultado.total).toBe(resultado.secciones.length + resultado.glosario.length)
  })

  it('un término que no coincide con nada devuelve total cero sin romper', async () => {
    const { cliente } = clienteFalso()
    const original = { ...FILAS }
    for (const t of Object.keys(FILAS)) FILAS[t] = []
    try {
      const r = await buscarGlobal(cliente as never, 'admin', 'zzqxvw')
      expect(r.total).toBe(0)
      expect(r.secciones).toEqual([])
      expect(r.glosario).toEqual([])
      expect(r.termino).toBe('zzqxvw')
    } finally {
      for (const t of Object.keys(original)) FILAS[t] = original[t]
    }
  })
})

describe('buscarGlobal · huéspedes con error de tipeo (0118)', () => {
  it('sin coincidencia exacta usa la aproximada y lo marca', async () => {
    PARECIDOS = [
      { id: 'h-parecido', parecido: 0.57 },
      { id: 'h-lejano', parecido: 0.1 },
    ]
    const exactos = FILAS.huespedes
    FILAS.huespedes = [] // la búsqueda exacta no encuentra a nadie
    const { resultado, llamadas } = await buscar('admin', 'amiron')
    FILAS.huespedes = exactos
    expect(llamadas.some((l) => l.tabla === 'rpc:buscar_huespedes_parecidos')).toBe(true)
    // Sólo los que pasan el umbral se buscan.
    const lectura = llamadas.filter((l) => l.tabla === 'huespedes').at(-1)!
    expect(lectura.filtros).toContain('id.in.(h-parecido)')
    expect(resultado.huespedes.map((h) => h.apellido)).toEqual(['Almiron'])
    expect(resultado.huespedesAproximados).toBe(true)
    PARECIDOS = []
  })

  it('un rol sin acceso a huéspedes no dispara la búsqueda aproximada', async () => {
    PARECIDOS = [{ id: 'h-parecido', parecido: 0.9 }]
    const { llamadas } = await buscar('housekeeping', 'zzqqxx')
    expect(llamadas.some((l) => l.tabla.startsWith('rpc:'))).toBe(false)
    PARECIDOS = []
  })
})

describe('buscarGlobal · sinPersonas (lo usa el asistente de IA)', () => {
  it('no consulta huéspedes, usuarios ni la búsqueda aproximada, y la reserva va sin el nombre del huésped', async () => {
    PARECIDOS = [{ id: 'h-parecido', parecido: 0.9 }]
    const { cliente, llamadas, tablas } = clienteFalso()
    const r = await buscarGlobal(cliente as never, 'admin', 'almiron', 6, { sinPersonas: true })
    expect(tablas()).not.toContain('huespedes')
    expect(tablas()).not.toContain('perfiles')
    expect(tablas()).not.toContain('rpc:buscar_huespedes_parecidos')
    const reservas = llamadas.find((l) => l.tabla === 'reservas')
    expect(reservas?.select).not.toMatch(/huesped/)
    expect(r.huespedes).toEqual([])
    expect(r.usuarios).toEqual([])
    // Lo que no es de personas se sigue buscando.
    expect(tablas()).toEqual(expect.arrayContaining(['agencias', 'proveedores', 'productos_servicios']))
    PARECIDOS = []
  })
})
