import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'
import { FormularioObjeto } from '../formulario'

/** Alta de un objeto encontrado, en su propia pantalla. */
export default async function NuevoObjetoPage() {
  await requerirAcceso('objetos_perdidos')

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/objetos-perdidos"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a objetos perdidos
      </Link>

      <Encabezado
        titulo="Registrar un objeto encontrado"
        descripcion="Queda en depósito hasta que alguien lo reclame."
        icono="objetos"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioObjeto />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
