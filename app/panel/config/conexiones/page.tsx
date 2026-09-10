import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  PROVEEDORES,
  ETIQUETAS_PROVEEDOR,
  ETIQUETAS_ESTADO_CONEXION,
  TIPO_CONEXION,
  type Proveedor,
  type EstadoConexion,
} from '@/lib/domain/conexiones'
import { formatoFechaCorta } from '@/lib/fechas'
import { registrarFalla } from '@/lib/acciones'
import { Encabezado, Etiqueta, Mensaje, Pagina, Tarjeta, type Tono } from '../../_components/ui'
import { desconectarProveedor } from './actions'
import { BotonConectar } from './boton-conectar'
import { BotonEnvio } from '../../_components/boton-envio'

const MENSAJES_ERROR: Record<string, string> = {
  desconectar: 'No se pudo desconectar. Quedó como estaba.',
}

const TONO_ESTADO: Record<EstadoConexion, Tono> = {
  conectado: 'exito',
  desconectado: 'neutro',
  expirado: 'alerta',
  requiere_cuenta_partner: 'alerta',
}

interface FilaConexion {
  proveedor: Proveedor
  estado: EstadoConexion
  conectado_en: string | null
}

/**
 * Conexiones con proveedores externos: una pantalla, cuatro tarjetas, el
 * mismo estilo para las que usan OAuth2 (Mercado Pago, correo) y las que usan
 * un link de calendario (Booking, Expedia) — para quien la usa tiene que
 * sentirse una sola forma de trabajar.
 *
 * Fase 1 de 4 (pedido del usuario, con pausa entre cada una): Mercado Pago ya
 * conecta de verdad. Correo, Booking y Expedia todavía no — se muestran para
 * que el layout final ya esté a la vista, sin fingir una función que no existe.
 */
export default async function ConexionesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  await requerirAcceso('config')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const { data, error } = await supabase
    .from('conexiones_proveedores')
    .select('proveedor, estado, conectado_en')
  // Sin esto, un proveedor CONECTADO se vería "desconectado" si la lectura
  // falla — y alguien podría arrancar de nuevo el alta de OAuth sin necesidad.
  if (error) registrarFalla(error, 'config:conexiones')

  const porProveedor = new Map<Proveedor, FilaConexion>()
  for (const fila of (data ?? []) as FilaConexion[]) {
    porProveedor.set(fila.proveedor, fila)
  }

  return (
    <Pagina>
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Conexiones"
        descripcion="Vincular Mercado Pago, el correo, Booking y Expedia. Nunca hace falta pegar una clave a mano."
        icono="config"
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'No se pudo completar.'}</Mensaje>}
      {sp.ok === 'desconectado' && <Mensaje tono="ok">Desconectado.</Mensaje>}
      {error && (
        <Mensaje tono="error">
          No se pudo leer el estado de las conexiones — puede figurar desconectado un proveedor que
          en realidad sigue conectado.
        </Mensaje>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {PROVEEDORES.map((proveedor) => {
          const fila = porProveedor.get(proveedor)
          const estado = fila?.estado ?? 'desconectado'
          const disponible = proveedor === 'mercadopago'

          return (
            <Tarjeta key={proveedor}>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold text-stone-900">
                      {ETIQUETAS_PROVEEDOR[proveedor]}
                    </h3>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {TIPO_CONEXION[proveedor] === 'oauth2'
                        ? 'Se confirma en la pantalla real del proveedor.'
                        : 'Se vincula pegando un link de calendario.'}
                    </p>
                  </div>
                  <Etiqueta tono={disponible ? TONO_ESTADO[estado] : 'neutro'}>
                    {disponible ? ETIQUETAS_ESTADO_CONEXION[estado] : 'Próximamente'}
                  </Etiqueta>
                </div>

                {disponible ? (
                  <div className="mt-4">
                    {estado === 'conectado' ? (
                      <div className="flex flex-wrap items-center gap-3">
                        {fila?.conectado_en && (
                          <p className="text-xs text-stone-500">
                            Conectado el {formatoFechaCorta(fila.conectado_en.slice(0, 10))}.
                          </p>
                        )}
                        <form action={desconectarProveedor}>
                          <input type="hidden" name="proveedor" value={proveedor} />
                          <BotonEnvio
                            variante="secundario"
                            cargando="Desconectando…"
                            confirmar={`¿Desconectar ${ETIQUETAS_PROVEEDOR[proveedor]}? Los cobros por acá dejan de funcionar hasta reconectar.`}
                          >
                            Desconectar
                          </BotonEnvio>
                        </form>
                      </div>
                    ) : (
                      <BotonConectar
                        proveedor={proveedor}
                        urlAutorizacion={`/api/conexiones/${proveedor}/autorizar`}
                      >
                        Conectar {ETIQUETAS_PROVEEDOR[proveedor]}
                      </BotonConectar>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-stone-500">Todavía no está implementado en el panel.</p>
                )}
              </div>
            </Tarjeta>
          )
        })}
      </div>
    </Pagina>
  )
}
