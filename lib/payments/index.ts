import 'server-only'

/**
 * Registro de pasarelas de pago.
 *
 * Qué cambió y por qué. Este módulo era un stub con dos instancias de la misma
 * clase y una función `obtenerProveedor(nombre)` que elegía por texto. Con eso,
 * pagos era **el único de los siete adaptadores del proyecto que quedaba fuera
 * del régimen del ADR 0018**: no existía `PAGO_PROVIDER`, así que en producción
 * el simulador se habría usado sin que nadie lo declarara y sin que nada fallara.
 * Para un adaptador que mueve plata, era el peor lugar donde tener esa fuga.
 *
 * Hoy hay dos preguntas distintas y dos funciones distintas:
 *
 * · **`proveedoresHabilitados()`** — «¿qué medios de pago ofrece el hotel?».
 *   Sale de `PAGO_PROVIDER` y es lo que ve el huésped. Puede haber varios
 *   (ver `seleccionarProveedores`).
 * · **`obtenerProveedor(nombre)`** — «¿quién sabe leer este webhook?». Lo usa
 *   `/api/webhooks/pagos/{proveedor}`, donde el nombre viene de la URL que la
 *   propia pasarela llama. Es correcto que acá se elija por nombre: no es una
 *   preferencia de configuración, es de quién llegó el mensaje.
 */

import {
  seleccionarProveedores,
  advertirSiEsSimulado,
} from '@/lib/integraciones/seleccion'
import { ProveedorSimulado, NOMBRE_SIMULADO } from './simulado'
import { ProveedorMercadoPago } from './mercadopago'
import { ProveedorStripe } from './stripe'
import type { PaymentProvider } from './tipos'

export * from './tipos'
export { NOMBRE_SIMULADO } from './simulado'
export { esMonedaDeCobro } from './simulado'

/**
 * Todas las implementaciones que existen, por nombre.
 *
 * Se instancian una sola vez: no guardan estado y leen las credenciales de
 * `process.env` en cada llamada, así que rotar una clave no obliga a reiniciar.
 */
const PROVEEDORES: Record<string, PaymentProvider> = {
  [NOMBRE_SIMULADO]: new ProveedorSimulado(),
  mercadopago: new ProveedorMercadoPago(),
  stripe: new ProveedorStripe(),
}

/**
 * El proveedor que sabe leer un webhook de `nombre`.
 *
 * Devuelve `null` si no existe, y el webhook responde 404. **No filtra por
 * `PAGO_PROVIDER` a propósito**: si el hotel deja de ofrecer una pasarela, los
 * cobros que ya estaban en curso con ella siguen avisando por días, y esos
 * eventos hay que registrarlos igual. Rechazarlos perdería plata ya cobrada.
 */
export function obtenerProveedor(nombre: string): PaymentProvider | null {
  return PROVEEDORES[nombre] ?? null
}

/**
 * Las pasarelas que el hotel tiene habilitadas, en el orden de `PAGO_PROVIDER`.
 *
 * En producción exige la variable; fuera de producción cae al simulador para
 * poder desarrollar y correr los tests sin credenciales (ADR 0018).
 */
export function proveedoresHabilitados(valor = process.env.PAGO_PROVIDER): PaymentProvider[] {
  const elegidos = seleccionarProveedores({
    variable: 'PAGO_PROVIDER',
    proveedores: PROVEEDORES,
    simulado: NOMBRE_SIMULADO,
    valor,
  })
  for (const p of elegidos) advertirSiEsSimulado(p, 'PAGO_PROVIDER')
  return elegidos
}

/**
 * ¿Está habilitada esta pasarela para cobrar?
 *
 * Se pregunta antes de crear un link: que el catálogo (`MEDIOS_DE_COBRO`)
 * mencione un medio no significa que el hotel lo haya contratado.
 */
export function estaHabilitado(nombre: string, valor = process.env.PAGO_PROVIDER): boolean {
  return proveedoresHabilitados(valor).some((p) => p.nombre === nombre || nombreClave(p) === nombre)
}

/**
 * El nombre con el que se elige a un proveedor en `PAGO_PROVIDER`.
 *
 * Hace falta porque el simulador **no se llama como su `medio`**: registra sus
 * pagos como `tarjeta` (el enum de la base no tiene un valor «simulado»), pero
 * en la configuración se lo nombra `simulado`. Sin esta traducción, buscarlo por
 * `p.nombre` no lo encuentra nunca.
 */
export function nombreClave(p: PaymentProvider): string {
  return p.esReal() ? p.nombre : NOMBRE_SIMULADO
}
