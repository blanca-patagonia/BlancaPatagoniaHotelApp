import Link from 'next/link'
import { requerirRol } from '@/lib/auth/session'
import { listarEtiquetas } from '@/lib/bandeja/consultas'
import type { TonoEtiqueta } from '@/lib/domain/bandeja'
import { Encabezado, EstadoVacio, Etiqueta, Mensaje, Pagina, Tabla, TD, TH, FILA, botonClases, type Tono } from '../../_components/ui'
import { SubNavBandeja } from '../subnav'

const TONO: Record<TonoEtiqueta, Tono> = {
  lago: 'lago', calafate: 'calafate', lenga: 'alerta', exito: 'exito', alerta: 'alerta', peligro: 'peligro', neutro: 'neutro',
}

/** Etiquetas de conversación (Chatwoot: labels). Las define la dirección. */
export default async function EtiquetasPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requerirRol('admin', 'gerencia')
  const sp = await searchParams
  const { datos: data, fallo: error } = await listarEtiquetas()

  return (
    <Pagina>
      <Encabezado
        titulo="Etiquetas de la bandeja"
        descripcion="Sirven para clasificar conversaciones y filtrarlas: reclamos, consultas de agencias, reservas confirmadas."
        icono="chat"
        acciones={
          <>
            <Link href="/panel/bandeja" className={botonClases('secundario')}>
              Volver a la bandeja
            </Link>
            <Link href="/panel/bandeja/etiquetas/nueva" className={botonClases('primario')}>
              + Nueva etiqueta
            </Link>
          </>
        }
      />
      <SubNavBandeja direccion={true} />
      {sp.ok === 'borrada' && <Mensaje tono="ok">Etiqueta borrada.</Mensaje>}
      {sp.error && <Mensaje tono="error">No se pudo borrar la etiqueta.</Mensaje>}
      {error && <Mensaje tono="error">No se pudieron leer las etiquetas. Recargá la página.</Mensaje>}
      {!error && (data ?? []).length === 0 ? (
        <EstadoVacio icono="chat" titulo="Todavía no hay etiquetas" />
      ) : (
        <Tabla resumen={`${(data ?? []).length} etiquetas`}>
          <thead>
            <tr>
              <th className={TH}>Etiqueta</th>
              <th className={TH}><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((e) => (
              <tr key={e.id as string} className={FILA}>
                <td className={TD}>
                  <Etiqueta tono={TONO[e.color as TonoEtiqueta]}>{e.nombre as string}</Etiqueta>
                </td>
                <td className={`${TD} text-right`}>
                  <Link href={`/panel/bandeja/etiquetas/${e.id}`} className={botonClases('secundario')}>
                    Editar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      )}
    </Pagina>
  )
}
