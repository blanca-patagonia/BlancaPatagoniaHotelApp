import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Rol } from '@/lib/domain/roles'

/**
 * Las guardas de sesión: `requerirSesion`, `requerirAcceso` y `requerirRol`.
 *
 * ── El hueco que este archivo cierra ────────────────────────────────────────
 *
 * El proyecto tenía las dos mitades y le faltaba el medio:
 *
 * · `tests/permisos.test.ts` prueba `puedeAcceder(rol, area)` — la **regla**.
 * · `tests/autorizacion-acciones.test.ts` prueba que las 51 Server Actions
 *   **llaman** a una guarda (análisis estático).
 * · Nadie probaba que la guarda **rechace de verdad**.
 *
 * Y el hueco importa: los 29 tests de Server Actions reemplazan `requerirAcceso`
 * por un no-op que devuelve un admin fijo (`tests/acciones/entorno.ts`), así que
 * ejercitan todo menos la puerta. Si `requerirAcceso` dejara de redirigir, la
 * suite entera seguiría en verde.
 *
 * Acá se prueba la puerta, que es el mecanismo del que dependen las 51.
 */

/** `redirect` de Next lanza; se replica para poder afirmar a dónde manda. */
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

/** Sesión que devolverá el cliente falso. Cada test la fija. */
let perfilActual: { id: string; nombre: string; rol: string; activo: boolean } | null = null
let usuarioActual: { id: string; email: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  crearClienteServidor: async () => ({
    auth: { getUser: async () => ({ data: { user: usuarioActual } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: perfilActual }) }),
      }),
    }),
  }),
}))

const { requerirSesion, requerirAcceso, requerirRol, obtenerSesion } = await import(
  '@/lib/auth/session'
)

/** Deja la sesión en el rol pedido. `null` = sin sesión. */
function comoRol(rol: Rol | null, { activo = true }: { activo?: boolean } = {}) {
  if (!rol) {
    usuarioActual = null
    perfilActual = null
    return
  }
  usuarioActual = { id: 'u-1', email: 'x@blancapatagonia.local' }
  perfilActual = { id: 'u-1', nombre: 'Prueba', rol, activo }
}

/** Corre `fn` y devuelve a dónde redirigió, o `null` si no redirigió. */
async function destinoDe(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message)
    if (m) return m[1]
    throw e
  }
}

describe('requerirSesion', () => {
  beforeEach(() => comoRol(null))

  it('sin sesión manda al login', async () => {
    expect(await destinoDe(() => requerirSesion())).toBe('/login')
  })

  it('con sesión válida devuelve el perfil y NO redirige', async () => {
    comoRol('recepcion')
    expect(await destinoDe(() => requerirSesion())).toBeNull()
    const s = await requerirSesion()
    expect(s.rol).toBe('recepcion')
  })

  it('un usuario DADO DE BAJA no tiene sesión, aunque su login siga siendo válido', async () => {
    // Es la garantía de la migración 0033: echar a alguien tiene que quitarle el
    // acceso en el momento, no cuando venza su token.
    comoRol('admin', { activo: false })
    expect(await destinoDe(() => requerirSesion())).toBe('/login')
  })

  it('un rol que no existe en el sistema no vale como sesión', async () => {
    // Defensa contra un valor escrito a mano en la base.
    usuarioActual = { id: 'u-1', email: 'x@y.local' }
    perfilActual = { id: 'u-1', nombre: 'X', rol: 'superusuario', activo: true }
    expect(await destinoDe(() => requerirSesion())).toBe('/login')
  })
})

describe('requerirAcceso · la puerta de la que dependen las 51 Server Actions', () => {
  it('housekeeping NO entra a reservas', async () => {
    comoRol('housekeeping')
    expect(await destinoDe(() => requerirAcceso('reservas'))).toBe('/panel')
  })

  it('recepción SÍ entra a reservas', async () => {
    comoRol('recepcion')
    expect(await destinoDe(() => requerirAcceso('reservas'))).toBeNull()
  })

  it('recepción NO entra a proveedores', async () => {
    comoRol('recepcion')
    expect(await destinoDe(() => requerirAcceso('proveedores'))).toBe('/panel')
  })

  it('admin entra a todo', async () => {
    comoRol('admin')
    for (const area of ['reservas', 'proveedores', 'config', 'usuarios', 'respaldos'] as const) {
      expect(await destinoDe(() => requerirAcceso(area)), `admin no entró a ${area}`).toBeNull()
    }
  })

  it('sin sesión, redirige al login y no al panel', async () => {
    // El orden importa: mandar al panel a alguien sin sesión lo dejaría en un
    // rebote entre dos pantallas.
    comoRol(null)
    expect(await destinoDe(() => requerirAcceso('reservas'))).toBe('/login')
  })

  it('un área APAGADA no la abre nadie, ni el admin', async () => {
    // `AREAS_OCULTAS` en permisos.ts. Si esto dejara de valer, tres módulos
    // apagados por decisión del hotel volverían a estar accesibles por URL.
    comoRol('admin')
    expect(await destinoDe(() => requerirAcceso('auditoria'))).toBe('/panel')
  })
})

describe('requerirRol · la restricción más estrecha que el área', () => {
  it('deja pasar a los roles indicados', async () => {
    for (const rol of ['admin', 'gerencia'] as const) {
      comoRol(rol)
      expect(await destinoDe(() => requerirRol('admin', 'gerencia'))).toBeNull()
    }
  })

  it('rechaza a un rol que SÍ tiene el área pero no la acción', async () => {
    /*
      Es el caso que justifica que esta guarda exista: recepción tiene el área
      `agencias` —necesita la lista para vincular una reserva a un convenio— pero
      no debe mover plata en la cuenta corriente de un socio.
    */
    comoRol('recepcion')
    expect(await destinoDe(() => requerirRol('admin', 'gerencia'))).toBe('/panel')
  })

  it('housekeeping tampoco pasa, aunque tenga el área de mantenimiento', async () => {
    comoRol('housekeeping')
    expect(await destinoDe(() => requerirRol('admin', 'gerencia'))).toBe('/panel')
  })

  it('sin sesión manda al login, no al panel', async () => {
    comoRol(null)
    expect(await destinoDe(() => requerirRol('admin'))).toBe('/login')
  })
})

describe('obtenerSesion', () => {
  it('devuelve null sin sesión, en vez de redirigir', async () => {
    // La versión que NO corta: la usan las pantallas que muestran algo distinto
    // según haya o no sesión, y el endpoint de salud.
    comoRol(null)
    expect(await obtenerSesion()).toBeNull()
  })

  it('cae al email cuando el perfil no tiene nombre cargado', async () => {
    usuarioActual = { id: 'u-1', email: 'sin.nombre@blancapatagonia.local' }
    perfilActual = { id: 'u-1', nombre: '', rol: 'recepcion', activo: true }
    const s = await obtenerSesion()
    expect(s?.nombre).toBe('sin.nombre@blancapatagonia.local')
  })
})
