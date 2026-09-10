import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { datosFiscales } from '@/lib/facturacion/emisor'
import { CONDICIONES_IVA, ETIQUETAS_CONDICION_IVA, formatearCuit } from '@/lib/domain/facturacion'
import { guardarDatosFiscales } from '../actions'
import { CAMPO, Campo, Encabezado, Mensaje, Pagina, Tarjeta } from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'

const MENSAJES_ERROR: Record<string, string> = {
  fiscales_rol:
    'Los datos fiscales del hotel los cambia administración: afectan todos los comprobantes que se emitan desde ese momento.',
  fiscales_razon: 'Escribí la razón social tal como figura en la constancia de inscripción.',
  fiscales_cuit:
    'Ese CUIT no es válido. Se verifica el dígito verificador, no sólo la cantidad de números: once dígitos cualesquiera harían rechazar todos los comprobantes.',
  fiscales: 'No se pudieron guardar los datos fiscales. Quedaron como estaban.',
}

/**
 * Datos del hotel como **emisor** de comprobantes (migración 0082).
 *
 * ⚠️ Cargar esto **no habilita a facturar de verdad**: sigue faltando el
 * certificado y el adapter WSAA/WSFEv1 (ADR 0012). Es el dato, no la
 * integración.
 */
export default async function DatosFiscalesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const esAdmin = sesion.rol === 'admin'
  const supabase = await crearClienteServidor()
  const datos = await datosFiscales(supabase)

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Datos fiscales del hotel"
        descripcion="Los que van impresos en la factura y los que ARCA pide de quien la emite."
        icono="config"
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}</Mensaje>}
      {sp.ok === 'fiscales' && <Mensaje tono="ok">Datos fiscales guardados.</Mensaje>}

      <Tarjeta>
        <div className="p-5">
          {!datos && (
            <p className="mb-3 rounded-lg bg-lenga-50 px-3 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200">
              <strong>Todavía no están cargados.</strong> Sin el CUIT del hotel no se puede pedir un
              CAE, y la pantalla de comprobantes recibidos no puede avisar cuando una factura
              escaneada no es del hotel.
            </p>
          )}

          <p className="mb-3 text-xs leading-snug text-stone-600">
            Cargar esto <strong>no habilita a facturar contra ARCA</strong>: para eso falta el
            certificado fiscal y la integración (ADR 0012). Es el dato que a esa integración le va a
            hacer falta, y el que hoy usa el escaneo de facturas recibidas.
          </p>

          {!esAdmin ? (
            <div className="text-sm text-stone-700">
              {datos ? (
                <p>
                  <strong>{datos.razonSocial}</strong> · CUIT {formatearCuit(datos.cuit)} ·{' '}
                  {ETIQUETAS_CONDICION_IVA[datos.condicionIva]}
                </p>
              ) : (
                <p className="text-stone-500">Sin cargar.</p>
              )}
              <p className="mt-1 text-xs text-stone-500">
                Los cambia administración: afectan todos los comprobantes que se emitan.
              </p>
            </div>
          ) : (
            <form action={guardarDatosFiscales} className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Campo etiqueta="Razón social" requerido>
                  <input
                    name="razon_social"
                    required
                    maxLength={120}
                    defaultValue={datos?.razonSocial ?? ''}
                    className={CAMPO}
                  />
                </Campo>
              </div>

              <Campo
                etiqueta="CUIT"
                requerido
                ayuda="Se verifica el dígito verificador, no sólo la cantidad."
              >
                <input
                  name="cuit"
                  required
                  inputMode="numeric"
                  defaultValue={datos ? formatearCuit(datos.cuit) : ''}
                  placeholder="30-71234567-8"
                  className={CAMPO}
                />
              </Campo>

              <Campo
                etiqueta="Condición frente al IVA"
                ayuda="Del hotel, no del huésped: define qué letras puede emitir."
              >
                <select
                  name="condicion_iva"
                  defaultValue={datos?.condicionIva ?? 'responsable_inscripto'}
                  className={CAMPO}
                >
                  {CONDICIONES_IVA.map((c) => (
                    <option key={c} value={c}>
                      {ETIQUETAS_CONDICION_IVA[c]}
                    </option>
                  ))}
                </select>
              </Campo>

              <Campo etiqueta="Inicio de actividades">
                <input
                  name="inicio_actividades"
                  type="date"
                  defaultValue={datos?.inicioActividades ?? ''}
                  className={CAMPO}
                />
              </Campo>

              <Campo etiqueta="Ingresos brutos">
                <input
                  name="ingresos_brutos"
                  maxLength={60}
                  defaultValue={datos?.ingresosBrutos ?? ''}
                  className={CAMPO}
                />
              </Campo>

              <div className="sm:col-span-3">
                <Campo etiqueta="Domicilio comercial">
                  <input
                    name="domicilio"
                    maxLength={200}
                    defaultValue={datos?.domicilio ?? ''}
                    className={CAMPO}
                  />
                </Campo>
              </div>

              <div className="sm:col-span-3">
                <BotonEnvio variante="secundario" cargando="Guardando…">
                  Guardar datos fiscales
                </BotonEnvio>
              </div>
            </form>
          )}
        </div>
      </Tarjeta>
    </Pagina>
  )
}
