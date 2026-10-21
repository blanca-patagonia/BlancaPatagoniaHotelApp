import { notFound } from 'next/navigation'
import { requerirRol } from '@/lib/auth/session'
import { leerRespuesta } from '@/lib/bandeja/consultas'
import { Encabezado, Mensaje, Pagina, Tarjeta } from '../../../_components/ui'
import { BotonEnvio } from '../../../_components/boton-envio'
import { FormRespuesta } from '../../formularios-ajustes'
import { borrarRespuesta } from '../../ajustes.actions'

export default async function EditarRespuestaPage({ params }: { params: Promise<{ id: string }> }) {
  await requerirRol('admin', 'gerencia')
  const { id } = await params
  const { datos: data, fallo: error } = await leerRespuesta(id)
  if (error) {
    return (
      <Pagina ancho="angosto">
        <Mensaje tono="error">No se pudo leer la respuesta. Recargá la página.</Mensaje>
      </Pagina>
    )
  }
  if (!data) notFound()

  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo={`Respuesta /${data.atajo}`}
        icono="chat"
        acciones={
          <form action={borrarRespuesta}>
            <input type="hidden" name="id" value={data.id} />
            <BotonEnvio variante="peligro" cargando="Borrando…" confirmar="¿Borrar esta respuesta guardada?">
              Borrar
            </BotonEnvio>
          </form>
        }
      />
      <Tarjeta>
        <FormRespuesta inicial={data} />
      </Tarjeta>
    </Pagina>
  )
}
