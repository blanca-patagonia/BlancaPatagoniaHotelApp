import { urlAdjunto } from '@/lib/storage'
import { registrarErrorSync } from '@/lib/registro'

/** Carpeta del bucket que guarda housekeeping (ver `housekeeping/actions.ts`). */
const PREFIJO_PERMITIDO = 'housekeeping'

/**
 * Muestra un adjunto guardado en Storage (ADR 0037). Pide una URL firmada de
 * corta duración en cada render — nunca se guarda ni se reusa una URL vieja,
 * así una foto borrada o un bucket rotado no dejan un link roto silencioso.
 */
export async function FotoAdjunta({ ruta, alt }: { ruta: string; alt: string }) {
  // El bucket es uno solo y se firma con service_role: sólo se firma lo que
  // este módulo guarda. Una ruta cargada a mano en `fotos` no abre otros objetos.
  const url = ruta.startsWith(`${PREFIJO_PERMITIDO}/`) && !ruta.includes('..') ? await urlAdjunto(ruta) : null
  if (!url) {
    registrarErrorSync('foto_adjunta_sin_url', { ruta })
    return <p className="text-sm text-stone-500">No se pudo cargar el adjunto.</p>
  }
  if (ruta.toLowerCase().endsWith('.pdf')) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-lago-700 underline">
        Ver comprobante (PDF)
      </a>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element -- URL firmada y temporal, no un asset del proyecto
  return <img src={url} alt={alt} className="h-40 w-40 rounded-lg object-cover ring-1 ring-stone-200" />
}
