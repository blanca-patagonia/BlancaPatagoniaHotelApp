import { describe, it, expect, afterAll } from 'vitest'
import { clienteDePrueba, hayDB, sufijoUnico } from './db'

/**
 * Quién puede abrir el portal del socio.
 *
 * ── El agujero que cierra ───────────────────────────────────────────────────
 *
 * `app/portal/[token]/page.tsx` resolvía el socio **solo por token**. Dos
 * consecuencias, las dos verificadas leyendo el código antes de arreglarlo:
 *
 *  · Dar de baja una agencia **no le cerraba el portal**: seguía viendo su cuenta
 *    corriente, sus contratos y el enlace para firmarlos.
 *  · Un enlace filtrado servía para siempre. No había forma de invalidarlo.
 *
 * La consulta ahora exige `activo = true` y `token_revocado_en is null`
 * (migración 0063). Estos tests reproducen las condiciones contra la base, que es
 * donde vive la garantía.
 */
describe.skipIf(!hayDB)('acceso al portal del socio', () => {
  const admin = clienteDePrueba()
  const marca = `PORTAL-${sufijoUnico()}`

  afterAll(async () => {
    await admin.from('agencias').delete().like('nombre', `${marca}%`)
  })

  /** Crea una agencia y devuelve su id y su token. */
  async function agencia(extra: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from('agencias')
      .insert({ nombre: `${marca}-${Math.random()}`, tipo: 'agencia', ...extra })
      .select('id, token')
      .single()
    if (error) throw new Error(`no se pudo crear la agencia: ${error.message}`)
    return data as { id: string; token: string }
  }

  /** La misma consulta que hace el portal. */
  async function abrePortal(token: string): Promise<boolean> {
    const { data } = await admin
      .from('agencias')
      .select('id')
      .eq('token', token)
      .eq('activo', true)
      .is('token_revocado_en', null)
      .maybeSingle()
    return Boolean(data)
  }

  it('una agencia activa con su enlace vigente entra', async () => {
    const a = await agencia()
    expect(await abrePortal(a.token)).toBe(true)
  })

  it('dar de baja la agencia le CIERRA el portal', async () => {
    // Era el caso concreto del hallazgo: la baja no tenía ningún efecto acá.
    const a = await agencia()
    expect(await abrePortal(a.token)).toBe(true)

    await admin.from('agencias').update({ activo: false }).eq('id', a.id)
    expect(await abrePortal(a.token), 'una agencia dada de baja sigue entrando').toBe(false)
  })

  it('dar de baja el enlace corta el acceso sin tocar la cuenta', async () => {
    // Para cuando se corta la relación pero la cuenta sigue abierta por saldos.
    const a = await agencia()
    await admin
      .from('agencias')
      .update({ token_revocado_en: new Date().toISOString() })
      .eq('id', a.id)

    expect(await abrePortal(a.token)).toBe(false)

    const { data } = await admin.from('agencias').select('activo').eq('id', a.id).single()
    expect((data as { activo: boolean }).activo, 'la cuenta no debía darse de baja').toBe(true)
  })

  it('regenerar el enlace mata el anterior en el mismo momento', async () => {
    const a = await agencia()
    const tokenViejo = a.token

    await admin
      .from('agencias')
      .update({ token: crypto.randomUUID(), token_revocado_en: null })
      .eq('id', a.id)

    const { data } = await admin.from('agencias').select('token').eq('id', a.id).single()
    const tokenNuevo = (data as { token: string }).token

    expect(tokenNuevo).not.toBe(tokenViejo)
    expect(await abrePortal(tokenViejo), 'el enlace viejo sigue abriendo').toBe(false)
    expect(await abrePortal(tokenNuevo)).toBe(true)
  })

  it('un token inventado no abre nada', async () => {
    expect(await abrePortal('00000000-0000-0000-0000-000000000000')).toBe(false)
  })
})
