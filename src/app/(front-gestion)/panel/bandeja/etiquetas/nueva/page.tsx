import { requerirRol } from '@/lib/auth/session'
import { Encabezado, Pagina, Tarjeta } from '../../../_components/ui'
import { FormEtiqueta } from '../../formularios-ajustes'

export default async function NuevaEtiquetaPage() {
  await requerirRol('admin', 'gerencia')
  return (
    <Pagina ancho="angosto">
      <Encabezado titulo="Nueva etiqueta" icono="chat" />
      <Tarjeta>
        <FormEtiqueta />
      </Tarjeta>
    </Pagina>
  )
}
