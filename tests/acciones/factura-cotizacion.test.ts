import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../apoyo/db'
import { nuevoContexto, crearHuespedDePrueba, limpiar, destinoDe, formulario, sesionActual, type Contexto } from './entorno'

/**
 * La factura informa a ARCA el tipo de cambio del dólar.
 *
 * `emitirFactura` armaba el comprobante con `moneda: 'USD'` y `cotizacion: null`.
 * ARCA exige el tipo de cambio en todo comprobante en moneda extranjera, así que
 * `armarComprobante` lo rechazaba SIEMPRE y cada factura dejaba un error en
 * «Errores del sistema» («La moneda del comprobante no se puede informar a
 * ARCA»): siete facturas de la demo, siete errores. Lo vio el docente.
 *
 * Se captura lo que llega al proveedor de facturación: con la cotización
 * vigente del sistema, el comprobante sale armado y con ese tipo de cambio.
 */

const PESOS_POR_DOLAR = 1450

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/auth/session', async () => {
  const { sesionActual } = await import('./entorno')
  return {
    obtenerSesion: async () => sesionActual(),
    requerirSesion: async () => sesionActual(),
    requerirAcceso: async () => sesionActual(),
    requerirRol: async () => sesionActual(),
  }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('../apoyo/db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})
// La fuente externa de cotización no se consulta en un test: se fija el valor.
vi.mock('@/lib/divisas/servicio', () => ({
  cotizacionVigente: async () => ({ venta: PESOS_POR_DOLAR, compra: PESOS_POR_DOLAR - 50 }),
}))

/** Lo último que la acción le pidió al proveedor de facturación. */
const solicitudes: unknown[] = []
vi.mock('@/lib/facturacion', async (original) => {
  const real = await original<typeof import('@/lib/facturacion')>()
  return {
    ...real,
    obtenerProveedorFacturacion: () => {
      const proveedor = real.obtenerProveedorFacturacion()
      return {
        ...proveedor,
        solicitarCae: async (s: Parameters<typeof proveedor.solicitarCae>[0]) => {
          solicitudes.push(s)
          return proveedor.solicitarCae(s)
        },
      }
    },
  }
})

describe.skipIf(!hayDB)('emitirFactura · tipo de cambio para ARCA', () => {
  let ctx: Contexto
  let emitirFactura: typeof import('@/app/(front-gestion)/panel/reservas/factura.actions')['emitirFactura']
  let sembreDatosFiscales = false

  beforeAll(async () => {
    ctx = nuevoContexto()
    emitirFactura = (await import('@/app/(front-gestion)/panel/reservas/factura.actions')).emitirFactura

    const { data: perfil } = await ctx.db.from('perfiles').select('id').limit(1).maybeSingle()
    if (!perfil) throw new Error('No hay perfiles: correr `npm run seed:usuarios` después del reset.')
    sesionActual().userId = (perfil as { id: string }).id

    // Sin el CUIT del hotel el comprobante se corta antes de mirar la moneda.
    // Se siembra sólo si falta, y se borra sólo lo que se sembró.
    const { data: fiscal } = await ctx.db.from('datos_fiscales').select('id').maybeSingle()
    if (!fiscal) {
      const { error } = await ctx.db
        .from('datos_fiscales')
        .insert({ razon_social: 'Hotel de prueba', cuit: '30712345678' })
      if (error) throw new Error(`No se pudieron sembrar los datos fiscales: ${error.message}`)
      sembreDatosFiscales = true
    }
  })

  afterAll(async () => {
    if (sembreDatosFiscales) await ctx.db.from('datos_fiscales').delete().eq('id', true)
    await limpiar(ctx)
  })

  it('el comprobante sale armado, en dólares y con la cotización vigente', async () => {
    const huespedId = await crearHuespedDePrueba(ctx)
    const { data } = await ctx.db
      .from('reservas')
      .insert({ huesped_id: huespedId, estado: 'checkout', total: 121 })
      .select('id')
      .single()
    const id = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'reservas', id })
    // Una estadía es un servicio: ARCA exige el período (`FchServDesde/Hasta`).
    // En `checkout` no ocupa inventario, así que no choca con ninguna otra.
    const { data: unidad } = await ctx.db.from('unidades').select('id, tipo_unidad_id').limit(1).single()
    const { error: eEstadia } = await ctx.db.from('estadias').insert({
      reserva_id: id,
      unidad_id: (unidad as { id: string }).id,
      tipo_unidad_id: (unidad as { tipo_unidad_id: string }).tipo_unidad_id,
      periodo: '[2026-11-01,2026-11-04)',
      estado: 'checkout',
      huespedes: 2,
    })
    if (eEstadia) throw new Error(`No se pudo crear la estadía: ${eEstadia.message}`)

    const destino = await destinoDe(() => emitirFactura(formulario({ reserva_id: id })))
    expect(destino).toContain('/factura')

    const ultima = solicitudes.at(-1) as { comprobante: { monId: string; monCotiz: number } | null }
    // `null` es justamente lo que pasaba: el motivo «moneda» y un error por factura.
    expect(ultima.comprobante, 'el comprobante no se pudo armar').not.toBeNull()
    expect(ultima.comprobante!.monId).toBe('DOL')
    expect(ultima.comprobante!.monCotiz).toBe(PESOS_POR_DOLAR)
  })
})
