import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SELECTS_IA } from '@/app/(front-gestion)/panel/ia/herramientas'

/**
 * Contrato de privacidad: las herramientas del asistente de IA no leen datos
 * personales de huéspedes.
 *
 * Todo lo que devuelve una herramienta viaja al proveedor de IA, que es un
 * tercero. En el plan gratuito de Gemini, Google puede usar lo que recibe para
 * mejorar sus modelos. El sistema decidió que los datos de huéspedes no salgan
 * (ADR 0029): el asistente trabaja con códigos de reserva y unidades.
 *
 * Una regla así se rompe sin querer: alguien suma `huesped:huespedes(...)` a
 * una consulta para «mejorar la respuesta» y nada falla. Este test lee el
 * los archivos de las herramientas (toda la carpeta) y falla si aparece.
 */
const CARPETA = join(process.cwd(), 'src/app/(front-gestion)/panel/ia/herramientas')
const FUENTE = readdirSync(CARPETA)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(CARPETA, f), 'utf8'))
  .join('\n')
// Se ignoran los comentarios: pueden nombrar lo que está prohibido.
const CODIGO = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

/**
 * Desde el 2026-10-19 el asistente puede BUSCAR por el nombre del huésped
 * (`buscar_por_huesped`): el nombre se usa como filtro en la base. Lo que
 * sigue prohibido es LEER datos personales y devolvérselos al modelo. Por eso
 * el contrato mira lo que se selecciona, no lo que se filtra.
 */
const SELECTS = [
  ...[...CODIGO.matchAll(/\.select\(\s*([`'"])([\s\S]*?)\1/g)].map((m) => m[2]),
  // Las consultas centralizadas en `SELECTS_IA` (son las que se mandan al .select()).
  ...Object.values(SELECTS_IA),
]

describe('contrato: la IA no recibe datos personales de huéspedes', () => {
  for (const prohibido of ['email', 'telefono', 'doc_numero', 'apellido', 'nacionalidad', 'cuit_receptor', 'huesped:', 'huespedes(']) {
    it(`ningún select de las herramientas lee «${prohibido}»`, () => {
      expect(SELECTS.filter((sel) => sel.includes(prohibido))).toEqual([])
    })
  }

  it('de la tabla huespedes sólo se lee el id', () => {
    const lecturas = [...CODIGO.matchAll(/from\('huespedes'\)\s*\.select\(\s*'([^']*)'/g)].map((m) => m[1])
    expect(lecturas.length).toBeGreaterThan(0)
    for (const columnas of lecturas) expect(columnas).toBe('id')
  })

  it('reserva_huespedes (acompañantes) no se toca', () => {
    expect(CODIGO).not.toMatch(/\breserva_huespedes\b/)
  })
})

describe('contrato: el texto libre del chat se enmascara antes de salir', () => {
  it('el motor del asistente pasa cada mensaje por enmascararDatosPersonales', () => {
    // Las herramientas están limpias, pero el camino más usado es lo que la
    // persona escribe («cargale a Juan, DNI 30.123.456…»).
    const ruta = readFileSync(
      join(process.cwd(), 'src/app/(front-gestion)/panel/ia/motor.ts'),
      'utf8',
    )
    expect(ruta).toMatch(/enmascararDatosPersonales\(m\.contenido\)/)
  })

  it('la propuesta preparada (ids y lo que se completa en la tarjeta) no vuelve al modelo', () => {
    const ruta = readFileSync(
      join(process.cwd(), 'src/app/(front-gestion)/panel/ia/motor.ts'),
      'utf8',
    )
    expect(ruta).toMatch(/k !== 'propuesta'/)
    expect(ruta).toMatch(/JSON\.stringify\(paraElModelo\)/)
  })

  it('las lecturas que reusa el asistente (reportes/datos.ts) tampoco traen huéspedes', () => {
    const datos = readFileSync(
      join(process.cwd(), 'src/app/(front-gestion)/panel/reportes/datos.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(datos).not.toMatch(/\bhuespedes\b/)
  })
})
