import Link from 'next/link'
import { esDireccion } from '@/lib/domain/permisos'
import { mensajeDe } from '@/lib/listados'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { editarPromocion, alternarActivoPromocion } from '../promociones.actions'
import { MENSAJES_PROMOCION } from './mensajes'
import { Icono } from '../../_components/iconos'
import { registrarFalla } from '@/lib/acciones'
import { hoyISO } from '@/lib/fechas'
import {
  CAMPO,
  Campo,
  Etiqueta,
  Encabezado,
  FILA,
  Mensaje,
  TD,
  TH,
  Tabla,
  Tarjeta,
  Pagina, botonClases } from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'

const MENSAJES_ERROR = MENSAJES_PROMOCION

interface PromoFila {
  id: string
  codigo: string
  nombre: string
  tipo: 'porcentaje' | 'monto' | 'paquete'
  valor: number | string
  condiciones: { min_noches?: number; anticipacion_dias?: number } | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  activo: boolean
}

function vigenciaVencida(p: PromoFila, hoy: string): boolean {
  return Boolean(p.vigencia_hasta && p.vigencia_hasta < hoy)
}

/**
 * Alta y edición de promociones (descuento porcentual o monto fijo). Hasta
 * ahora `promociones` y el motor de precios (`lib/domain/precios.ts`) existían
 * completos y probados, pero sin pantalla de carga y sin que ningún alta de
 * reserva pasara una promoción a cotizar — código muerto de punta a punta.
 *
 * El código (el cupón que se comunica) no se edita desde acá, igual que el
 * código de un tipo de alojamiento: ver `editarPromocion`.
 */
export default async function PromocionesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const puedeEditar = esDireccion(sesion.rol)
  const supabase = await crearClienteServidor()
  const hoy = hoyISO()

  const { data, error } = await supabase
    .from('promociones')
    .select('id, codigo, nombre, tipo, valor, condiciones, vigencia_desde, vigencia_hasta, activo')
    .order('activo', { ascending: false })
    .order('nombre')
  if (error) registrarFalla(error, 'config:promociones')

  const promos = (data ?? []) as PromoFila[]

  return (
    <Pagina>
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Promociones"
        descripcion="Descuentos por porcentaje o monto fijo, con condiciones de noches mínimas y anticipación. Se eligen al crear una reserva desde el panel."
        icono="divisas"
      acciones={
          puedeEditar && (
            <Link href="/panel/config/promociones/nuevo" className={botonClases('primario')}>
              <Icono nombre="mas" tam={16} />
              Nueva promoción
            </Link>
          )
        }
      />

      {sp.error && <Mensaje tono="error">{mensajeDe(MENSAJES_ERROR, sp.error, 'No se pudo completar la operación.')}</Mensaje>}
      {(error) && (
        <Mensaje tono="error">
          No se pudieron leer las promociones: la lista de abajo puede estar incompleta o vacía. Recargá antes de crear una que quizás ya existe.
        </Mensaje>
      )}
      {sp.ok === 'promo_creada' && <Mensaje tono="ok">Promoción creada.</Mensaje>}
      {sp.ok === 'promo_editada' && <Mensaje tono="ok">Cambios guardados.</Mensaje>}
      {sp.ok === 'promo_dada_de_baja' && (
        <Mensaje tono="ok">Dada de baja. Deja de poder elegirse al crear una reserva nueva.</Mensaje>
      )}
      {sp.ok === 'promo_activada' && <Mensaje tono="ok">Reactivada.</Mensaje>}
      {error && (
        <Mensaje tono="error">
          No se pudo leer el listado de promociones. Puede estar incompleto.
        </Mensaje>
      )}


      <Tarjeta>
        <div className="overflow-x-auto p-5">
          <Tabla resumen="Promociones con tipo, valor, condiciones y vigencia">
            <thead>
              <tr>
                <th className={TH}>Promoción</th>
                <th className={TH}>Condiciones</th>
                {puedeEditar && <th className={TH}>Editar</th>}
                {puedeEditar && (
                  <th className={TH}>
                    <span className="sr-only">Baja / reactivar</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => {
                const vencida = vigenciaVencida(p, hoy)
                return (
                  <tr key={p.id} className={`${FILA} ${p.activo ? '' : 'opacity-60'}`}>
                    <td className={TD}>
                      <span className="font-medium text-stone-800">{p.nombre}</span>
                      <span className="block text-xs text-stone-500">
                        {p.codigo} · {p.tipo === 'porcentaje' ? `${Number(p.valor)}%` : `USD ${Number(p.valor)}`}
                      </span>
                      {!p.activo && <Etiqueta tono="alerta">De baja</Etiqueta>}
                      {p.activo && vencida && <Etiqueta tono="alerta">Vigencia vencida</Etiqueta>}
                    </td>
                    {puedeEditar ? (
                      <>
                        <td className={TD}>
                          <form action={editarPromocion} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="promocion_id" value={p.id} />
                            <Campo etiqueta="Nombre">
                              <input name="nombre" defaultValue={p.nombre} required className={`${CAMPO} w-32`} />
                            </Campo>
                            <Campo etiqueta="Tipo">
                              <select name="tipo" defaultValue={p.tipo === 'paquete' ? 'porcentaje' : p.tipo} className={`${CAMPO} w-32`}>
                                <option value="porcentaje">% sobre el neto</option>
                                <option value="monto">Monto fijo (USD)</option>
                              </select>
                            </Campo>
                            <Campo etiqueta="Valor">
                              <input
                                name="valor"
                                type="number"
                                min={0.01}
                                step="0.01"
                                defaultValue={Number(p.valor)}
                                className={`${CAMPO} w-20`}
                              />
                            </Campo>
                            <Campo etiqueta="Noches mín.">
                              <input
                                name="min_noches"
                                type="number"
                                min={0}
                                defaultValue={p.condiciones?.min_noches ?? ''}
                                className={`${CAMPO} w-16`}
                              />
                            </Campo>
                            <Campo etiqueta="Anticipación (días)">
                              <input
                                name="anticipacion_dias"
                                type="number"
                                min={0}
                                defaultValue={p.condiciones?.anticipacion_dias ?? ''}
                                className={`${CAMPO} w-20`}
                              />
                            </Campo>
                            <Campo etiqueta="Desde">
                              <input
                                name="vigencia_desde"
                                type="date"
                                defaultValue={p.vigencia_desde ?? ''}
                                className={`${CAMPO} w-36`}
                              />
                            </Campo>
                            <Campo etiqueta="Hasta">
                              <input
                                name="vigencia_hasta"
                                type="date"
                                defaultValue={p.vigencia_hasta ?? ''}
                                className={`${CAMPO} w-36`}
                              />
                            </Campo>
                            <BotonEnvio variante="secundario" cargando="Guardando…">
                              Guardar
                            </BotonEnvio>
                          </form>
                        </td>
                        <td className={TD}>
                          <form action={alternarActivoPromocion}>
                            <input type="hidden" name="promocion_id" value={p.id} />
                            <input type="hidden" name="activo" value={p.activo ? '0' : '1'} />
                            <BotonEnvio
                              variante="fantasma"
                              cargando="…"
                              confirmar={
                                p.activo
                                  ? `¿Dar de baja «${p.nombre}»? Deja de poder elegirse al crear una reserva nueva.`
                                  : undefined
                              }
                            >
                              {p.activo ? 'Dar de baja' : 'Reactivar'}
                            </BotonEnvio>
                          </form>
                        </td>
                      </>
                    ) : (
                      <td className={`${TD} text-stone-600`}>
                        {p.condiciones?.min_noches ? `${p.condiciones.min_noches}+ noches` : ''}
                        {p.condiciones?.min_noches && p.condiciones?.anticipacion_dias ? ' · ' : ''}
                        {p.condiciones?.anticipacion_dias ? `${p.condiciones.anticipacion_dias}+ días de anticipación` : ''}
                        {!p.condiciones?.min_noches && !p.condiciones?.anticipacion_dias ? '—' : ''}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </Tabla>
        </div>
      </Tarjeta>
    </Pagina>
  )
}
