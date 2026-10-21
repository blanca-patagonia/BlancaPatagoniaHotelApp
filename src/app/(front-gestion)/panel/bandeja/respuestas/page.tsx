import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { listarRespuestas } from '@/lib/bandeja/consultas'
import { esDireccion } from '@/lib/domain/permisos'
import { Encabezado, EstadoVacio, Mensaje, Pagina, Tabla, TD, TH, FILA, botonClases } from '../../_components/ui'
import { SubNavBandeja } from '../subnav'

/** Respuestas guardadas de la bandeja (Chatwoot: canned responses). */
export default async function RespuestasPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sesion = await requerirAcceso('bandeja')
  const sp = await searchParams
  const { datos: data, fallo: error } = await listarRespuestas()
  const direccion = esDireccion(sesion.rol)

  return (
    <Pagina>
      <Encabezado
        titulo="Respuestas guardadas"
        descripcion="Textos que se repiten. En la bandeja se usan escribiendo «/» y el atajo."
        icono="chat"
        acciones={
          <>
            <Link href="/panel/bandeja" className={botonClases('secundario')}>
              Volver a la bandeja
            </Link>
            {direccion && (
              <Link href="/panel/bandeja/respuestas/nueva" className={botonClases('primario')}>
                + Nueva respuesta
              </Link>
            )}
          </>
        }
      />
      <SubNavBandeja direccion={esDireccion(sesion.rol)} />
      {sp.ok === 'borrada' && <Mensaje tono="ok">Respuesta borrada.</Mensaje>}
      {sp.error && <Mensaje tono="error">No se pudo borrar la respuesta.</Mensaje>}
      {error && <Mensaje tono="error">No se pudieron leer las respuestas guardadas. Recargá la página.</Mensaje>}
      {!error && (data ?? []).length === 0 ? (
        <EstadoVacio icono="chat" titulo="Todavía no hay respuestas guardadas" />
      ) : (
        <Tabla resumen={`${(data ?? []).length} respuestas guardadas`}>
          <thead>
            <tr>
              <th className={TH}>Atajo</th>
              <th className={TH}>Texto</th>
              {direccion && <th className={TH}><span className="sr-only">Acciones</span></th>}
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id as string} className={FILA}>
                <td className={`${TD} font-mono text-sm text-lago-700`}>/{r.atajo as string}</td>
                <td className={`${TD} text-sm whitespace-pre-line`}>{r.contenido as string}</td>
                {direccion && (
                  <td className={`${TD} text-right`}>
                    <Link href={`/panel/bandeja/respuestas/${r.id}`} className={botonClases('secundario')}>
                      Editar
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Tabla>
      )}
    </Pagina>
  )
}
