import type { SupabaseClient } from '@supabase/supabase-js'
import { clienteDePrueba, sufijoUnico } from '../db'

/**
 * Andamiaje para probar las **Server Actions**.
 *
 * Por qué existe: hasta acá la suite probaba `lib/domain` (lógica pura) y las
 * funciones SQL, pero nada verificaba la capa del medio —la que lee el
 * `FormData`, aplica las reglas y escribe—. Ese hueco dejó pasar tres veces el
 * mismo error: dominio construido y testeado que **ninguna pantalla llamaba**
 * (ver ADR 0015).
 *
 * Qué se falsea y qué no:
 * · Se falsea el borde de Next (`redirect`, `revalidatePath`) y la sesión, que
 *   dependen del contexto de una petición HTTP real.
 * · **NO** se falsea la base ni el dominio: las acciones escriben en Postgres de
 *   verdad y las reglas se ejecutan tal cual.
 *
 * ⚠️ Limitación: el cliente de prueba usa `service_role`, así que **RLS queda
 * fuera de estos tests**. Verifican la lógica de negocio, no los permisos; las
 * políticas se prueban aparte.
 */

/** Sesión que devuelven los mocks de `lib/auth/session`. */
export interface SesionFalsa {
  userId: string
  email: string
  nombre: string
  rol: 'admin' | 'gerencia' | 'recepcion' | 'housekeeping'
}

let sesion: SesionFalsa = {
  userId: '00000000-0000-0000-0000-000000000000',
  email: 'test@blancapatagonia.local',
  nombre: 'Test',
  rol: 'admin',
}

export function sesionActual(): SesionFalsa {
  return sesion
}

/** Cambia el rol o el usuario con el que corren las acciones siguientes. */
export function usarSesion(parcial: Partial<SesionFalsa>): void {
  sesion = { ...sesion, ...parcial }
}

/**
 * Ejecuta una acción y devuelve la URL a la que redirige.
 *
 * Las Server Actions terminan en `redirect()`, que **lanza**: sin esto cada
 * test tendría que envolver la llamada en su propio try/catch y el destino
 * —que es justamente lo que se quiere afirmar— quedaría enterrado.
 */
export async function destinoDe(accion: () => Promise<unknown>): Promise<string> {
  try {
    await accion()
    return ''
  } catch (e) {
    const mensaje = (e as Error).message ?? ''
    if (mensaje.startsWith('REDIRECT:')) return mensaje.slice('REDIRECT:'.length)
    throw e
  }
}

/** Arma el `FormData` que recibiría la acción desde un `<form>`. */
export function formulario(campos: Record<string, string | number>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, String(v))
  return fd
}

/* ─────────────────────────────────────────────────── datos de prueba ──── */

export interface Contexto {
  db: SupabaseClient
  sufijo: string
  /** Ids creados por el test, para borrarlos al final. */
  aBorrar: { tabla: string; id: string }[]
}

export function nuevoContexto(): Contexto {
  return { db: clienteDePrueba(), sufijo: sufijoUnico(), aBorrar: [] }
}

/** Crea un huésped mínimo y lo agenda para limpieza. */
export async function crearHuespedDePrueba(ctx: Contexto, extra: Record<string, unknown> = {}) {
  const { data } = await ctx.db
    .from('huespedes')
    .insert({
      apellido: `Test-${ctx.sufijo}`,
      nombre: 'Prueba',
      doc_numero: `TST${ctx.sufijo}`,
      ...extra,
    })
    .select('id')
    .single()

  const id = (data as { id: string }).id
  ctx.aBorrar.push({ tabla: 'huespedes', id })
  return id
}

/**
 * Borra lo creado en **orden inverso al de registro**.
 *
 * Por eso cada test registra primero el padre (huésped) y después el hijo
 * (reserva, factura): al invertir, se borra el hijo antes y no se choca con las
 * claves foráneas. La tabla de facturas referencia a la de reservas con
 * `on delete restrict`, así que el orden no es opcional.
 */
export async function limpiar(ctx: Contexto): Promise<void> {
  for (const { tabla, id } of [...ctx.aBorrar].reverse()) {
    await ctx.db.from(tabla).delete().eq('id', id)
  }
  ctx.aBorrar.length = 0
}
