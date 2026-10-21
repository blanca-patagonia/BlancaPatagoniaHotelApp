import 'server-only'
import { permitirIntento } from '@/lib/limites'
import { registrarError, registrarErrorSync } from '@/lib/registro'

/**
 * Registra el rechazo de la firma de un webhook de pago, con tope por origen.
 *
 * Las primeras de cada IP (ver `registro_firma_rechazada` en
 * `lib/domain/limites.ts`) van a la tabla `errores` y se ven en
 * `/panel/errores`; las siguientes sólo al log del servidor, marcadas como
 * agrupadas. Así un ataque con firmas falsas no entierra la señal útil.
 *
 * Fuera de un pedido HTTP (los tests llaman a la verificación directo) no hay
 * IP que contar: se registra normalmente.
 */
export async function registrarFirmaRechazada(
  evento: string,
  datos: Record<string, unknown>,
): Promise<void> {
  let persistir = true
  try {
    persistir = await permitirIntento('registro_firma_rechazada')
  } catch {
    persistir = true
  }
  if (persistir) await registrarError(evento, datos)
  else registrarErrorSync(evento, { ...datos, agrupado: true })
}
