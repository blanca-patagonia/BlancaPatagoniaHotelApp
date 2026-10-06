import { describe, it, expect } from 'vitest'
import { ANCHO_COLAPSADO, CLAVE_COLAPSADO, leerColapsadoGuardado } from '@/lib/domain/nav-colapso'
import { ANCHO_MINIMO, CLAVE_ANCHO, leerAnchoGuardado } from '@/lib/domain/lateral'
import { CLAVE_PLEGADO } from '@/lib/domain/nav-plegado'

/**
 * Colapso del menú lateral a solo íconos.
 *
 * Son veintidós líneas y una sola función, pero lo que tiene alrededor es
 * `localStorage`: texto crudo que puede venir de una versión anterior del
 * panel, de otra pestaña o de alguien que lo escribió a mano desde las
 * herramientas del navegador. Un menú que se rompe ahí deja a la persona sin
 * navegación y sin forma obvia de recuperarla, porque el estado sobrevive al
 * refresco.
 */

describe('leerColapsadoGuardado', () => {
  it('sin preferencia guardada el menú arranca expandido', () => {
    // El caso de quien entra por primera vez. Un panel que abriera colapsado
    // le mostraría dieciocho íconos sin etiqueta a la persona que menos conoce
    // el sistema: las etiquetas sólo aparecen al pasar el mouse.
    expect(leerColapsadoGuardado(null)).toBe(false)
  })

  it('sólo el «1» exacto colapsa', () => {
    // Es lo único que escribe `shell.tsx`. Cualquier otra cosa es un valor de
    // otra versión o de otra mano.
    expect(leerColapsadoGuardado('1')).toBe(true)
  })

  it('cualquier otro texto vuelve a expandido en vez de romper', () => {
    // Fail-safe: ante un valor que no se entiende conviene mostrar de más y no
    // de menos. Ojo con `'true'` y `'1 '`: son los dos errores naturales de
    // quien guarde esto desde otro lado, y ninguno tiene que colapsar.
    for (const crudo of ['0', '', ' ', ' 1 ', 'true', 'sí', '11', '01', '{}', 'null']) {
      expect(leerColapsadoGuardado(crudo), `«${crudo}» colapsó el menú`).toBe(false)
    }
  })

  it('el «0» que escribe el panel al expandir se lee como expandido', () => {
    // `shell.tsx` guarda `colapsado ? '1' : '0'`. El viaje de ida y vuelta
    // tiene que cerrar: si `'0'` se leyera como colapsado, expandir el menú y
    // recargar lo volvería a cerrar para siempre.
    for (const colapsado of [true, false]) {
      expect(leerColapsadoGuardado(colapsado ? '1' : '0')).toBe(colapsado)
    }
  })
})

describe('el colapso convive con el ancho arrastrable', () => {
  it('usa una clave propia, distinta de la del ancho y la del plegado', () => {
    // Las tres preferencias del menú viven en `localStorage` con el prefijo
    // `bp:`. Una clave repetida —el error natural al copiar el módulo de al
    // lado— haría que colapsar el menú pisara el ancho que la persona arrastró.
    const claves = [CLAVE_COLAPSADO, CLAVE_ANCHO, CLAVE_PLEGADO]
    expect(new Set(claves).size).toBe(claves.length)
  })

  it('el ancho colapsado es bastante menor que el mínimo arrastrable', () => {
    // El punto del modo es ganar lugar en la grilla de ocupación. Si el ancho
    // de íconos llegara al mínimo que ya se puede arrastrar (200 px), colapsar
    // no serviría de nada y la función sobraría.
    expect(ANCHO_COLAPSADO).toBeLessThan(ANCHO_MINIMO)
    expect(ANCHO_COLAPSADO).toBeGreaterThan(0)
  })

  it('colapsar no pisa el ancho guardado: al expandir vuelve el que había', () => {
    // Son dos claves independientes a propósito. Se simula el navegador con un
    // mapa: se guarda un ancho arrastrado, se colapsa, y el ancho tiene que
    // seguir ahí intacto.
    const almacen = new Map<string, string>()
    almacen.set(CLAVE_ANCHO, '380')
    almacen.set(CLAVE_COLAPSADO, '1')

    expect(leerColapsadoGuardado(almacen.get(CLAVE_COLAPSADO) ?? null)).toBe(true)
    expect(leerAnchoGuardado(almacen.get(CLAVE_ANCHO) ?? null)).toBe(380)
  })
})
