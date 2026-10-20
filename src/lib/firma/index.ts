import 'server-only'

/**
 * Abstracción de proveedores de firma electrónica (`FirmaElectronicaProvider`).
 *
 * Mismo patrón que `PaymentProvider` (ver `lib/payments/index.ts`): el sistema
 * opera con un proveedor **local** que registra la aceptación del firmante con
 * trazabilidad (hash del texto, IP, fecha), y deja lista la integración con un
 * servicio real (DocuSign, Odoo Sign, firma digital de AFIP) sin tocar el resto
 * del sistema.
 *
 * ⚠️ Limitación académica, documentada en el ADR 0010: lo que produce el
 * proveedor local **no es una firma digital con validez legal**. No hay
 * certificado, ni autoridad certificante, ni sellado de tiempo de un tercero de
 * confianza. Es una constancia de aceptación verificable.
 */

import { seleccionarProveedor } from '@/lib/integraciones/seleccion'

export interface SolicitudFirma {
  contratoId: string
  /** Token opaco que genera la base y viaja en la URL pública. */
  token: string
  titulo: string
}

export interface InvitacionFirma {
  /** URL que se le envía al firmante. */
  url: string
  /** Identificador en el proveedor externo (en el local, el propio token). */
  externalId: string
}

/** Datos de contexto que quedan registrados al aceptar. */
export interface ContextoFirma {
  ip: string | null
  userAgent: string | null
}

export interface ConstanciaFirma {
  hashDocumento: string
  fecha: Date
  ip: string | null
  userAgent: string | null
}

export interface FirmaElectronicaProvider {
  nombre: string
  /** Prepara la invitación a firmar y devuelve la URL para el firmante. */
  crearInvitacion(s: SolicitudFirma): Promise<InvitacionFirma>
  /** Huella del texto tal como se le mostró al firmante. */
  hashDocumento(contenido: string): Promise<string>
  /** Registra la aceptación, devolviendo la constancia que se persiste. */
  registrarFirma(contenido: string, ctx: ContextoFirma): Promise<ConstanciaFirma>
  /** Verifica que el texto actual siga coincidiendo con lo firmado. */
  verificarIntegridad(contenido: string, hash: string): Promise<boolean>
}

/**
 * Proveedor local (stub). No llama a ningún servicio externo, pero el hash es
 * real: SHA-256 con la Web Crypto API, de modo que si alguien edita el contrato
 * después de firmado la verificación falla y la manipulación queda en evidencia.
 */
class ProveedorLocal implements FirmaElectronicaProvider {
  nombre = 'local'

  async crearInvitacion(s: SolicitudFirma): Promise<InvitacionFirma> {
    return { url: `/firmar/${s.token}`, externalId: s.token }
  }

  async hashDocumento(contenido: string): Promise<string> {
    const datos = new TextEncoder().encode(contenido)
    const buffer = await crypto.subtle.digest('SHA-256', datos)
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  async registrarFirma(contenido: string, ctx: ContextoFirma): Promise<ConstanciaFirma> {
    return {
      hashDocumento: await this.hashDocumento(contenido),
      fecha: new Date(),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    }
  }

  async verificarIntegridad(contenido: string, hash: string): Promise<boolean> {
    return (await this.hashDocumento(contenido)) === hash
  }
}

const PROVEEDORES: Record<string, FirmaElectronicaProvider> = {
  local: new ProveedorLocal(),
}

/**
 * Proveedor vigente. Se resuelve por variable de entorno para que enchufar uno
 * real sea un cambio de configuración, no de código.
 */
export function obtenerProveedorFirma(
  nombre: string | undefined = process.env.FIRMA_PROVIDER,
): FirmaElectronicaProvider {
  // El proveedor local registra la aceptación pero, como documenta este módulo,
  // NO es una firma digital con validez legal. Usarlo en producción tiene que
  // ser una decisión declarada, no el resultado de una variable sin definir.
  return seleccionarProveedor({
    variable: 'FIRMA_PROVIDER',
    proveedores: PROVEEDORES,
    simulado: 'local',
    valor: nombre,
  })
}

/*
  `ipDePeticion` vivía acá y se borró.

  Tomaba el PRIMER valor de `x-forwarded-for`, que es el que **manda el cliente**:
  ese encabezado se acumula de izquierda a derecha y solo el último lo agregó un
  salto de confianza. `lib/limites.ts` ya había arreglado exactamente ese bug para
  el limitador de intentos, y esta copia se quedó con la versión vulnerable.

  No era cosmético. Alimentaba dos cosas:

    · el límite del asistente público, evadible rotando la cabecera;
    · la IP que se guarda en `firmas.ip` como constancia de quién firmó un
      contrato — o sea, un dato probatorio que elegía el propio firmante.

  Ahora hay **una sola** implementación: `ipDeCabeceras` de `lib/limites.ts`.
  Si hace falta la IP acá, se importa de ahí. No volver a duplicarla.
*/
