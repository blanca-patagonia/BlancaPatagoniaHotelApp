import { FotoAdjunta } from './foto-adjunta'
import { BotonEnvio } from './boton-envio'

/**
 * Una foto/documento del bucket junto con su botón de borrado, para no repetir
 * el mismo envoltorio en mantenimiento, proveedores y agencias.
 *
 * `camposOcultos` lleva el resto de los campos que la acción necesita además
 * de `ruta` (el id de la orden, del proveedor, del movimiento…) — cada módulo
 * tiene el suyo, así que no se puede fijar un solo nombre de campo acá.
 */
export function FotoAdjuntaEliminable({
  ruta,
  alt,
  accion,
  camposOcultos,
  confirmarTexto = '¿Eliminar esta foto? No se puede deshacer.',
}: {
  ruta: string
  alt: string
  accion: (formData: FormData) => void | Promise<void>
  camposOcultos: Record<string, string>
  confirmarTexto?: string
}) {
  return (
    <div className="relative">
      <FotoAdjunta ruta={ruta} alt={alt} />
      <form action={accion} className="absolute top-1 right-1">
        <input type="hidden" name="ruta" value={ruta} />
        {Object.entries(camposOcultos).map(([nombre, valor]) => (
          <input key={nombre} type="hidden" name={nombre} value={valor} />
        ))}
        <BotonEnvio
          variante="fantasma"
          cargando="…"
          confirmar={confirmarTexto}
          aria-label="Eliminar esta foto"
          extra="min-h-0 rounded-full bg-white/90 p-1.5 text-stone-700 shadow hover:bg-white"
        >
          ✕
        </BotonEnvio>
      </form>
    </div>
  )
}
