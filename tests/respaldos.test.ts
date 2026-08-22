import { describe, it, expect } from 'vitest'
import {
  DIAS_CRITICOS,
  DIAS_RECOMENDADOS,
  ETIQUETAS_ESTADO_RESPALDO,
  TABLAS_RESPALDO,
  diasDesde,
  estadoRespaldo,
  nombreArchivo,
  tablasConDatosPersonales,
  tamanioLegible,
} from '@/lib/domain/respaldos'

/**
 * Los respaldos son la función donde la honestidad importa más que el código: la
 * aplicación **no puede** hacer un backup de Postgres, y lo único peor que no
 * tenerlo sería un botón que dijera que sí.
 *
 * Lo que se prueba acá es que el estado se calcule bien —«nunca» es distinto de
 * «viejo»— y que la lista de tablas siga completa y clasificada.
 */

const AHORA = new Date('2027-06-15T12:00:00Z')

function haceDias(d: number): string {
  return new Date(AHORA.getTime() - d * 86_400_000).toISOString()
}

describe('estadoRespaldo', () => {
  it('«nunca» se distingue de «viejo»', () => {
    // Son dos situaciones distintas: nadie configuró esto todavía, contra alguien
    // lo hacía y dejó de hacerlo. Merecen mensajes distintos.
    expect(estadoRespaldo(null, AHORA)).toBe('nunca')
    expect(estadoRespaldo(haceDias(100), AHORA)).toBe('vencido')
  })

  it('recién exportado está al día', () => {
    expect(estadoRespaldo(haceDias(0), AHORA)).toBe('al_dia')
    expect(estadoRespaldo(haceDias(DIAS_RECOMENDADOS - 1), AHORA)).toBe('al_dia')
  })

  it('a los 7 días conviene exportar', () => {
    expect(estadoRespaldo(haceDias(DIAS_RECOMENDADOS), AHORA)).toBe('conviene')
    expect(estadoRespaldo(haceDias(DIAS_CRITICOS - 1), AHORA)).toBe('conviene')
  })

  it('a los 30 está vencido', () => {
    expect(estadoRespaldo(haceDias(DIAS_CRITICOS), AHORA)).toBe('vencido')
  })

  it('una fecha ilegible se trata como «nunca», no como reciente', () => {
    // Tratarla como reciente diría «al día» sobre un dato que no existe.
    expect(estadoRespaldo('cualquier cosa', AHORA)).toBe('nunca')
  })

  it('cada estado tiene etiqueta', () => {
    for (const e of ['nunca', 'al_dia', 'conviene', 'vencido'] as const) {
      expect(ETIQUETAS_ESTADO_RESPALDO[e]).toBeTruthy()
    }
  })
})

describe('diasDesde', () => {
  it('cuenta los días', () => {
    expect(diasDesde(haceDias(5), AHORA)).toBe(5)
    expect(diasDesde(haceDias(0), AHORA)).toBe(0)
  })

  it('sin fecha devuelve null, no cero', () => {
    // Cero significaría «hoy», que es lo contrario de «nunca».
    expect(diasDesde(null, AHORA)).toBeNull()
    expect(diasDesde('nunca', AHORA)).toBeNull()
  })

  it('una fecha futura da 0, no un negativo', () => {
    expect(diasDesde(new Date(AHORA.getTime() + 86_400_000).toISOString(), AHORA)).toBe(0)
  })
})

describe('TABLAS_RESPALDO', () => {
  it('incluye las tablas irrecuperables', () => {
    // Estas cuatro son las que no están en ningún otro lado: si se pierden, no hay
    // forma de reconstruirlas.
    const nombres = TABLAS_RESPALDO.map((t) => t.tabla)
    expect(nombres).toContain('huespedes')
    expect(nombres).toContain('reservas')
    expect(nombres).toContain('estadias')
    expect(nombres).toContain('pagos')
  })

  it('incluye el tarifario, que es el dato comercial más difícil de rehacer', () => {
    const nombres = TABLAS_RESPALDO.map((t) => t.tabla)
    expect(nombres).toContain('tarifas')
    expect(nombres).toContain('temporada_rangos')
  })

  it('incluye las facturas, que tienen valor fiscal', () => {
    expect(TABLAS_RESPALDO.map((t) => t.tabla)).toContain('facturas')
  })

  it('NO incluye lo regenerable ni lo que crece sin techo', () => {
    // Exportar de más hace el archivo más grande y más peligroso, no más útil.
    const nombres = TABLAS_RESPALDO.map((t) => t.tabla)
    expect(nombres).not.toContain('intentos_limitados')
    expect(nombres).not.toContain('auditoria')
  })

  it('cada tabla dice por qué se incluye', () => {
    // Es lo que se muestra en pantalla: una lista de nombres de tabla no le explica
    // nada a quien tiene que decidir si el respaldo le sirve.
    for (const t of TABLAS_RESPALDO) {
      expect(t.porQue.length).toBeGreaterThan(10)
    }
  })

  it('no hay tablas repetidas', () => {
    const nombres = TABLAS_RESPALDO.map((t) => t.tabla)
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('marca las que tienen datos personales', () => {
    // De ahí sale la advertencia de tratar el archivo como confidencial y la
    // restricción a admin.
    const conDatos = tablasConDatosPersonales()
    expect(conDatos).toContain('huespedes')
    expect(conDatos).toContain('reservas')
    expect(conDatos).not.toContain('tarifas')
    expect(conDatos.length).toBeGreaterThan(0)
  })

  it('los catálogos van antes que los movimientos', () => {
    // El orden es el de dependencia: quien tenga que reconstruir la base puede
    // insertar en este orden sin chocar con claves foráneas.
    const nombres = TABLAS_RESPALDO.map((t) => t.tabla)
    expect(nombres.indexOf('tipos_unidad')).toBeLessThan(nombres.indexOf('unidades'))
    expect(nombres.indexOf('unidades')).toBeLessThan(nombres.indexOf('estadias'))
    expect(nombres.indexOf('huespedes')).toBeLessThan(nombres.indexOf('reservas'))
    expect(nombres.indexOf('reservas')).toBeLessThan(nombres.indexOf('pagos'))
    expect(nombres.indexOf('reservas')).toBeLessThan(nombres.indexOf('consumos'))
    expect(nombres.indexOf('productos_servicios')).toBeLessThan(nombres.indexOf('consumos'))
  })
})

describe('nombreArchivo', () => {
  it('empieza con la fecha para que se ordenen solos en la carpeta', () => {
    const n = nombreArchivo(AHORA)
    expect(n).toContain('2027-06-15')
    expect(n.endsWith('.json')).toBe(true)
  })

  it('no tiene caracteres que rompan un nombre de archivo', () => {
    // Los dos puntos de la hora ISO no son válidos en Windows.
    expect(nombreArchivo(AHORA)).not.toContain(':')
  })

  it('dos exportaciones en distinto segundo no colisionan', () => {
    const a = nombreArchivo(AHORA)
    const b = nombreArchivo(new Date(AHORA.getTime() + 1000))
    expect(a).not.toBe(b)
  })
})

describe('tamanioLegible', () => {
  it('usa la unidad que corresponde', () => {
    expect(tamanioLegible(512)).toBe('512 B')
    expect(tamanioLegible(2048)).toBe('2.0 kB')
    expect(tamanioLegible(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('un valor inválido no imprime NaN', () => {
    expect(tamanioLegible(Number.NaN)).toBe('—')
    expect(tamanioLegible(-1)).toBe('—')
  })
})
