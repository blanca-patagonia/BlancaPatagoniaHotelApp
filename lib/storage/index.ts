import 'server-only'
import { crearClienteAdmin } from '@/lib/supabase/admin'

/**
 * Primer y único punto de acceso a Supabase Storage (ADR 0037). El bucket es
 * privado y no tiene ninguna política RLS: la autorización vive acá, no en
 * `storage.objects`, porque quien llama a estas funciones ya pasó por
 * `requerirAcceso` en su Server Action. El acceso de lectura es SIEMPRE por URL
 * firmada de corta duración — nunca se expone el bucket ni una URL pública.
 */
export const BUCKET_ADJUNTOS = 'adjuntos-operativos'

const TIPOS_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const TAMANO_MAXIMO = 8 * 1024 * 1024 // 8 MB — igual al límite del bucket (migración 0099)

/** Valida antes de gastar una llamada de red; el bucket también lo exige, esto es para el mensaje en español. */
export function archivoInvalido(archivo: File): string | null {
  if (!TIPOS_PERMITIDOS.has(archivo.type)) return 'Solo se aceptan fotos (JPG, PNG, WEBP) o PDF.'
  if (archivo.size > TAMANO_MAXIMO) return 'El archivo supera los 8 MB permitidos.'
  return null
}

/**
 * Sube un archivo a una carpeta del bucket. `carpeta` es el prefijo de primer
 * nivel por módulo (`mantenimiento`, `housekeeping`, `proveedores`, `agencias`)
 * seguido del id de la entidad, así cada módulo queda separado sin necesitar
 * buckets ni políticas propias.
 */
export async function subirAdjunto(
  carpeta: string,
  archivo: File,
): Promise<{ ruta: string; error?: undefined } | { error: string; ruta?: undefined }> {
  const invalido = archivoInvalido(archivo)
  if (invalido) return { error: invalido }

  const extension = archivo.name.includes('.') ? archivo.name.split('.').pop() : undefined
  const ruta = `${carpeta}/${crypto.randomUUID()}${extension ? `.${extension}` : ''}`

  const admin = crearClienteAdmin()
  const { error } = await admin.storage.from(BUCKET_ADJUNTOS).upload(ruta, archivo, {
    contentType: archivo.type,
    upsert: false,
  })
  if (error) return { error: 'No se pudo subir el archivo. Probá de nuevo.' }
  return { ruta }
}

/** URL de lectura de corta duración. Nunca se guarda ni se reusa: se pide de nuevo cada vez que se muestra. */
export async function urlAdjunto(ruta: string, segundos = 300): Promise<string | null> {
  const admin = crearClienteAdmin()
  const { data, error } = await admin.storage.from(BUCKET_ADJUNTOS).createSignedUrl(ruta, segundos)
  if (error || !data) return null
  return data.signedUrl
}

export async function eliminarAdjunto(ruta: string): Promise<void> {
  const admin = crearClienteAdmin()
  await admin.storage.from(BUCKET_ADJUNTOS).remove([ruta])
}
