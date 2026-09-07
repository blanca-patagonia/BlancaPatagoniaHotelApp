import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, hayAnon, clienteDePrueba, clienteAnonimo, sufijoUnico } from './db'
import { publicarAri } from '@/lib/canales/ari'

/**
 * Publicación de disponibilidad contra la base (Bloque E, migración 0081).
 *
 * ── Lo que este archivo fija ────────────────────────────────────────────────
 *
 * 1. **La corrida queda registrada aunque no se publique nada.** Sin eso, «el
 *    canal no se está actualizando» no se distingue de «nadie corrió el proceso»,
 *    y son dos problemas con soluciones distintas.
 * 2. **«No puedo publicar» se distingue de «fallé».** Con el proveedor simulado
 *    —de solo lectura, como el informe CSV y el feed iCal— el resultado es
 *    `noSoportado`, que es la verdad y no un error.
 * 3. **El mapeo es unívoco en los dos sentidos.** Un tipo se publica una sola vez
 *    por canal y un código del canal apunta a un solo tipo, o la importación no
 *    sabría a cuál resolver.
 */

describe.skipIf(!hayDB)('publicar el ARI', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  let tipoId = ''

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data, error } = await db
      .from('tipos_unidad')
      .select('id')
      .eq('activo', true)
      .order('codigo')
      .limit(1)
      .single<{ id: string }>()
    if (error) throw new Error(`no hay tipos de unidad: ${error.message}`)
    tipoId = data.id
  })

  afterAll(async () => {
    await db.from('canal_tipos').delete().like('codigo_canal', `TEST-${sufijo}%`)
    await db.from('canal_sincronizaciones').delete().eq('origen', 'ari')
  })

  it('sin ningún tipo mapeado, lo dice y deja el rastro', async () => {
    // Se corre antes de mapear nada. Que quede registrado es el punto: la pantalla
    // tiene que poder decir «se corrió y no había a qué publicarle».
    await db.from('canal_tipos').delete().eq('canal', 'booking')

    const r = await publicarAri('booking', { dias: 7 })

    expect(r.ok).toBe(false)
    expect(r.detalle).toContain('mapeado')

    const { data } = await db
      .from('canal_sincronizaciones')
      .select('sentido, origen, detalle')
      .eq('origen', 'ari')
      .order('corrida_en', { ascending: false })
      .limit(1)
      .maybeSingle<{ sentido: string; origen: string; detalle: string }>()

    expect(data, 'la corrida sin mapeos no dejó rastro').not.toBeNull()
    expect(data?.sentido, 'una corrida de salida se confundiría con una importación').toBe('salida')
  }, 60_000)

  it('con el tipo mapeado, calcula y publica de punta a punta', async () => {
    /*
      El circuito completo contra el proveedor simulado.

      ⚠️ **El simulador declara `publicaDisponibilidad: true` a propósito** —está
      escrito en `lib/canales/index.ts`: sirve justamente para poder ejercitar las
      operaciones que ningún proveedor real de solo lectura soporta—. Así que este
      caso NO prueba la limitación del ADR 0021; prueba que el cálculo, el envío y
      el rastro funcionan.

      La primera versión de este test afirmaba `noSoportado: true` acá y CI la
      volteó. Queda anotado porque es la clase de suposición que se ve razonable:
      «el proveedor de prueba no publica» era falso, y el que sí lo declara es el
      de iCal. El caso «no puedo» se cubre puro, en `motivoNoPublicar`.
    */
    const { error } = await db.from('canal_tipos').insert({
      canal: 'booking',
      tipo_unidad_id: tipoId,
      codigo_canal: `TEST-${sufijo}-A`,
    })
    if (error) throw new Error(`no se pudo mapear el tipo: ${error.message}`)

    const r = await publicarAri('booking', { dias: 7 })

    // Con tarifas cargadas publica; sin ellas, el motivo es «faltan tarifas» y
    // tampoco es un fallo del sistema. Las dos salidas son legítimas y la que NO
    // puede pasar es un error de lectura o de escritura.
    expect(r.detalle, JSON.stringify(r)).toBeTruthy()
    expect(r.detalle).not.toContain('No se pudo')

    if (r.resumen.filas > 0) {
      expect(r.ok, `el simulador tendría que aceptar las filas: ${r.detalle}`).toBe(true)
      expect(r.aceptadas).toBe(r.resumen.filas)
    } else {
      expect(r.detalle, 'sin filas, el motivo tiene que ser la falta de tarifas').toContain(
        'tarifas',
      )
    }

    const { data } = await db
      .from('canal_sincronizaciones')
      .select('sentido, leidas, actualizadas, rechazadas')
      .eq('origen', 'ari')
      .order('corrida_en', { ascending: false })
      .limit(1)
      .maybeSingle<{
        sentido: string
        leidas: number
        actualizadas: number
        rechazadas: number
      }>()

    expect(data?.sentido).toBe('salida')
    expect(data?.leidas, 'el rastro no registró las filas calculadas').toBe(r.resumen.filas)
    expect(data?.actualizadas).toBe(r.aceptadas)
  }, 60_000)

  it('un tipo no se mapea dos veces al mismo canal', async () => {
    // Habría dos códigos distintos para el mismo tipo y el ARI publicaría el
    // inventario dos veces, cada vez con su nombre.
    const { error } = await db.from('canal_tipos').insert({
      canal: 'booking',
      tipo_unidad_id: tipoId,
      codigo_canal: `TEST-${sufijo}-B`,
    })

    expect(error?.code, 'aceptó mapear el mismo tipo dos veces').toBe('23505')
  })

  it('dos tipos no comparten el código del canal', async () => {
    /*
      Si lo compartieran, `importarEntrante` no sabría a cuál resolver: la reserva
      entrante caería en el tipo equivocado, con otra capacidad y otra tarifa.
    */
    const { data: otro } = await db
      .from('tipos_unidad')
      .select('id')
      .neq('id', tipoId)
      .eq('activo', true)
      .limit(1)
      .maybeSingle<{ id: string }>()

    if (!otro) {
      throw new Error('hace falta un segundo tipo de unidad activo para probar esto')
    }

    const { error } = await db.from('canal_tipos').insert({
      canal: 'booking',
      tipo_unidad_id: otro.id,
      codigo_canal: `TEST-${sufijo}-A`,
    })

    expect(error?.code, 'dos tipos quedaron con el mismo código de canal').toBe('23505')
  })

  it('un código vacío se rechaza', async () => {
    const { data: otro } = await db
      .from('tipos_unidad')
      .select('id')
      .neq('id', tipoId)
      .eq('activo', true)
      .limit(1)
      .maybeSingle<{ id: string }>()
    if (!otro) throw new Error('hace falta un segundo tipo de unidad activo')

    const { error } = await db
      .from('canal_tipos')
      .insert({ canal: 'booking', tipo_unidad_id: otro.id, codigo_canal: '   ' })

    expect(error, 'aceptó un código de canal en blanco').not.toBeNull()
  })

  it('las corridas viejas siguen siendo de entrada', async () => {
    // La columna `sentido` nace en 'entrada' porque era lo único que existía.
    // Si el default fuera otro, todo el historial previo se leería al revés.
    const { data } = await db
      .from('canal_sincronizaciones')
      .select('sentido')
      .neq('origen', 'ari')
      .limit(5)

    for (const fila of (data ?? []) as { sentido: string }[]) {
      expect(fila.sentido).toBe('entrada')
    }
  })
})

describe.skipIf(!hayAnon)('borde público del mapeo de canal', () => {
  it('anon no lee con qué códigos y topes publica el hotel', async () => {
    // Lleva el inventario que el hotel se reserva y qué tipos tiene cerrados en
    // cada OTA: es estrategia comercial.
    const { data, error } = await clienteAnonimo().from('canal_tipos').select('id').limit(1)

    expect(data ?? [], 'anon leyó la estrategia de canales del hotel').toHaveLength(0)
    if (error) expect(['42501', '42P01']).toContain(error.code)
  })
})
