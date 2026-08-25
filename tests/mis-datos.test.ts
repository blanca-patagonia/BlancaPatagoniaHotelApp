import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba } from './db'
import {
  validarMisDatos,
  LARGO_MAXIMO_NOMBRE,
  LARGO_MAXIMO_TELEFONO,
} from '@/lib/domain/cuenta'

/**
 * Cada uno edita sus datos, y SOLO sus datos (migración 0066).
 *
 * La parte que hay que blindar no es el formulario: es que la base rechace el
 * auto-ascenso. Quien quiera hacer trampa no usa la pantalla, arma la petición
 * contra PostgREST con la clave publicable, que viaja al navegador por diseño.
 */

describe('validarMisDatos', () => {
  it('exige el nombre: sin él, el rastro de auditoría queda en identificadores', () => {
    expect(validarMisDatos('', '')).toBeTruthy()
    expect(validarMisDatos('   ', '')).toBeTruthy()
  })

  it('acepta un nombre con el teléfono vacío: el teléfono es opcional', () => {
    expect(validarMisDatos('Ana Pérez', '')).toBeNull()
  })

  it('no acepta un nombre más largo que el máximo', () => {
    expect(validarMisDatos('x'.repeat(LARGO_MAXIMO_NOMBRE + 1), '')).toBeTruthy()
    expect(validarMisDatos('x'.repeat(LARGO_MAXIMO_NOMBRE), '')).toBeNull()
  })

  it('no acepta un teléfono más largo que el máximo', () => {
    expect(validarMisDatos('Ana', '9'.repeat(LARGO_MAXIMO_TELEFONO + 1))).toBeTruthy()
  })

  it('no valida el FORMATO del teléfono, a propósito', () => {
    // Un interno, un celular con característica y un número del exterior se
    // escriben distinto. Un patrón estricto logra que nadie lo cargue.
    for (const t of ['12', '2902 45-6789', '+54 9 2902 456789', 'int. 104']) {
      expect(validarMisDatos('Ana', t)).toBeNull()
    }
  })
})

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const hayAnon = Boolean(hayDB && anon)

/**
 * La prueba que de verdad importa: un usuario autenticado que NO es admin
 * intenta ascenderse, y la base lo rechaza.
 *
 * Se hace con el cliente publicable —el mismo que corre en el navegador— y no
 * con `service_role`, que saltea todo por diseño y no probaría nada.
 */
describe.skipIf(!hayAnon)('perfiles · nadie se asciende solo', () => {
  it('un usuario de recepción no puede cambiarse el rol ni el estado, pero sí su nombre', async () => {
    const admin = clienteDePrueba()
    const email = `prueba-ascenso-${Date.now()}@blancapatagonia.local`
    // Se genera al azar en cada corrida: una contraseña literal en el repositorio
    // queda en el historial de git para siempre, aunque sea de prueba.
    const password = randomUUID()

    const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    expect(errCrear).toBeNull()
    const id = creado!.user!.id

    await admin
      .from('perfiles')
      .upsert({ id, nombre: 'Prueba Ascenso', rol: 'recepcion', activo: true })

    try {
      // Entra como él, con el cliente del navegador.
      const suyo = createClient(url!, anon!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error: errLogin } = await suyo.auth.signInWithPassword({ email, password })
      expect(errLogin).toBeNull()

      // 1. El ascenso tiene que fallar.
      const { error: errAscenso } = await suyo
        .from('perfiles')
        .update({ rol: 'admin' })
        .eq('id', id)
      expect(errAscenso, 'la base dejó cambiar el rol: es un auto-ascenso').not.toBeNull()

      // 2. Y el rol quedó intacto, comprobado con la clave privilegiada.
      const { data: despues } = await admin.from('perfiles').select('rol').eq('id', id).single()
      expect(despues?.rol).toBe('recepcion')

      // 3. Tampoco puede tocar `activo`.
      const { error: errActivo } = await suyo
        .from('perfiles')
        .update({ activo: false })
        .eq('id', id)
      expect(errActivo, 'la base dejó cambiar `activo` con el cliente del usuario').not.toBeNull()

      // 4. Pero SÍ puede corregir lo suyo: es lo que la migración habilita.
      const { error: errNombre } = await suyo
        .from('perfiles')
        .update({ nombre: 'Nombre Corregido', telefono: 'int. 104' })
        .eq('id', id)
      expect(errNombre, 'no pudo cambiar su propio nombre, que es lo que habilita').toBeNull()

      const { data: final } = await admin
        .from('perfiles')
        .select('nombre, telefono, rol')
        .eq('id', id)
        .single()
      expect(final?.nombre).toBe('Nombre Corregido')
      expect(final?.telefono).toBe('int. 104')
      expect(final?.rol).toBe('recepcion')

      // 5. Y no puede tocar el perfil de OTRO, aunque solo mande el nombre.
      const { data: otros } = await admin
        .from('perfiles')
        .select('id, nombre')
        .neq('id', id)
        .limit(1)
      if (otros?.[0]) {
        await suyo.from('perfiles').update({ nombre: 'Intruso' }).eq('id', otros[0].id)
        const { data: ajeno } = await admin
          .from('perfiles')
          .select('nombre')
          .eq('id', otros[0].id)
          .single()
        expect(ajeno?.nombre, 'pudo editar el perfil de otra persona').toBe(otros[0].nombre)
      }
    } finally {
      await admin.from('perfiles').delete().eq('id', id)
      await admin.auth.admin.deleteUser(id)
    }
  })
})
