import { requerirRol } from '@/lib/auth/session'
import { Encabezado, Pagina, Tarjeta } from '../../../_components/ui'
import { FormRespuesta } from '../../formularios-ajustes'

export default async function NuevaRespuestaPage() {
  await requerirRol('admin', 'gerencia')
  return (
    <Pagina ancho="angosto">
      <Encabezado titulo="Nueva respuesta guardada" icono="chat" />
      <Tarjeta>
        <FormRespuesta />
      </Tarjeta>
    </Pagina>
  )
}
