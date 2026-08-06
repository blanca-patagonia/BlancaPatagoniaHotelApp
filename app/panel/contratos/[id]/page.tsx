import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { hoyISO, formatoFechaCorta } from '@/lib/fechas'
import {
  ETIQUETAS_ESTADO_CONTRATO,
  ETIQUETAS_TIPO_CONTRATO,
  motivoNoFirmable,
  MENSAJES_NO_FIRMABLE,
  puedeEnviar,
  transicionesPosibles,
  type EstadoContrato,
  type TipoContrato,
} from '@/lib/domain/contratos'
import {
  CAMPO,
  Campo,
  Encabezado,
  Etiqueta,
  Mensaje,
  Pagina,
  Tarjeta,
  botonClases,
  type Tono,
} from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'
import { cambiarEstadoContrato, enviarAFirmar, verificarIntegridad } from '../actions'

const TONO_CONTRATO: Record<EstadoContrato, Tono> = {
  borrador: 'neutro',
  enviado: 'lago',
  firmado: 'exito',
  rechazado: 'peligro',
  vencido: 'alerta',
}

const MENSAJES_ERROR: Record<string, string> = {
  no_enviable: 'Este contrato no se puede enviar en su estado actual.',
  transicion: 'Esa transición de estado no es válida.',
  envio: 'No se pudo generar la invitación a firmar.',
  sin_firma: 'Todavía no hay una firma registrada para verificar.',
}

const MENSAJES_OK: Record<string, string> = {
  enviado: 'Contrato enviado. Copiá el enlace de firma y hacéselo llegar a la contraparte.',
  integro: 'Verificación correcta: el texto coincide exactamente con lo que se firmó.',
  alterado: '⚠️ El texto actual NO coincide con el que se firmó. El documento fue modificado.',
}

interface Contrato {
  id: string
  tipo: TipoContrato
  entidad_id: string
  titulo: string
  contenido: string | null
  estado: EstadoContrato
  fecha_envio: string | null
  fecha_firma: string | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
}

interface Firma {
  token: string
  firmante_nombre: string | null
  firmante_email: string | null
  hash_documento: string | null
  ip: string | null
  fecha_firma: string | null
}

/** Resuelve el nombre de la contraparte según el tipo (referencia polimórfica). */
async function nombreEntidad(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  tipo: TipoContrato,
  id: string,
): Promise<string> {
  const tabla = tipo === 'agencia' ? 'agencias' : tipo === 'proveedor' ? 'proveedores' : 'perfiles'
  const { data } = await supabase.from(tabla).select('nombre').eq('id', id).maybeSingle()
  return (data?.nombre as string) ?? '—'
}

export default async function DetalleContratoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  await requerirAcceso('contratos')
  const { id } = await params
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('contratos')
    .select(
      'id, tipo, entidad_id, titulo, contenido, estado, fecha_envio, fecha_firma, vigencia_desde, vigencia_hasta',
    )
    .eq('id', id)
    .single()

  if (!data) notFound()
  const contrato = data as Contrato

  const [{ data: firmaData }, entidad, cabeceras] = await Promise.all([
    supabase
      .from('firmas')
      .select('token, firmante_nombre, firmante_email, hash_documento, ip, fecha_firma')
      .eq('contrato_id', id)
      .order('creado_en', { ascending: false })
      .limit(1)
      .maybeSingle(),
    nombreEntidad(supabase, contrato.tipo, contrato.entidad_id),
    headers(),
  ])
  const firma = firmaData as Firma | null

  const hoy = hoyISO()
  const motivo = motivoNoFirmable(contrato, hoy)
  const origen = `${cabeceras.get('x-forwarded-proto') ?? 'http'}://${cabeceras.get('host') ?? 'localhost:3000'}`
  const enlaceFirma = firma ? `${origen}/firmar/${firma.token}` : null

  return (
    <Pagina ancho="angosto">
      <div className="mb-4">
        <Link href="/panel/contratos" className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Contratos
        </Link>
      </div>

      <Encabezado
        titulo={contrato.titulo}
        descripcion={`${ETIQUETAS_TIPO_CONTRATO[contrato.tipo]} · ${entidad}`}
        icono="contratos"
        acciones={
          <Etiqueta tono={TONO_CONTRATO[contrato.estado]}>
            {ETIQUETAS_ESTADO_CONTRATO[contrato.estado]}
          </Etiqueta>
        }
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'Ocurrió un error.'}</Mensaje>}
      {sp.ok && (
        <Mensaje tono={sp.ok === 'alterado' ? 'error' : 'ok'}>
          {MENSAJES_OK[sp.ok] ?? 'Listo.'}
        </Mensaje>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Tarjeta titulo="Vigencia">
          <dl className="flex flex-col gap-2 p-5 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-500">Desde</dt>
              <dd className="text-stone-800">
                {contrato.vigencia_desde ? formatoFechaCorta(contrato.vigencia_desde) : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-500">Hasta</dt>
              <dd className="text-stone-800">
                {contrato.vigencia_hasta ? formatoFechaCorta(contrato.vigencia_hasta) : 'sin fin'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-500">Enviado</dt>
              <dd className="text-stone-800">
                {contrato.fecha_envio
                  ? new Date(contrato.fecha_envio).toLocaleDateString('es-AR')
                  : '—'}
              </dd>
            </div>
          </dl>
        </Tarjeta>

        <Tarjeta titulo="Constancia de firma">
          {firma?.fecha_firma ? (
            <dl className="flex flex-col gap-2 p-5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-stone-500">Firmante</dt>
                <dd className="text-right text-stone-800">{firma.firmante_nombre ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-stone-500">Fecha</dt>
                <dd className="text-stone-800">
                  {new Date(firma.fecha_firma).toLocaleString('es-AR')}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-stone-500">IP</dt>
                <dd className="tabular text-stone-800">{firma.ip ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Huella SHA-256</dt>
                <dd className="mt-1 font-mono text-[10px] leading-tight break-all text-stone-600">
                  {firma.hash_documento}
                </dd>
              </div>
              <form action={verificarIntegridad} className="mt-1">
                <input type="hidden" name="contrato_id" value={contrato.id} />
                <button className={botonClases('secundario', 'w-full')}>Verificar integridad</button>
              </form>
            </dl>
          ) : (
            <p className="p-5 text-sm text-stone-500">
              Todavía sin firmar.
              {motivo && ` ${MENSAJES_NO_FIRMABLE[motivo]}`}
            </p>
          )}
        </Tarjeta>
      </div>

      {/* Envío a firmar */}
      {puedeEnviar(contrato.estado) && (
        <Tarjeta titulo="Enviar a firmar" className="mt-4">
          <form action={enviarAFirmar} className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2">
            <input type="hidden" name="contrato_id" value={contrato.id} />

            <Campo etiqueta="Nombre de quien firma">
              <input name="firmante_nombre" className={CAMPO} />
            </Campo>
            <Campo etiqueta="Email de contacto">
              <input name="firmante_email" type="email" className={CAMPO} />
            </Campo>

            <p className="text-xs leading-relaxed text-stone-500 sm:col-span-2">
              Se genera un enlace con un token único. No se envía ningún correo: el proyecto no
              integra un proveedor de email real, así que el enlace se copia y se manda a mano.
            </p>

            <div className="sm:col-span-2">
              {/* Al enviar a firmar se congela el texto y se calcula su hash:
                  desde ese momento no se puede corregir sin invalidar la firma.
                  Por eso se pregunta antes. */}
              <BotonEnvio
                cargando="Generando…"
                confirmar="Al generar el enlace, el texto del contrato queda congelado y ya no se puede corregir. ¿Seguimos?"
              >
                Generar enlace de firma
              </BotonEnvio>
            </div>
          </form>
        </Tarjeta>
      )}

      {/* Enlace vigente */}
      {enlaceFirma && contrato.estado === 'enviado' && (
        <Tarjeta titulo="Enlace de firma" className="mt-4">
          <div className="p-5">
            <p className="mb-2 text-sm text-stone-500">
              Hacéselo llegar a {firma?.firmante_nombre ?? 'la contraparte'}. Quien tenga el enlace
              puede firmar sin necesidad de una cuenta.
            </p>
            <code className="block rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs break-all text-stone-700 ring-1 ring-stone-200">
              {enlaceFirma}
            </code>
            <a
              href={`/firmar/${firma!.token}`}
              target="_blank"
              rel="noopener noreferrer"
              className={botonClases('secundario', 'mt-3')}
            >
              Abrir la vista del firmante
            </a>
          </div>
        </Tarjeta>
      )}

      {/* Texto del contrato */}
      <Tarjeta titulo="Texto del contrato" className="mt-4">
        <p className="p-5 text-sm whitespace-pre-line text-stone-700">{contrato.contenido}</p>
      </Tarjeta>

      {/* Transiciones manuales */}
      {transicionesPosibles(contrato.estado).length > 0 && (
        <Tarjeta titulo="Cambiar estado" className="mt-4">
          <div className="flex flex-wrap gap-2 p-5">
            {transicionesPosibles(contrato.estado)
              // El envío tiene su propio formulario (genera el token) y la firma
              // ocurre del lado del firmante, no desde acá.
              .filter((e) => e !== 'enviado' && e !== 'firmado')
              .map((e) => (
                <form key={e} action={cambiarEstadoContrato}>
                  <input type="hidden" name="contrato_id" value={contrato.id} />
                  <input type="hidden" name="estado" value={e} />
                  <button className={botonClases(e === 'rechazado' ? 'peligro' : 'secundario')}>
                    Marcar {ETIQUETAS_ESTADO_CONTRATO[e].toLowerCase()}
                  </button>
                </form>
              ))}
          </div>
        </Tarjeta>
      )}
    </Pagina>
  )
}
