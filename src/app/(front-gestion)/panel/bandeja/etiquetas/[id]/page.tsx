import { notFound } from 'next/navigation'
import { requerirRol } from '@/lib/auth/session'
import { leerEtiqueta } from '@/lib/bandeja/consultas'
import { Encabezado, Mensaje, Pagina, Tarjeta } from '../../../_components/ui'
import { BotonEnvio } from '../../../_components/boton-envio'
import { FormEtiqueta } from '../../formularios-ajustes'
import { borrarEtiqueta } from '../../ajustes.actions'

export default async function EditarEtiquetaPage({ params }: { params: Promise<{ id: string }> }) {
  await requerirRol('admin', 'gerencia')
  const { id } = await params
  const { datos: data, fallo: error } = await leerEtiqueta(id)
  if (error) {
    return (
      <Pagina ancho="angosto">
        <Mensaje tono="error">No se pudo leer la etiqueta. Recargá la página.</Mensaje>
      </Pagina>
    )
  }
  if (!data) notFound()

  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo={`Etiqueta «${data.nombre}»`}
        icono="chat"
        acciones={
          <form action={borrarEtiqueta}>
            <input type="hidden" name="id" value={data.id} />
            <BotonEnvio variante="peligro" cargando="Borrando…" confirmar="¿Borrar esta etiqueta? Se quita de todas las conversaciones que la tengan.">
              Borrar
            </BotonEnvio>
          </form>
        }
      />
      <Tarjeta>
        <FormEtiqueta inicial={data} />
      </Tarjeta>
    </Pagina>
  )
}
