import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hayDB, clienteDePrueba, sufijoUnico } from '../apoyo/db'
import { procesarInterpretacion } from '@/lib/bandeja/entrante'
import type { EntranteNormalizado } from '@/lib/domain/bandeja-entrante'

/**
 * El saludo y el aviso de fuera de horario, de punta a punta (ADR 0044): un
 * mensaje entra por el MISMO servicio que usan los webhooks y se mira qué quedó
 * en la base.
 *
 * Se usa el canal `web` porque no necesita red: responder es guardar el mensaje.
 * Lo que cambia entre canales es sólo el envío (`enviarPorCanal`), que tiene sus
 * propios tests; lo que se prueba acá es la decisión de QUÉ mandar y CUÁNDO.
 */

const sufijo = sufijoUnico()
const contactos: string[] = []

function entrante(token: string, nombre: string, texto = 'Hola'): { mensajes: EntranteNormalizado[]; estados: never[] } {
  return {
    mensajes: [
      {
        canal: 'web',
        externoContacto: token,
        nombre,
        externoMensaje: `web:${sufijo}:${token}:${texto}:${Math.random()}`,
        contenido: texto,
        adjuntos: [],
        creadoEn: new Date().toISOString(),
        tipo: 'entrante',
      },
    ],
    estados: [],
  }
}

async function hilo(conversacionId: string) {
  const { data, error } = await clienteDePrueba()
    .from('crm_mensajes')
    .select('tipo, contenido, automatico')
    .eq('conversacion_id', conversacionId)
    .order('creado_en')
  if (error) throw new Error(error.message)
  return data as { tipo: string; contenido: string; automatico: boolean }[]
}

describe.skipIf(!hayDB)('bandeja · mensajes automáticos de punta a punta', () => {
  const admin = clienteDePrueba()

  async function configurar(c: Record<string, unknown>) {
    const { error } = await admin.from('crm_bandejas').update(c).eq('canal', 'web')
    if (error) throw new Error(error.message)
  }

  beforeAll(async () => {
    await configurar({
      saludo_activo: true,
      saludo_mensaje: 'Hola {{nombre}}, gracias por escribir.',
      fuera_horario_activo: false,
      fuera_horario_mensaje: 'Ahora estamos fuera de horario.',
      horario_desde: '00:00',
      horario_hasta: '23:59',
      dias_atencion: [1, 2, 3, 4, 5, 6, 7],
    })
  })

  afterAll(async () => {
    await configurar({ saludo_activo: false, fuera_horario_activo: false })
    if (contactos.length) await admin.from('crm_contactos').delete().in('id', contactos)
  })

  async function conversacionDe(token: string) {
    const { data: ident } = await admin.from('crm_identidades').select('contacto_id, id').eq('externo_id', token).single()
    contactos.push(ident!.contacto_id as string)
    const { data } = await admin.from('crm_conversaciones').select('id, esperando_desde, primera_respuesta_en').eq('identidad_id', ident!.id).single()
    return data as { id: string; esperando_desde: string | null; primera_respuesta_en: string | null }
  }

  it('saluda por el primer nombre, una sola vez, y el huésped sigue figurando como «esperando»', async () => {
    const token = `tok-${sufijo}-1`
    const r = await procesarInterpretacion(entrante(token, 'Ana López'))
    expect(r.guardados).toBe(1)

    const c = await conversacionDe(token)
    const mensajes = await hilo(c.id)
    expect(mensajes.map((m) => [m.tipo, m.automatico])).toEqual([['entrante', false], ['saliente', true]])
    expect(mensajes[1].contenido).toBe('Hola Ana, gracias por escribir.')
    expect(c.esperando_desde).not.toBeNull()
    expect(c.primera_respuesta_en).toBeNull()

    // Diez mensajes seguidos del mismo huésped reciben UN saludo.
    await procesarInterpretacion(entrante(token, 'Ana López', 'segundo'))
    await procesarInterpretacion(entrante(token, 'Ana López', 'tercero'))
    expect((await hilo(c.id)).filter((m) => m.automatico)).toHaveLength(1)
  })

  it('sin nombre conocido el saludo sale sin hueco: «Hola, gracias…»', async () => {
    const token = `tok-${sufijo}-2`
    await procesarInterpretacion(entrante(token, ''))
    const c = await conversacionDe(token)
    expect((await hilo(c.id))[1].contenido).toBe('Hola, gracias por escribir.')
  })

  it('fuera de horario sale ese mensaje y NO el saludo', async () => {
    await configurar({ fuera_horario_activo: true, dias_atencion: [] }) // sin días de atención: siempre fuera
    const token = `tok-${sufijo}-3`
    await procesarInterpretacion(entrante(token, 'Luis'))
    const c = await conversacionDe(token)
    const auto = (await hilo(c.id)).filter((m) => m.automatico)
    expect(auto.map((m) => m.contenido)).toEqual(['Ahora estamos fuera de horario.'])
    await configurar({ fuera_horario_activo: false, dias_atencion: [1, 2, 3, 4, 5, 6, 7] })
  })

  it('con todo apagado no se manda nada', async () => {
    await configurar({ saludo_activo: false })
    const token = `tok-${sufijo}-4`
    await procesarInterpretacion(entrante(token, 'Eva'))
    const c = await conversacionDe(token)
    expect((await hilo(c.id)).filter((m) => m.automatico)).toHaveLength(0)
    await configurar({ saludo_activo: true })
  })

  it('un contacto bloqueado no recibe nada', async () => {
    const token = `tok-${sufijo}-5`
    await procesarInterpretacion(entrante(token, 'Spam'))
    const { data: ident } = await admin.from('crm_identidades').select('contacto_id').eq('externo_id', token).single()
    contactos.push(ident!.contacto_id as string)
    await admin.from('crm_contactos').update({ bloqueado: true }).eq('id', ident!.contacto_id as string)
    const r = await procesarInterpretacion(entrante(token, 'Spam', 'otro'))
    expect(r.ignorados).toBe(1)
  })
})
