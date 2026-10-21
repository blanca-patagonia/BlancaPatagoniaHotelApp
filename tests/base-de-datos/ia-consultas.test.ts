import { describe, it, expect } from 'vitest'
import { clienteDePrueba, hayDB } from '../apoyo/db'
import { SELECTS_IA } from '@/app/(front-gestion)/panel/ia/herramientas'

/**
 * Las consultas de las herramientas del asistente, ejecutadas contra la base.
 *
 * Una columna mal escrita no falla al compilar: falla recién cuando alguien usa
 * el asistente, y el modelo lo cuenta como «no se encontró». Así estuvo
 * `buscar_reserva` desde que se escribió (pedía `reservas.adultos`, que vive en
 * `estadias`) hasta que el usuario lo notó con una reserva que estaba en el
 * listado. `head: true`: valida la consulta sin traer filas.
 */
const TABLA: Record<keyof typeof SELECTS_IA, string> = {
  buscarReserva: 'reservas',
  reservasDeHuesped: 'reservas',
  saldosPendientes: 'reservas',
  operacionDelDia: 'estadias',
  reservaParaConsumo: 'reservas',
  tiposUnidad: 'tipos_unidad',
  estadoUnidades: 'unidades',
  unidadPorNombre: 'unidades',
  reservaParaAccion: 'reservas',
  cuentaDeReserva: 'reservas',
  ordenesMantenimiento: 'ordenes_mantenimiento',
  objetosPerdidos: 'objetos_perdidos',
  avisosInternos: 'avisos',
  agencias: 'agencias',
  proveedores: 'proveedores',
}

describe.skipIf(!hayDB)('consultas del asistente de IA contra la base', () => {
  const db = clienteDePrueba()
  for (const [nombre, select] of Object.entries(SELECTS_IA)) {
    it(`${nombre}: la base acepta la consulta`, async () => {
      const { error } = await db
        .from(TABLA[nombre as keyof typeof SELECTS_IA])
        .select(select, { count: 'exact', head: true })
      expect(error?.message ?? null).toBeNull()
    })
  }
})

describe.skipIf(!hayDB)('buscar_huespedes_parecidos (0118)', () => {
  const db = clienteDePrueba()

  it('devuelve sólo id y puntaje, nunca el nombre', async () => {
    const { data, error } = await db.rpc('buscar_huespedes_parecidos', { p_termino: 'perez', p_limite: 3 })
    expect(error?.message ?? null).toBeNull()
    for (const fila of (data ?? []) as Record<string, unknown>[]) {
      expect(Object.keys(fila).sort()).toEqual(['id', 'parecido'])
    }
  })

  it('con menos de 3 letras no devuelve nada (evita listar a todos)', async () => {
    const { data } = await db.rpc('buscar_huespedes_parecidos', { p_termino: 'ab', p_limite: 5 })
    expect(data ?? []).toEqual([])
  })
})
