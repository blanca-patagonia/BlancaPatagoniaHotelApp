'use client'

import { useState } from 'react'
import { CAMPO, Campo } from './ui'

/**
 * Campo de subida de una foto (o PDF) para adjuntar a una Server Action.
 *
 * Es deliberadamente simple: no sube nada por sí mismo. El archivo viaja como
 * parte del `FormData` del formulario que lo contenga, y quien procesa la
 * acción lo sube con `lib/storage/subirAdjunto`. `capture="environment"` abre
 * la cámara trasera en el teléfono en vez de la galería, porque el uso
 * principal (mantenimiento, housekeeping) es sacar la foto ahí mismo.
 */
export function SubirFoto({
  nombre,
  etiqueta = 'Foto',
  ayuda = 'JPG, PNG, WEBP o PDF. Hasta 8 MB.',
  requerido,
}: {
  nombre: string
  etiqueta?: string
  ayuda?: string
  requerido?: boolean
}) {
  const [previa, setPrevia] = useState<string | null>(null)

  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} requerido={requerido}>
      <input
        type="file"
        name={nombre}
        accept="image/jpeg,image/png,image/webp,application/pdf"
        capture="environment"
        required={requerido}
        className={CAMPO}
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          if (!archivo) {
            setPrevia(null)
            return
          }
          if (archivo.type.startsWith('image/')) {
            setPrevia(URL.createObjectURL(archivo))
          } else {
            setPrevia(null)
          }
        }}
      />
      {previa && (
        // eslint-disable-next-line @next/next/no-img-element -- vista previa de un objeto local (blob:), no un asset optimizable por next/image
        <img src={previa} alt="Vista previa de la foto elegida" className="mt-2 h-32 w-32 rounded-lg object-cover ring-1 ring-stone-200" />
      )}
    </Campo>
  )
}
