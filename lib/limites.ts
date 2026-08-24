import 'server-only'
import { headers } from 'next/headers'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { LIMITES, type AccionLimitada } from '@/lib/domain/limites'

/**
 * Aplicación del límite de intentos (capa de acceso).
 *
 * El conteo lo hace la base con `registrar_intento`, no la aplicación: tiene
 * que ser atómico. Si dos peticiones simultáneas leyeran el conteo y después
 * insertaran, ambas podrían pasar el techo.
 *
 * Se usa `service_role` porque la tabla `intentos_limitados` no tiene políticas
 * de lectura ni escritura a propósito: nadie debería poder consultar desde qué
 * IPs se intentó algo, ni borrar su propio rastro.
 */

/**
 * IP del visitante, tomada **solo** de encabezados que pone la plataforma.
 *
 * Antes se leía el primer valor de `x-forwarded-for`, y eso volvía inútil el
 * limitador: ese encabezado se acumula de izquierda a derecha, así que el primer
 * valor es el que **manda el cliente**, no el que agrega el proxy. Bastaba con
 * enviar `X-Forwarded-For: 1.2.3.4` y rotarlo en cada intento para tener fuerza
 * bruta ilimitada contra el login y contra el alta pública de reservas.
 *
 * El orden de preferencia va de más confiable a menos:
 *  1. `x-vercel-forwarded-for` — lo escribe Vercel y no es reenviable.
 *  2. `x-real-ip` — lo fija el proxy con un valor único, no una lista.
 *  3. `x-forwarded-for`, tomando el **último** valor: el que agregó el salto de
 *     confianza más cercano. Todo lo que está a su izquierda pudo inventarlo el
 *     cliente.
 *
 * Detrás de un proxy distinto habría que ajustar este orden. Es preferible eso
 * a un limitador que aparenta funcionar.
 */
export function ipDeCabeceras(cabeceras: Headers): string | null {
  const vercel = cabeceras.get('x-vercel-forwarded-for')?.trim()
  if (vercel) return vercel

  const real = cabeceras.get('x-real-ip')?.trim()
  if (real) return real

  const reenviada = cabeceras.get('x-forwarded-for')
  if (!reenviada) return null

  const saltos = reenviada
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return saltos.at(-1) ?? null
}

/**
 * La misma resolución, leyendo las cabeceras de la petición en curso.
 *
 * ⚠️ Es **la única** implementación de esto en el proyecto, y tiene que seguir
 * siéndolo. Antes había dos: ésta y `ipDePeticion` en `lib/firma/index.ts`, que
 * había quedado con el bug del primer `x-forwarded-for` que ésta arregló. La
 * copia vieja alimentaba el límite del asistente público —evadible rotando la
 * cabecera— y, peor, la IP que se guarda en `firmas.ip` como constancia de quién
 * firmó un contrato: un dato probatorio que elegía el propio firmante.
 */
async function ipActual(): Promise<string | null> {
  return ipDeCabeceras(await headers())
}

/**
 * Registra el intento y responde si **todavía está permitido**.
 *
 * Ante un fallo de la base devuelve `true` (deja pasar). Es una decisión
 * deliberada: el limitador protege contra abuso, pero si se rompe no debe
 * impedir que un huésped legítimo reserve. La alternativa —bloquear todo si el
 * contador falla— convierte un problema de infraestructura en una caída de
 * ventas.
 */
export async function permitirIntento(accion: AccionLimitada): Promise<boolean> {
  const ip = await ipActual()
  // Sin IP no hay a quién limitar. Se deja pasar, igual que hace la función SQL.
  if (!ip) return true

  const { maximo, minutos } = LIMITES[accion]

  try {
    const admin = crearClienteAdmin()
    const { data, error } = await admin.rpc('registrar_intento', {
      p_ip: ip,
      p_accion: accion,
      p_maximo: maximo,
      p_minutos: minutos,
    })
    if (error) return true
    return data !== false
  } catch {
    return true
  }
}
