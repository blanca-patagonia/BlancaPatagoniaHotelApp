import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import {
  DESCRIPCION_FUENTE,
  ETIQUETAS_FUENTE,
  ETIQUETAS_MONEDA,
  MONEDAS_EXTRANJERAS,
  formatearLocal,
  textoEstado,
} from '@/lib/domain/divisas'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { cargarCotizacion } from '../actions'
import { CAMPO, Campo, Encabezado, Etiqueta, FILA, Mensaje, TD, TH, Tabla, Tarjeta, Pagina } from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'

const MENSAJES_ERROR: Record<string, string> = {
  moneda: 'Esa moneda no está soportada.',
  cotizacion: 'No se pudo guardar la cotización. Quedó vigente la anterior.',
}

/**
 * Cotización de divisas: lo vigente y la carga manual.
 *
 * Cierra la tarea que el ADR 0003 dejó abierta («hace falta un mecanismo para
 * cargar/actualizar la cotización»).
 */
export default async function DivisasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; detalle?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'

  const vigentes = await Promise.all(
    MONEDAS_EXTRANJERAS.map(async (m) => ({ moneda: m, vigente: await cotizacionVigente(m) })),
  )

  return (
    <Pagina>
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Cotización de divisas"
        descripcion="Se actualiza sola desde una fuente pública. El valor manual es el respaldo para cuando esa fuente no responde."
        icono="config"
      />

      {sp.error && (
        <Mensaje tono="error">{sp.detalle ?? MENSAJES_ERROR[sp.error] ?? 'No se pudo guardar.'}</Mensaje>
      )}
      {sp.ok === 'cotizacion' && (
        <Mensaje tono="ok">Cotización guardada. Ya rige para los importes en esa moneda.</Mensaje>
      )}

      <Tarjeta>
        <div className="p-5">
          <p className="mb-2 text-xs text-stone-600">
            Los precios del sistema viven en <strong>USD</strong> (ADR 0003). Se cobra al valor de{' '}
            <strong>venta</strong>, que es lo que fija el Tarifario: «cotización oficial de venta
            billete del Banco Nación del día de pago».
          </p>

          <p className="mb-3 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-snug text-stone-600">
            <strong>De dónde sale el número automático:</strong> el Banco Nación no publica un
            servicio para consultar su cotización, así que el sistema la toma de un servicio público
            que la replica. <strong>No es el Banco Nación informando el valor.</strong> Si el día de
            cobro necesitás el valor exacto del BNA, cargalo a mano acá abajo: el valor manual le gana
            al automático.
          </p>

          <div className="overflow-x-auto">
            <Tabla resumen="Cotización vigente de cada divisa, con su origen y antigüedad">
              <thead>
                <tr>
                  <th className={TH}>Moneda</th>
                  <th className={`${TH} text-right`}>Compra</th>
                  <th className={`${TH} text-right`}>Venta</th>
                  <th className={TH}>Estado</th>
                  <th className={TH}>Fuente</th>
                </tr>
              </thead>
              <tbody>
                {vigentes.map(({ moneda, vigente }) => (
                  <tr key={moneda} className={FILA}>
                    <td className={TD}>
                      <span className="font-medium text-stone-800">{moneda}</span>
                      <span className="ml-2 text-xs text-stone-500">{ETIQUETAS_MONEDA[moneda]}</span>
                    </td>
                    <td className={`${TD} tabular text-right text-stone-600`}>
                      {vigente ? formatearLocal(vigente.compra, moneda) : '—'}
                    </td>
                    <td className={`${TD} tabular text-right font-medium text-stone-900`}>
                      {vigente ? formatearLocal(vigente.venta, moneda) : '—'}
                    </td>
                    <td className={TD}>
                      {vigente ? (
                        <Etiqueta
                          tono={
                            vigente.requiereAdvertencia
                              ? 'peligro'
                              : vigente.vencida
                                ? 'alerta'
                                : 'exito'
                          }
                        >
                          {textoEstado(vigente)}
                        </Etiqueta>
                      ) : (
                        <Etiqueta tono="neutro">Sin cotización — se muestra en USD</Etiqueta>
                      )}
                    </td>
                    <td className={TD}>
                      {vigente ? (
                        <>
                          <span className="text-xs font-medium text-stone-700">
                            {ETIQUETAS_FUENTE[vigente.fuente]}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-stone-500">
                            {DESCRIPCION_FUENTE[vigente.fuente]}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </div>

          {puedeEditar ? (
            <form action={cargarCotizacion} className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-4">
              <Campo etiqueta="Moneda">
                <select name="moneda" defaultValue="ARS" className={CAMPO}>
                  {MONEDAS_EXTRANJERAS.map((m) => (
                    <option key={m} value={m}>
                      {m} — {ETIQUETAS_MONEDA[m]}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Compra" ayuda="Lo que el banco paga por un dólar.">
                <input
                  name="compra"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className={CAMPO}
                />
              </Campo>
              <Campo etiqueta="Venta" ayuda="El que se cobra.">
                <input name="venta" type="number" step="0.01" min="0.01" required className={CAMPO} />
              </Campo>
              <div className="flex items-end">
                <BotonEnvio variante="secundario" cargando="Guardando…" extra="w-full sm:w-auto">
                  Guardar cotización
                </BotonEnvio>
              </div>
              <p className="text-xs text-stone-600 sm:col-span-4">
                Un valor cargado ahora reemplaza al automático hasta que la fuente publique uno más
                nuevo. Queda registrado quién lo cargó y cuándo.
              </p>
            </form>
          ) : (
            <p className="mt-4 text-xs text-stone-600">
              Solo administración y gerencia pueden cargar una cotización a mano.
            </p>
          )}
        </div>
      </Tarjeta>
    </Pagina>
  )
}
