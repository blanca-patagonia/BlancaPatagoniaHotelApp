import 'server-only'

/**
 * Los datos del hotel como **emisor** de comprobantes (migración 0082).
 *
 * Existen desde hoy porque el CUIT del hotel no estaba en ninguna tabla — suena
 * increíble en un sistema que emite facturas, y sin embargo era así: `facturas`
 * guarda el CUIT del *receptor*, y el emisor nunca hizo falta porque el CAE es
 * simulado.
 *
 * Lo bloqueaban dos cosas: WSFEv1 exige el CUIT del emisor en cada solicitud, y
 * la advertencia «esta factura no es para el hotel» al escanear un comprobante
 * recibido no tenía contra qué comparar.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CondicionIva } from '@/lib/domain/facturacion'

export interface DatosFiscales {
  razonSocial: string
  /** Sin guiones, 11 dígitos. */
  cuit: string
  condicionIva: CondicionIva
  domicilio: string
  inicioActividades: string | null
  ingresosBrutos: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Mismo motivo que en `lib/payments/servicio.ts`: los clientes del proyecto —el
   del usuario y el de `service_role`— tienen tipos generados distintos y esta
   función tiene que aceptar los dos. La factura se emite con el cliente del
   usuario (para que RLS y la auditoría vean quién lo hizo) y el adapter de ARCA
   correrá sin sesión. Unificarlos pediría un genérico que se propaga sin agregar
   seguridad real: la fila se valida igual en la base. */
type Cliente = SupabaseClient<any, any, any>

/**
 * Lee los datos fiscales. `null` cuando todavía no se cargaron.
 *
 * ⚠️ Devolver `null` y no un objeto con campos vacíos es deliberado: quien llama
 * tiene que **decidir** qué hacer sin CUIT, y con un objeto vacío la decisión se
 * toma sola y mal — se pediría un CAE a nombre de nadie, o la advertencia de
 * «esta factura no es para el hotel» compararía contra la cadena vacía y no
 * avisaría nunca.
 */
export async function datosFiscales(cliente: Cliente): Promise<DatosFiscales | null> {
  const { data } = await cliente
    .from('datos_fiscales')
    .select('razon_social, cuit, condicion_iva, domicilio, inicio_actividades, ingresos_brutos')
    .maybeSingle()

  const fila = data as {
    razon_social: string
    cuit: string
    condicion_iva: CondicionIva
    domicilio: string
    inicio_actividades: string | null
    ingresos_brutos: string | null
  } | null

  if (!fila) return null

  return {
    razonSocial: fila.razon_social,
    cuit: fila.cuit,
    condicionIva: fila.condicion_iva,
    domicilio: fila.domicilio,
    inicioActividades: fila.inicio_actividades,
    ingresosBrutos: fila.ingresos_brutos,
  }
}
