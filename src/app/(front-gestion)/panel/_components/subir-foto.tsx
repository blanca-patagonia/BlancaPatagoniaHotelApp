'use client'

import { useState } from 'react'
import { CAMPO, Campo } from './ui'

/** Lado mayor de una foto achicada: alcanza para documentar un desperfecto. */
const LADO_MAXIMO = 1600
/** Por encima de esto se achica; por debajo viaja tal cual. */
const UMBRAL_BYTES = 900 * 1024
/** Lo que entra en una Server Action (ver `next.config.ts`), con margen. */
const MAXIMO_BYTES = 3.8 * 1024 * 1024

/**
 * Achica una foto en el navegador: JPEG con el lado mayor en `LADO_MAXIMO`.
 *
 * Una foto de la cámara del teléfono pesa entre 3 y 6 MB, y la acción que la
 * recibe tiene un tope de cuerpo: antes se rechazaba antes de llegar y se veía
 * la pantalla de error genérica, aunque el texto de ayuda prometía 8 MB.
 * Devuelve `null` si el navegador no pudo leer la imagen; ahí se intenta con
 * el original.
 */
async function achicar(archivo: File): Promise<File | null> {
  try {
    const imagen = await createImageBitmap(archivo)
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height))
    const lienzo = document.createElement('canvas')
    lienzo.width = Math.round(imagen.width * escala)
    lienzo.height = Math.round(imagen.height * escala)
    lienzo.getContext('2d')?.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
    imagen.close()
    const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.82))
    if (!blob) return null
    const nombre = archivo.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], nombre, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return null
  }
}

/**
 * Campo de subida de una foto (o PDF) para adjuntar a una Server Action.
 *
 * No sube nada por sí mismo: el archivo viaja en el `FormData` del formulario
 * que lo contenga, y quien procesa la acción lo sube con
 * `lib/storage/subirAdjunto`. `capture="environment"` abre la cámara trasera en
 * el teléfono, porque el uso principal (mantenimiento, housekeeping) es sacar
 * la foto ahí mismo. Las fotos grandes se achican antes de enviarse.
 */
export function SubirFoto({
  nombre,
  etiqueta = 'Foto',
  ayuda = 'JPG, PNG, WEBP o PDF. Las fotos se achican solas; un PDF, hasta 3,5 MB.',
  requerido,
}: {
  nombre: string
  etiqueta?: string
  ayuda?: string
  requerido?: boolean
}) {
  const [previa, setPrevia] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [preparando, setPreparando] = useState(false)

  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} requerido={requerido}>
      <input
        type="file"
        name={nombre}
        accept="image/jpeg,image/png,image/webp,application/pdf"
        capture="environment"
        required={requerido}
        className={CAMPO}
        onChange={async (e) => {
          const campo = e.currentTarget
          setAviso(null)
          let archivo = campo.files?.[0]
          if (!archivo) {
            setPrevia(null)
            return
          }

          if (archivo.type.startsWith('image/') && archivo.size > UMBRAL_BYTES) {
            setPreparando(true)
            const chico = await achicar(archivo)
            setPreparando(false)
            if (chico && chico.size < archivo.size) {
              // Se reemplaza el archivo del campo: es el que viaja en el formulario.
              const lista = new DataTransfer()
              lista.items.add(chico)
              campo.files = lista.files
              archivo = chico
            }
          }

          if (archivo.size > MAXIMO_BYTES) {
            campo.value = ''
            setPrevia(null)
            setAviso(
              archivo.type === 'application/pdf'
                ? 'Ese PDF es demasiado grande para subirlo desde acá (más de 3,5 MB). Probá con una foto del documento.'
                : 'No se pudo achicar la foto lo suficiente. Probá sacarla de nuevo.',
            )
            return
          }

          setPrevia(archivo.type.startsWith('image/') ? URL.createObjectURL(archivo) : null)
        }}
      />
      {preparando && (
        <p className="mt-1 text-sm text-stone-600" role="status">
          Preparando la foto…
        </p>
      )}
      {aviso && (
        <p className="mt-1 text-sm text-red-700" role="alert">
          {aviso}
        </p>
      )}
      {previa && (
        // eslint-disable-next-line @next/next/no-img-element -- vista previa de un objeto local (blob:), no un asset optimizable por next/image
        <img src={previa} alt="Vista previa de la foto elegida" className="mt-2 h-32 w-32 rounded-lg object-cover ring-1 ring-stone-200" />
      )}
    </Campo>
  )
}
