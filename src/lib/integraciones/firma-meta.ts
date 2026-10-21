import { comparacionConstante, hmacHex } from './firma-webhook'

/**
 * Firma de los webhooks de Meta (WhatsApp, Instagram, Messenger).
 *
 * Meta firma el cuerpo CRUDO con el secreto de la app y lo manda en
 * `X-Hub-Signature-256: sha256=<hex>`. Es el esquema más simple de los que
 * maneja el sistema —sin timestamp ni id, a diferencia de Stripe o Svix—, así
 * que no protege contra la repetición: eso lo cubre la idempotencia por
 * `externo_id` de `crm_mensajes`.
 *
 * Se aceptan VARIOS secretos porque una app de «Instagram API with Instagram
 * Login» tiene un secreto propio, distinto del de la app de Facebook, y los dos
 * pueden firmar eventos que llegan al mismo endpoint (Chatwoot,
 * `MetaTokenVerifyConcern#valid_meta_signature?`).
 */
export async function verificarFirmaMeta(
  secretos: readonly (string | undefined)[],
  cabecera: string | null,
  cuerpo: string,
): Promise<boolean> {
  if (!cabecera?.startsWith('sha256=')) return false
  const recibida = cabecera.slice('sha256='.length).toLowerCase()

  for (const secreto of secretos) {
    if (!secreto) continue
    if (comparacionConstante(await hmacHex(secreto, cuerpo), recibida)) return true
  }
  return false
}
