import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hayDB, clienteDePrueba, clienteAnonimo, hayAnon, sufijoUnico } from '../apoyo/db'
import { crearUsuarioConRol, hayRoles, limpiarUsuarios, type UsuarioDePrueba } from '../apoyo/roles'

/**
 * Bandeja de mensajes (migraciones 0125 y 0126, ADR 0043), contra Postgres.
 *
 * Lo que se prueba es lo que vive en la BASE y no en la app: la función
 * atómica de entrada (idempotencia, una conversación por identidad, reapertura,
 * vínculo con el huésped y unificación de contactos), el trigger que mantiene
 * la conversación al día y las políticas RLS por rol.
 */

const sufijo = sufijoUnico()
const contactosCreados: string[] = []
const huespedesCreados: string[] = []

interface Rpc {
  conversacion_id?: string
  mensaje_id?: string | null
  contacto_id?: string
  nueva?: boolean
  duplicado?: boolean
  ignorado?: string
}

async function entrante(p: {
  canal?: string
  contacto: string
  mensaje: string | null
  texto?: string
  nombre?: string
  email?: string
  telefono?: string
  tipo?: 'entrante' | 'saliente'
}): Promise<Rpc> {
  const { data, error } = await clienteDePrueba().rpc('crm_registrar_entrante', {
    p_canal: p.canal ?? 'whatsapp',
    p_externo_contacto: p.contacto,
    p_nombre: p.nombre ?? null,
    p_email: p.email ?? null,
    p_telefono: p.telefono ?? null,
    p_externo_mensaje: p.mensaje,
    p_contenido: p.texto ?? 'hola',
    p_adjuntos: [],
    p_creado_en: new Date().toISOString(),
    p_tipo: p.tipo ?? 'entrante',
    p_asunto: null,
  })
  if (error) throw new Error(`crm_registrar_entrante: ${error.message}`)
  const r = data as Rpc
  if (r.contacto_id && !contactosCreados.includes(r.contacto_id)) contactosCreados.push(r.contacto_id)
  return r
}

async function conversacion(id: string) {
  const { data, error } = await clienteDePrueba().from('crm_conversaciones').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data as Record<string, unknown>
}

describe.skipIf(!hayDB)('bandeja · entrada atómica (crm_registrar_entrante)', () => {
  afterAll(async () => {
    const admin = clienteDePrueba()
    if (contactosCreados.length) await admin.from('crm_contactos').delete().in('id', contactosCreados)
    if (huespedesCreados.length) await admin.from('huespedes').delete().in('id', huespedesCreados)
  })

  it('el primer mensaje crea contacto, identidad y conversación; el segundo va a la misma', async () => {
    const a = await entrante({ contacto: `wa-${sufijo}-1`, mensaje: `m-${sufijo}-1`, nombre: 'Ana' })
    expect(a).toMatchObject({ nueva: true, duplicado: false })
    const b = await entrante({ contacto: `wa-${sufijo}-1`, mensaje: `m-${sufijo}-2` })
    expect(b).toMatchObject({ nueva: false, conversacion_id: a.conversacion_id })
  })

  it('el mismo mensaje dos veces (Meta reintenta) es un no-op', async () => {
    const a = await entrante({ contacto: `wa-${sufijo}-2`, mensaje: `m-${sufijo}-dup` })
    const b = await entrante({ contacto: `wa-${sufijo}-2`, mensaje: `m-${sufijo}-dup` })
    expect(b.duplicado).toBe(true)
    const { count } = await clienteDePrueba()
      .from('crm_mensajes')
      .select('*', { count: 'exact', head: true })
      .eq('conversacion_id', a.conversacion_id as string)
    expect(count).toBe(1)
  })

  it('dos mensajes simultáneos del mismo huésped no parten la conversación en dos', async () => {
    const contacto = `wa-${sufijo}-carrera`
    const [a, b] = await Promise.all([
      entrante({ contacto, mensaje: `m-${sufijo}-c1` }),
      entrante({ contacto, mensaje: `m-${sufijo}-c2` }),
    ])
    expect(a.conversacion_id).toBe(b.conversacion_id)
  })

  it('el trigger: suma no leídos, marca la espera; una respuesta la limpia', async () => {
    const a = await entrante({ contacto: `wa-${sufijo}-3`, mensaje: `m-${sufijo}-3a` })
    await entrante({ contacto: `wa-${sufijo}-3`, mensaje: `m-${sufijo}-3b` })
    let c = await conversacion(a.conversacion_id as string)
    expect(c.no_leidos).toBe(2)
    expect(c.esperando_desde).not.toBeNull()
    expect(c.ultimo_entrante_en).not.toBeNull()

    await entrante({ contacto: `wa-${sufijo}-3`, mensaje: `m-${sufijo}-3c`, tipo: 'saliente' })
    c = await conversacion(a.conversacion_id as string)
    expect(c.esperando_desde).toBeNull()
    expect(c.primera_respuesta_en).not.toBeNull()
  })

  it('un mensaje nuevo reabre una resuelta reciente; una resuelta vieja abre otra conversación', async () => {
    const contacto = `wa-${sufijo}-4`
    const a = await entrante({ contacto, mensaje: `m-${sufijo}-4a` })
    const admin = clienteDePrueba()
    await admin.from('crm_conversaciones').update({ estado: 'resuelta' }).eq('id', a.conversacion_id as string)

    const b = await entrante({ contacto, mensaje: `m-${sufijo}-4b` })
    expect(b.conversacion_id).toBe(a.conversacion_id)
    expect((await conversacion(a.conversacion_id as string)).estado).toBe('abierta')

    // Resuelta hace 10 días: el huésped habla de otra cosa.
    await admin
      .from('crm_conversaciones')
      .update({ estado: 'resuelta', ultima_actividad_en: new Date(Date.now() - 10 * 86_400_000).toISOString() })
      .eq('id', a.conversacion_id as string)
    const c = await entrante({ contacto, mensaje: `m-${sufijo}-4c` })
    expect(c.nueva).toBe(true)
    expect(c.conversacion_id).not.toBe(a.conversacion_id)
  })

  it('una pospuesta se reabre sola si el huésped escribe', async () => {
    const contacto = `wa-${sufijo}-5`
    const a = await entrante({ contacto, mensaje: `m-${sufijo}-5a` })
    await clienteDePrueba()
      .from('crm_conversaciones')
      .update({ estado: 'pospuesta', pospuesta_hasta: new Date(Date.now() + 86_400_000).toISOString() })
      .eq('id', a.conversacion_id as string)
    await entrante({ contacto, mensaje: `m-${sufijo}-5b` })
    const c = await conversacion(a.conversacion_id as string)
    expect(c.estado).toBe('abierta')
    expect(c.pospuesta_hasta).toBeNull()
  })

  it('vincula al huésped por los últimos 10 dígitos del teléfono, sólo si es único', async () => {
    const admin = clienteDePrueba()
    const digitos = `29${String(Date.now()).slice(-8)}`
    const { data: h, error } = await admin
      .from('huespedes')
      .insert({ nombre: 'Tel', apellido: `Bandeja${sufijo}`, telefono: `(${digitos.slice(0, 4)}) ${digitos.slice(4)}` })
      .select('id')
      .single<{ id: string }>()
    if (error) throw new Error(error.message)
    huespedesCreados.push(h.id)

    const r = await entrante({ contacto: `549${digitos}`, mensaje: `m-${sufijo}-6`, telefono: `+549${digitos}` })
    const { data: contacto } = await admin.from('crm_contactos').select('huesped_id').eq('id', r.contacto_id as string).single()
    expect(contacto?.huesped_id).toBe(h.id)
  })

  it('el mismo email por otro canal suma la identidad al MISMO contacto (0126)', async () => {
    const email = `uno.${sufijo}@ejemplo.com`
    const web = await entrante({ canal: 'web', contacto: `tok-${sufijo}`, mensaje: `m-${sufijo}-7a`, email, nombre: 'Uno' })
    const mail = await entrante({ canal: 'email', contacto: email, mensaje: `<m-${sufijo}-7b@x>`, email })
    expect(mail.contacto_id).toBe(web.contacto_id)
    expect(mail.conversacion_id).not.toBe(web.conversacion_id)
  })

  it('un contacto bloqueado: el mensaje no entra', async () => {
    const a = await entrante({ contacto: `wa-${sufijo}-8`, mensaje: `m-${sufijo}-8a` })
    await clienteDePrueba().from('crm_contactos').update({ bloqueado: true }).eq('id', a.contacto_id as string)
    const b = await entrante({ contacto: `wa-${sufijo}-8`, mensaje: `m-${sufijo}-8b` })
    expect(b.ignorado).toBe('contacto_bloqueado')
  })

  it('una bandeja apagada no acepta entradas', async () => {
    const admin = clienteDePrueba()
    await admin.from('crm_bandejas').update({ activa: false }).eq('canal', 'telegram')
    try {
      const r = await entrante({ canal: 'telegram', contacto: `tg-${sufijo}`, mensaje: `tg:${sufijo}:1` })
      expect(r.ignorado).toBe('bandeja_inactiva')
    } finally {
      await admin.from('crm_bandejas').update({ activa: true }).eq('canal', 'telegram')
    }
  })

  it('rechaza un tipo inválido o un contacto vacío', async () => {
    await expect(entrante({ contacto: `x-${sufijo}`, mensaje: null, tipo: 'nota' as never })).rejects.toThrow(/tipo/)
    await expect(entrante({ contacto: '  ', mensaje: null })).rejects.toThrow(/contacto/)
  })
})

describe.skipIf(!hayDB || !hayRoles)('bandeja · RLS por rol', () => {
  let recepcion: UsuarioDePrueba
  let housekeeping: UsuarioDePrueba
  let conversacionId: string

  beforeAll(async () => {
    recepcion = await crearUsuarioConRol('recepcion', `${sufijo}b`)
    housekeeping = await crearUsuarioConRol('housekeeping', `${sufijo}b`)
    const r = await entrante({ contacto: `wa-${sufijo}-rls`, mensaje: `m-${sufijo}-rls`, texto: 'dato personal' })
    conversacionId = r.conversacion_id as string
  }, 60_000)

  afterAll(async () => {
    await limpiarUsuarios()
  })

  it('recepción lee la conversación y sus mensajes; housekeeping no', async () => {
    const { data: r } = await recepcion.cliente.from('crm_mensajes').select('id').eq('conversacion_id', conversacionId)
    expect(r?.length).toBeGreaterThan(0)
    const { data: h } = await housekeeping.cliente.from('crm_mensajes').select('id').eq('conversacion_id', conversacionId)
    expect(h).toEqual([])
    const { data: hc } = await housekeeping.cliente.from('crm_contactos').select('id')
    expect(hc).toEqual([])
  })

  it('recepción responde a su nombre; no puede escribir como otro ni inventar un entrante', async () => {
    const propio = await recepcion.cliente
      .from('crm_mensajes')
      .insert({ conversacion_id: conversacionId, tipo: 'saliente', contenido: 'ok', autor_id: recepcion.id, estado: 'pendiente' })
    expect(propio.error).toBeNull()

    const ajeno = await recepcion.cliente
      .from('crm_mensajes')
      .insert({ conversacion_id: conversacionId, tipo: 'saliente', contenido: 'x', autor_id: housekeeping.id })
    expect(ajeno.error).not.toBeNull()

    const inventado = await recepcion.cliente
      .from('crm_mensajes')
      .insert({ conversacion_id: conversacionId, tipo: 'entrante', contenido: 'x', autor_id: recepcion.id })
    expect(inventado.error).not.toBeNull()
  })

  it('housekeeping no puede escribir ni cambiar el estado', async () => {
    const ins = await housekeeping.cliente
      .from('crm_mensajes')
      .insert({ conversacion_id: conversacionId, tipo: 'nota', contenido: 'x', autor_id: housekeeping.id })
    expect(ins.error).not.toBeNull()

    const { data } = await housekeeping.cliente
      .from('crm_conversaciones')
      .update({ estado: 'resuelta' })
      .eq('id', conversacionId)
      .select('id')
    expect(data ?? []).toEqual([])
  })

  it('recepción no gestiona respuestas guardadas (es de la dirección)', async () => {
    const { error } = await recepcion.cliente.from('crm_respuestas').insert({ atajo: `r${sufijo}`.slice(0, 20).toLowerCase(), contenido: 'x' })
    expect(error).not.toBeNull()
  })

  it('el staff no puede llamar a la función de entrada (es sólo de los webhooks)', async () => {
    const { error } = await recepcion.cliente.rpc('crm_registrar_entrante', {
      p_canal: 'whatsapp',
      p_externo_contacto: 'x',
      p_nombre: null,
      p_email: null,
      p_telefono: null,
      p_externo_mensaje: null,
      p_contenido: 'x',
    })
    expect(error).not.toBeNull()
  })
})

describe.skipIf(!hayAnon)('bandeja · borde público', () => {
  it('anon no lee ni escribe nada de la bandeja', async () => {
    const anon = clienteAnonimo()
    for (const tabla of ['crm_contactos', 'crm_conversaciones', 'crm_mensajes', 'crm_respuestas']) {
      const { data } = await anon.from(tabla).select('*').limit(1)
      expect(data ?? []).toEqual([])
    }
    const { error } = await anon.from('crm_mensajes').insert({ conversacion_id: '00000000-0000-0000-0000-000000000000', tipo: 'entrante', contenido: 'x' })
    expect(error).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Migración 0127 (ADR 0044): mensajes automáticos, resolución, asignación.
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hayDB)('bandeja · lo automático no es una respuesta, y la resolución queda anotada (0127)', () => {
  const admin = clienteDePrueba()

  afterAll(async () => {
    if (contactosCreados.length) await admin.from('crm_contactos').delete().in('id', contactosCreados)
  })

  it('un saludo automático NO limpia la espera ni cuenta como primera respuesta; una persona sí', async () => {
    const a = await entrante({ contacto: `wa-${sufijo}-auto1`, mensaje: `m-${sufijo}-auto1` })
    const id = a.conversacion_id as string

    const { error } = await admin.from('crm_mensajes').insert({ conversacion_id: id, tipo: 'saliente', contenido: 'Hola, ya te respondemos', automatico: true })
    expect(error).toBeNull()
    let c = await conversacion(id)
    expect(c.esperando_desde).not.toBeNull() // el huésped SIGUE esperando a una persona
    expect(c.primera_respuesta_en).toBeNull()

    await admin.from('crm_mensajes').insert({ conversacion_id: id, tipo: 'saliente', contenido: 'Hola, soy Laura' })
    c = await conversacion(id)
    expect(c.esperando_desde).toBeNull()
    expect(c.primera_respuesta_en).not.toBeNull()
  })

  it('un eco (lo escribió una persona desde el teléfono) SÍ cuenta como respuesta', async () => {
    const a = await entrante({ contacto: `wa-${sufijo}-eco`, mensaje: `m-${sufijo}-eco1` })
    await entrante({ contacto: `wa-${sufijo}-eco`, mensaje: `m-${sufijo}-eco2`, tipo: 'saliente' })
    expect((await conversacion(a.conversacion_id as string)).esperando_desde).toBeNull()
  })

  it('resuelta_en se anota al resolver y se borra al reabrir', async () => {
    const a = await entrante({ contacto: `wa-${sufijo}-res`, mensaje: `m-${sufijo}-res` })
    const id = a.conversacion_id as string
    expect((await conversacion(id)).resuelta_en).toBeNull()

    await admin.from('crm_conversaciones').update({ estado: 'resuelta' }).eq('id', id)
    expect((await conversacion(id)).resuelta_en).not.toBeNull()

    // Un mensaje nuevo la reabre sola (trigger de mensajes) y deja de figurar como resuelta.
    await entrante({ contacto: `wa-${sufijo}-res`, mensaje: `m-${sufijo}-res2` })
    const c = await conversacion(id)
    expect(c.estado).toBe('abierta')
    expect(c.resuelta_en).toBeNull()
  })

  it('«primera_vez» es del CONTACTO en la bandeja; «nueva» es de la conversación', async () => {
    const a = await entrante({ contacto: `wa-${sufijo}-pv`, mensaje: `m-${sufijo}-pv1` })
    expect(a).toMatchObject({ nueva: true, primera_vez: true })
    await admin.from('crm_conversaciones').update({ estado: 'resuelta', ultima_actividad_en: new Date(Date.now() - 10 * 86_400_000).toISOString() }).eq('id', a.conversacion_id as string)
    const b = await entrante({ contacto: `wa-${sufijo}-pv`, mensaje: `m-${sufijo}-pv2` })
    expect(b).toMatchObject({ nueva: true, primera_vez: false })
  })
})

describe.skipIf(!hayDB || !hayRoles)('bandeja · asignación automática (0127)', () => {
  const admin = clienteDePrueba()
  let u1: UsuarioDePrueba
  let u2: UsuarioDePrueba

  beforeAll(async () => {
    u1 = await crearUsuarioConRol('recepcion', `${sufijo}x1`)
    u2 = await crearUsuarioConRol('recepcion', `${sufijo}x2`)
    await admin.from('crm_bandejas').update({ asignacion_automatica: true }).eq('canal', 'telegram')
  }, 60_000)

  afterAll(async () => {
    await admin.from('crm_bandejas').update({ asignacion_automatica: false }).eq('canal', 'telegram')
    if (contactosCreados.length) await admin.from('crm_contactos').delete().in('id', contactosCreados)
    await limpiarUsuarios()
  })

  it('reparte las conversaciones nuevas: la segunda va a quien tiene menos abiertas', async () => {
    const a = await entrante({ canal: 'telegram', contacto: `tg-${sufijo}-1`, mensaje: `tg:${sufijo}:a1` })
    const b = await entrante({ canal: 'telegram', contacto: `tg-${sufijo}-2`, mensaje: `tg:${sufijo}:a2` })
    const ca = await conversacion(a.conversacion_id as string)
    const cb = await conversacion(b.conversacion_id as string)
    const equipo = [u1.id, u2.id]
    expect(equipo).toContain(ca.asignada_a)
    expect(equipo).toContain(cb.asignada_a)
    expect(ca.asignada_a).not.toBe(cb.asignada_a)
  })

  it('un mensaje de la MISMA conversación no la reasigna', async () => {
    const a = await entrante({ canal: 'telegram', contacto: `tg-${sufijo}-3`, mensaje: `tg:${sufijo}:b1` })
    const antes = (await conversacion(a.conversacion_id as string)).asignada_a
    await entrante({ canal: 'telegram', contacto: `tg-${sufijo}-3`, mensaje: `tg:${sufijo}:b2` })
    expect((await conversacion(a.conversacion_id as string)).asignada_a).toBe(antes)
  })

  it('un eco (el hotel escribió primero) no se asigna solo', async () => {
    const a = await entrante({ canal: 'telegram', contacto: `tg-${sufijo}-4`, mensaje: `tg:${sufijo}:c1`, tipo: 'saliente' })
    expect((await conversacion(a.conversacion_id as string)).asignada_a).toBeNull()
  })

  it('sólo recepción atiende: admin y housekeeping no reciben conversaciones', async () => {
    // El admin del seed existe y está activo: nunca debe ser elegido.
    const a = await entrante({ canal: 'telegram', contacto: `tg-${sufijo}-5`, mensaje: `tg:${sufijo}:d1` })
    const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', (await conversacion(a.conversacion_id as string)).asignada_a as string).single()
    expect(perfil?.rol).toBe('recepcion')
  })
})

describe.skipIf(!hayDB || !hayRoles)('bandeja · los ajustes del canal son de la dirección (0127)', () => {
  let recepcion: UsuarioDePrueba
  let gerencia: UsuarioDePrueba

  beforeAll(async () => {
    recepcion = await crearUsuarioConRol('recepcion', `${sufijo}aj`)
    gerencia = await crearUsuarioConRol('gerencia', `${sufijo}aj`)
  }, 60_000)

  afterAll(async () => {
    await clienteDePrueba().from('crm_bandejas').update({ saludo_activo: false }).eq('canal', 'web')
    await limpiarUsuarios()
  })

  it('recepción NO puede encender el saludo (ni cambiar nada de una bandeja); gerencia sí', async () => {
    const intento = await recepcion.cliente.from('crm_bandejas').update({ saludo_activo: true }).eq('canal', 'web').select('canal')
    expect(intento.data ?? []).toEqual([]) // RLS: cero filas, sin error

    const ok = await gerencia.cliente.from('crm_bandejas').update({ saludo_activo: true }).eq('canal', 'web').select('canal')
    expect(ok.data).toHaveLength(1)
  })

  it('la base rechaza días de atención inválidos y mensajes de más de 1000 caracteres', async () => {
    const admin = clienteDePrueba()
    const dias = await admin.from('crm_bandejas').update({ dias_atencion: [0, 8] }).eq('canal', 'web')
    expect(dias.error).not.toBeNull()
    const largo = await admin.from('crm_bandejas').update({ saludo_mensaje: 'x'.repeat(1001) }).eq('canal', 'web')
    expect(largo.error).not.toBeNull()
  })
})
