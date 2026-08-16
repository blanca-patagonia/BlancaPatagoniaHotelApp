import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../db'
import {
  nuevoContexto,
  crearHuespedDePrueba,
  limpiar,
  destinoDe,
  formulario,
  sesionActual,
  type Contexto,
} from './entorno'

/*
  El borde de Next se falsea porque depende del contexto de una petición HTTP.
  La base, el dominio y el código de la acción corren de verdad.
*/
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
  }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('../db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})

describe.skipIf(!hayDB)('Server Actions · reservas', () => {
  // Los tipos se derivan del módulo real: si cambia la firma de una acción,
  // el typecheck lo marca acá en lugar de fallar en tiempo de ejecución.
  type Acciones = typeof import('@/app/panel/reservas/actions')
  let ctx: Contexto
  let emitirFactura: Acciones['emitirFactura']
  let crearReservaAction: Acciones['crearReservaAction']
  let cambiarEstadoReserva: Acciones['cambiarEstadoReserva']

  beforeAll(async () => {
    ctx = nuevoContexto()
    const acciones = await import('@/app/panel/reservas/actions')
    emitirFactura = acciones.emitirFactura
    crearReservaAction = acciones.crearReservaAction
    cambiarEstadoReserva = acciones.cambiarEstadoReserva

    // El usuario de la sesión falsa tiene que existir: `emitirFactura` guarda
    // quién emitió, y hay una FK contra `perfiles`.
    //
    // Se corta acá con un mensaje explícito en lugar de seguir: sin perfil, la
    // emisión falla en silencio y los tests reportan "expected [] to have
    // length 2", que no dice nada sobre la causa real.
    const { data: perfil } = await ctx.db.from('perfiles').select('id').limit(1).maybeSingle()
    if (!perfil) {
      throw new Error(
        'No hay ningún perfil en la base. `npx supabase db reset` borra los usuarios ' +
          'de auth: hay que correr `npm run seed:usuarios` después.',
      )
    }
    sesionActual().userId = (perfil as { id: string }).id
  })

  afterAll(async () => {
    await limpiar(ctx)
  })

  /** Crea una reserva directamente en la base, sin pasar por el alta. */
  async function reservaEnEstado(estado: string, extra: Record<string, unknown> = {}) {
    const huespedId = await crearHuespedDePrueba(ctx)
    const { data } = await ctx.db
      .from('reservas')
      .insert({ huesped_id: huespedId, estado, total: 121, ...extra })
      .select('id')
      .single()
    const id = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'reservas', id })
    return id
  }

  describe('emitirFactura', () => {
    it('NO factura una reserva que todavía no se consumió', async () => {
      const id = await reservaEnEstado('confirmada')
      const destino = await destinoDe(() => emitirFactura(formulario({ reserva_id: id })))

      expect(destino).toContain('error=sin_consumir')
      const { count } = await ctx.db
        .from('facturas')
        .select('*', { count: 'exact', head: true })
        .eq('reserva_id', id)
      expect(count).toBe(0)
    })

    it('NO factura una reserva cancelada', async () => {
      const id = await reservaEnEstado('cancelada')
      const destino = await destinoDe(() => emitirFactura(formulario({ reserva_id: id })))
      expect(destino).toContain('error=anulada')
    })

    it('factura un check-out con IVA discriminado y CAE', async () => {
      const id = await reservaEnEstado('checkout')
      const destino = await destinoDe(() => emitirFactura(formulario({ reserva_id: id })))
      expect(destino).toContain('/factura')

      const { data } = await ctx.db
        .from('facturas')
        .select('id, tipo_comprobante, neto, iva, total, cae, cae_vto, numero_fiscal, condicion_iva_receptor')
        .eq('reserva_id', id)
        .single()

      const f = data as {
        id: string
        tipo_comprobante: string
        neto: number
        iva: number
        total: number
        cae: string
        cae_vto: string
        numero_fiscal: string
        condicion_iva_receptor: string
      }
      // Se borra por el id de la FACTURA, no por el de la reserva.
      ctx.aBorrar.push({ tabla: 'facturas', id: f.id })

      // Huésped consumidor final ⇒ factura B.
      expect(f.tipo_comprobante).toBe('B')
      expect(f.condicion_iva_receptor).toBe('consumidor_final')
      // 121 con IVA al 21 % = 100 de neto + 21 de impuesto.
      expect(Number(f.neto)).toBeCloseTo(100, 2)
      expect(Number(f.iva)).toBeCloseTo(21, 2)
      expect(Number(f.neto) + Number(f.iva)).toBeCloseTo(Number(f.total), 2)
      // El proveedor simulado devuelve CAE de 14 dígitos con vencimiento.
      expect(f.cae).toMatch(/^\d{14}$/)
      expect(f.cae_vto).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(f.numero_fiscal).toMatch(/^\d{4}-\d{8}$/)
    })

    it('no emite dos comprobantes para la misma reserva', async () => {
      const id = await reservaEnEstado('checkout')
      await destinoDe(() => emitirFactura(formulario({ reserva_id: id })))
      await destinoDe(() => emitirFactura(formulario({ reserva_id: id })))

      const { count } = await ctx.db
        .from('facturas')
        .select('*', { count: 'exact', head: true })
        .eq('reserva_id', id)
      expect(count).toBe(1)

      const { data } = await ctx.db.from('facturas').select('id').eq('reserva_id', id).single()
      ctx.aBorrar.push({ tabla: 'facturas', id: (data as { id: string }).id })
    })

    /**
     * El caso que el test de arriba NO cubre, y que es el que importa.
     *
     * Aquél emite dos veces **en secuencia**, así que la segunda encuentra la
     * factura en la comprobación previa y se va a la pantalla del comprobante. Pasa
     * sin que exista ninguna garantía: lo único que ejercita es un `if`.
     *
     * `emitirFactura` es check-then-act:
     *
     *     select id from facturas where reserva_id = X   -- ¿ya existe?
     *     …
     *     insert into facturas (…)                        -- no existía: se emite
     *
     * Entre las dos sentencias no hay nada. Dos clics simultáneos —o dos personas
     * cerrando la misma reserva desde dos puestos— pasan los dos por el `select`,
     * los dos ven que no hay nada, y los dos insertan. Con un CAE real serían dos
     * documentos fiscales de la misma estadía, y arreglarlo exige una nota de
     * crédito.
     *
     * Lo que se verifica acá es que la garantía **es de la base** y no del `if`: la
     * restricción única `facturas_una_por_reserva` (migración 0045) rechaza el
     * segundo insert aunque las dos emisiones corran a la vez.
     */
    it('con dos emisiones SIMULTÁNEAS, la base deja pasar una sola', async () => {
      const id = await reservaEnEstado('checkout')

      // Sin `await` entre las dos: las dos llamadas están en vuelo al mismo tiempo,
      // así que las dos ejecutan su `select` antes de que cualquiera inserte.
      const destinos = await Promise.all([
        destinoDe(() => emitirFactura(formulario({ reserva_id: id }))),
        destinoDe(() => emitirFactura(formulario({ reserva_id: id }))),
      ])

      const { data, count } = await ctx.db
        .from('facturas')
        .select('id', { count: 'exact' })
        .eq('reserva_id', id)

      const filas = (data ?? []) as { id: string }[]
      for (const f of filas) ctx.aBorrar.push({ tabla: 'facturas', id: f.id })

      expect(count, 'la reserva quedó con más de un comprobante fiscal').toBe(1)

      // Las dos terminan en la pantalla del comprobante: la que ganó porque lo
      // emitió, y la que perdió porque la reserva **está** facturada —por la otra—
      // y mandarla a un error genérico sería mentirle.
      for (const destino of destinos) expect(destino).toContain('/factura')
    })

    it('asigna números correlativos distintos a cada comprobante', async () => {
      const ids = [await reservaEnEstado('checkout'), await reservaEnEstado('checkout')]
      for (const id of ids) await destinoDe(() => emitirFactura(formulario({ reserva_id: id })))

      const { data } = await ctx.db
        .from('facturas')
        .select('id, numero_fiscal')
        .in('reserva_id', ids)

      const filas = (data ?? []) as { id: string; numero_fiscal: string }[]
      for (const f of filas) ctx.aBorrar.push({ tabla: 'facturas', id: f.id })

      expect(filas).toHaveLength(2)
      expect(filas[0].numero_fiscal).not.toBe(filas[1].numero_fiscal)
    })
  })

  describe('crearReservaAction', () => {
    /** Fechas dentro de un rango de temporada cargado, para que haya tarifa. */
    async function fechasConTarifa(): Promise<{ desde: string; hasta: string }> {
      const { data } = await ctx.db.from('temporada_rangos').select('rango').limit(1).single()
      const rango = (data as { rango: string }).rango
      const desde = rango.slice(1, 11)
      const d = new Date(`${desde}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + 1)
      const hasta = d.toISOString().slice(0, 10)
      return { desde, hasta }
    }

    it('guarda el vínculo con la agencia y aplica tarifa neta', async () => {
      const { desde, hasta } = await fechasConTarifa()

      const { data: ag } = await ctx.db
        .from('agencias')
        .insert({ nombre: `Agencia Test ${ctx.sufijo}`, descuento_pct: 10 })
        .select('id')
        .single()
      const agenciaId = (ag as { id: string }).id
      ctx.aBorrar.push({ tabla: 'agencias', id: agenciaId })

      const { data: tipo } = await ctx.db.from('tipos_unidad').select('id').limit(1).single()

      const destino = await destinoDe(() =>
        crearReservaAction(
          {},
          formulario({
            tipo_unidad_id: (tipo as { id: string }).id,
            check_in: desde,
            check_out: hasta,
            huespedes: 1,
            apellido: `Convenio-${ctx.sufijo}`,
            canal: 'directo',
            agencia_id: agenciaId,
          }),
        ),
      )

      // Se afirma el alta en lugar de saltear si falla: un `return` silencioso
      // acá dejaría el test en verde sin haber probado nada, que es el error que
      // este archivo existe para evitar.
      expect(destino, 'el alta no redirigió a la reserva creada').toMatch(
        /^\/panel\/reservas\/[0-9a-f-]{36}$/,
      )

      const reservaId = destino.split('/').pop()!
      const { data } = await ctx.db
        .from('reservas')
        .select('agencia_id, tarifa_tipo, huesped_id')
        .eq('id', reservaId)
        .single()

      const r = data as { agencia_id: string; tarifa_tipo: string; huesped_id: string }
      // El huésped lo creó la acción: se registra ANTES que la reserva para que
      // la limpieza (que invierte el orden) borre la reserva primero.
      ctx.aBorrar.push({ tabla: 'huespedes', id: r.huesped_id })
      ctx.aBorrar.push({ tabla: 'reservas', id: reservaId })

      // Este era el hueco: el formulario mandaba la agencia y la acción la perdía.
      expect(r.agencia_id).toBe(agenciaId)
      // Con convenio corresponde tarifa neta, sea cual sea el canal.
      expect(r.tarifa_tipo).toBe('neto')
    })

    it('rechaza fechas invertidas sin tocar la base', async () => {
      const r = await crearReservaAction(
        {},
        formulario({
          tipo_unidad_id: '00000000-0000-0000-0000-000000000000',
          check_in: '2026-09-10',
          check_out: '2026-09-08',
          apellido: 'X',
        }),
      )
      expect(r.error).toMatch(/check-out/i)
    })

    /*
      Los dos que siguen nacen de un recorrido manual del sistema: al reservar
      para una fecha sin tarifa cargada, la reserva fallaba PERO el huésped
      quedaba creado, y encima el formulario se vaciaba.
    */
    it('NO deja al huésped creado si no hay tarifa para esas fechas', async () => {
      const { data: tipo } = await ctx.db.from('tipos_unidad').select('id').limit(1).single()
      const apellido = `Huerfano-${ctx.sufijo}`

      const r = await crearReservaAction(
        {},
        formulario({
          tipo_unidad_id: (tipo as { id: string }).id,
          // Muy lejos de cualquier temporada cargada: no hay tarifa posible.
          check_in: '2031-07-10',
          check_out: '2031-07-13',
          huespedes: 1,
          apellido,
          canal: 'directo',
        }),
      )

      expect(r.error, 'debía rechazarse por falta de tarifa').toMatch(/tarifa/i)

      // El punto del test: la base no debe quedar con la ficha suelta.
      const { data: quedo } = await ctx.db
        .from('huespedes')
        .select('id')
        .eq('apellido', apellido)
        .maybeSingle()
      if (quedo) ctx.aBorrar.push({ tabla: 'huespedes', id: (quedo as { id: string }).id })
      expect(quedo, 'quedó un huésped sin reserva asociada').toBeNull()
    })

    it('devuelve lo cargado para que el formulario no se vacíe', async () => {
      const { data: tipo } = await ctx.db.from('tipos_unidad').select('id').limit(1).single()

      const r = await crearReservaAction(
        {},
        formulario({
          tipo_unidad_id: (tipo as { id: string }).id,
          check_in: '2031-07-10',
          check_out: '2031-07-13',
          huespedes: 2,
          apellido: 'Pérez',
          nombre: 'Juan',
          email: 'juan.perez@ejemplo.com',
          doc_numero: '30111222',
          canal: 'booking',
        }),
      )

      expect(r.error).toBeTruthy()
      // Sin esto, corregir un solo campo obligaba a escribir todo de nuevo.
      expect(r.valores?.apellido).toBe('Pérez')
      expect(r.valores?.nombre).toBe('Juan')
      expect(r.valores?.email).toBe('juan.perez@ejemplo.com')
      expect(r.valores?.doc_numero).toBe('30111222')
      expect(r.valores?.canal).toBe('booking')
    })
  })

  describe('cambiarEstadoReserva', () => {
    it('rechaza una transición inválida', async () => {
      const id = await reservaEnEstado('checkout')
      const destino = await destinoDe(() =>
        cambiarEstadoReserva(formulario({ reserva_id: id, nuevo_estado: 'pendiente' })),
      )
      expect(destino).toContain('error=transicion')

      const { data } = await ctx.db.from('reservas').select('estado').eq('id', id).single()
      expect((data as { estado: string }).estado).toBe('checkout')
    })

    it('el check-out otorga puntos y genera la encuesta', async () => {
      const id = await reservaEnEstado('in_house', { total: 500 })
      await destinoDe(() =>
        cambiarEstadoReserva(formulario({ reserva_id: id, nuevo_estado: 'checkout' })),
      )

      const { data: reserva } = await ctx.db
        .from('reservas')
        .select('estado, huesped_id')
        .eq('id', id)
        .single()
      const r = reserva as { estado: string; huesped_id: string }
      expect(r.estado).toBe('checkout')

      // 1 punto por cada USD 10 ⇒ 500 da 50.
      const { data: h } = await ctx.db
        .from('huespedes')
        .select('puntos')
        .eq('id', r.huesped_id)
        .single()
      expect((h as { puntos: number }).puntos).toBe(50)

      // El trigger de la base crea la encuesta al pasar a checkout.
      const { data: enc } = await ctx.db
        .from('encuestas_satisfaccion')
        .select('id, token')
        .eq('reserva_id', id)
        .maybeSingle()
      expect(enc).not.toBeNull()
      ctx.aBorrar.push({ tabla: 'encuestas_satisfaccion', id: (enc as { id: string }).id })
    })
  })
})
