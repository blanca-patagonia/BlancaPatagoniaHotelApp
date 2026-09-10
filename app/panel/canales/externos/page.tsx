import Link from 'next/link'
import { requerirRol } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { urlDelSitio } from '@/lib/env'
import { formatoFechaCorta } from '@/lib/fechas'
import { crearCanalExterno, alternarCanalExterno } from './actions'
import {
  CAMPO,
  Campo,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Mensaje,
  TD,
  TH,
  Tabla,
  Tarjeta,
  Pagina,
  botonClases,
} from '../../_components/ui'
import { Icono } from '../../_components/iconos'
import { BotonEnvio } from '../../_components/boton-envio'

interface CanalExterno {
  id: string
  codigo: string
  nombre: string
  activo: boolean
  token: string
  creado_en: string
}

const MENSAJES_ERROR: Record<string, string> = {
  canal: 'Revisá el código y el nombre — el código no puede repetirse.',
}

/**
 * Catálogo de channel managers (Beds24, Hotelrunner, RateGain…).
 *
 * Fase de preparación (ADR 0035): esto NO conecta nada solo. Da de alta la
 * fila que identifica al proveedor y genera el token de su webhook
 * (`POST /api/canales/externos/<token>`) — lo que hay que pegar en el panel
 * de ESE proveedor para que empiece a avisar reservas nuevas acá. Nace
 * vacío a propósito: no hay ningún channel manager contratado todavía.
 */
export default async function CanalesExternosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  await requerirRol('admin', 'gerencia')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const { data, error } = await supabase
    .from('canales_externos')
    .select('id, codigo, nombre, activo, token, creado_en')
    .order('creado_en')
  if (error) registrarFalla(error, 'canales:externos')

  const canales = (data ?? []) as CanalExterno[]
  const base = urlDelSitio()

  return (
    <Pagina>
      <Link
        href="/panel/canales"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a canales de venta
      </Link>

      <Encabezado
        titulo="Channel managers"
        descripcion="Catálogo de conexiones a un channel manager externo (Beds24, Hotelrunner, RateGain...)."
        icono="canales"
      />

      {sp.error && (
        <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}</Mensaje>
      )}
      {sp.ok === 'canal' && <Mensaje tono="ok">Canal agregado.</Mensaje>}
      {error && (
        <Mensaje tono="error">No se pudo leer el catálogo de canales externos.</Mensaje>
      )}

      <Tarjeta className="overflow-hidden">
        {canales.length === 0 ? (
          <EstadoVacio
            titulo="Sin channel managers conectados"
            descripcion="Agregá uno cuando contrates un proveedor (por ejemplo Beds24)."
            icono="canales"
          />
        ) : (
          <Tabla resumen="Channel managers con su código, estado y URL de webhook">
            <thead>
              <tr>
                <th className={TH}>Proveedor</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Alta de canal</th>
                <th className={TH}>Webhook</th>
                <th className={TH}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {canales.map((c) => (
                <tr key={c.id} className={`${FILA} ${c.activo ? '' : 'opacity-50'}`}>
                  <td className={TD}>
                    <span className="font-medium text-stone-800">{c.nombre}</span>
                    <span className="ml-1.5 text-xs text-stone-500">({c.codigo})</span>
                  </td>
                  <td className={TD}>
                    {c.activo ? (
                      <Etiqueta tono="exito">Activo</Etiqueta>
                    ) : (
                      <Etiqueta tono="neutro">Inactivo</Etiqueta>
                    )}
                  </td>
                  <td className={`${TD} text-stone-500`}>{formatoFechaCorta(c.creado_en.slice(0, 10))}</td>
                  <td className={`${TD} max-w-xs`}>
                    {/*
                      El token es la credencial del webhook: quien lo tiene puede
                      crear reservas por acá. Se muestra completo porque esta
                      pantalla ya es admin/gerencia (mismo criterio que el link de
                      portal de una agencia) — pegarlo en el panel del proveedor es
                      justamente lo que hay que hacer con él.
                    */}
                    <code className="block truncate text-xs text-stone-600" title={`${base}/api/canales/externos/${c.token}`}>
                      {base}/api/canales/externos/{c.token}
                    </code>
                  </td>
                  <td className={TD}>
                    <form action={alternarCanalExterno}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="activo" value={String(c.activo)} />
                      <button className={botonClases('secundario', 'px-2 py-1 text-xs')}>
                        {c.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}

        <form
          action={crearCanalExterno}
          className="grid gap-x-4 gap-y-4 border-t border-stone-100 p-5 sm:grid-cols-4"
        >
          <div className="sm:col-span-2">
            <Campo
              etiqueta="Código"
              requerido
              ayuda="Corto y estable, ej. «beds24». Queda guardado en reservas.canal."
            >
              <input name="codigo" required className={CAMPO} placeholder="beds24" />
            </Campo>
          </div>
          <div className="sm:col-span-2">
            <Campo etiqueta="Nombre" requerido>
              <input name="nombre" required className={CAMPO} placeholder="Beds24" />
            </Campo>
          </div>
          <div className="sm:col-span-4">
            <BotonEnvio variante="secundario" cargando="Agregando…">
              <Icono nombre="mas" tam={16} />
              Agregar canal
            </BotonEnvio>
          </div>
        </form>
      </Tarjeta>
    </Pagina>
  )
}
