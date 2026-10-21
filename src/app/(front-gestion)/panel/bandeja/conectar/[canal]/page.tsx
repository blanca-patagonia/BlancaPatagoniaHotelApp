import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { esDireccion } from '@/lib/domain/permisos'
import { CANALES_BANDEJA, ETIQUETAS_CANAL, type CanalBandeja } from '@/lib/domain/bandeja'
import { urlPublicaValida, urlWebhook } from '@/lib/domain/integraciones'
import { deLista } from '@/lib/domain/listas'
import { listarAjustesDeBandejas } from '@/lib/bandeja/consultas'
import { estadoDeCanales } from '@/lib/bandeja/conexion'
import { Encabezado, Etiqueta, Mensaje, Pagina, Tarjeta, botonClases } from '../../../_components/ui'
import { IconoCanal } from '../../icono-canal'
import { BotonConectar, BotonVerificar, BotonWebhookCorreo } from '../botones'
import { CopiarTexto, GeneradorSecreto } from '../copiar'
import { FormAjustes } from '../form-ajustes'
import { SubNavBandeja } from '../../subnav'

/**
 * El asistente de conexión de UN canal (ADR 0044).
 *
 * Cuatro pasos y siempre el mismo orden: conseguir los datos, cargarlos,
 * conectar y verificar. Cada paso muestra su estado real —qué variable ya está
 * cargada y cuál falta— para que quien lo hace sepa en qué punto está sin
 * adivinar. Es la diferencia con una lista de variables: la lista dice QUÉ hace
 * falta; el asistente dice QUÉ FALTA y QUÉ HACER AHORA.
 */

/** Lo que hay que tener ANTES de empezar. Lo que ninguna pantalla puede conseguir por el hotel. */
const REQUISITOS: Record<CanalBandeja, string[]> = {
  whatsapp: [
    'Una cuenta de Meta Business con el hotel verificado (lo hace Meta; puede tardar días).',
    'Un número de teléfono para WhatsApp Business. Ese número no puede estar usándose en la app común de WhatsApp.',
    'Una app de Meta (tipo «Empresa») con el producto WhatsApp agregado.',
  ],
  instagram: ['Una cuenta de Instagram profesional (Empresa o Creador), no personal.', 'Una app de Meta con el producto Instagram agregado.'],
  messenger: ['La página de Facebook del hotel y una persona con rol de administrador.', 'Una app de Meta con el producto Messenger agregado.'],
  email: [
    'Una cuenta de Resend con un dominio verificado para ENVIAR.',
    'Para RECIBIR: un subdominio aparte (por ejemplo bandeja.blancapatagonia.com). Nunca el dominio principal: el registro MX de Resend reemplaza al del dominio y el hotel perdería su correo de siempre.',
  ],
  telegram: ['Hablarle a @BotFather en Telegram y crear un bot con /newbot.'],
  web: [],
}

/** Variables que inventa el hotel (no las da ningún proveedor): la pantalla las genera. */
const GENERABLES: Record<string, number> = { META_WEBHOOK_VERIFY_TOKEN: 16, TELEGRAM_WEBHOOK_SECRET: 24 }

const CON_BOTON_CONECTAR = new Set<CanalBandeja>(['whatsapp', 'instagram', 'messenger', 'telegram'])

export default async function ConectarCanalPage({ params }: { params: Promise<{ canal: string }> }) {
  const sesion = await requerirAcceso('bandeja')
  const canal = deLista(CANALES_BANDEJA, (await params).canal)
  if (!canal) notFound()

  const direccion = esDireccion(sesion.rol)
  const [estado] = estadoDeCanales([canal])
  const { datos: ajustesLista, fallo } = await listarAjustesDeBandejas()
  const ajustes = ajustesLista.find((a) => a.canal === canal)
  const integracion = estado.integracion
  const sitio = process.env.NEXT_PUBLIC_SITE_URL
  const publica = urlPublicaValida(sitio)

  const faltantes = integracion?.variables.filter((v) => !process.env[v.nombre]?.trim()) ?? []
  const urlDelWebhook = integracion?.webhook ? urlWebhook(sitio, integracion.webhook.ruta) : null

  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo={`Conectar ${ETIQUETAS_CANAL[canal]}`}
        descripcion={integracion?.paraQue ?? 'El chat de la web no necesita ninguna clave: ya funciona.'}
        icono="chat"
        acciones={
          <Link href="/panel/bandeja/conectar" className={botonClases('secundario')}>
            Todos los canales
          </Link>
        }
      />
      <SubNavBandeja direccion={direccion} />

      <div className="mb-4 flex items-center gap-3">
        <IconoCanal canal={canal} tam={44} />
        <Etiqueta tono={estado.nivel === 'conectado' || estado.nivel === 'siempre' ? 'exito' : estado.nivel === 'a_medias' ? 'alerta' : 'neutro'}>
          {estado.nivel === 'conectado' ? 'Conectado' : estado.nivel === 'siempre' ? 'Siempre activo' : estado.nivel === 'a_medias' ? 'A medias' : 'Sin conectar'}
        </Etiqueta>
      </div>

      {!direccion && <Mensaje tono="ok">Conectar un canal lo hace la dirección. Acá podés ver en qué punto está.</Mensaje>}
      {integracion?.limitacion && (
        <p className="mb-4 rounded-xl bg-lenga-50 px-4 py-3 text-sm text-lenga-900 ring-1 ring-lenga-200">⚠️ {integracion.limitacion}</p>
      )}

      <div className="space-y-5">
        {integracion && (
          <>
            <Tarjeta titulo="Antes de empezar" descripcion="Lo que tiene que estar listo del lado del proveedor. Esto no lo puede hacer el sistema por vos.">
              <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
                {REQUISITOS[canal].map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Tarjeta>

            <Tarjeta titulo="1. Conseguí estos datos" descripcion="Cada uno aparece tildado cuando ya está cargado en el sistema.">
              <ul className="space-y-3 text-sm">
                {integracion.variables.map((v) => {
                  const cargada = Boolean(process.env[v.nombre]?.trim())
                  return (
                    <li key={v.nombre} className="space-y-1">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className={cargada ? 'text-emerald-700' : v.obligatoria ? 'text-red-700' : 'text-stone-400'} aria-hidden="true">
                          {cargada ? '✓' : v.obligatoria ? '✗' : '○'}
                        </span>
                        <code className="text-xs break-all">{v.nombre}</code>
                        {!v.obligatoria && <span className="text-xs text-stone-500">({v.recomendada ? 'recomendada: simplifica la conexión' : 'opcional'})</span>}
                        <span className="sr-only">{cargada ? ' cargada' : ' falta'}</span>
                      </p>
                      <p className="pl-5 text-xs text-stone-600">{v.ayuda}</p>
                      {!cargada && GENERABLES[v.nombre] && direccion && (
                        <div className="pl-5">
                          <GeneradorSecreto variable={v.nombre} bytes={GENERABLES[v.nombre]} />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
              <div className="mt-4 border-t border-stone-100 pt-3">
                <p className="mb-1 text-xs font-medium text-stone-600">Cómo se consigue cada una</p>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-700">
                  {integracion.pasos.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ol>
              </div>
            </Tarjeta>

            <Tarjeta titulo="2. Cargalos en el sistema" descripcion="Las claves se guardan en las variables de entorno, nunca en la base de datos.">
              {faltantes.length > 0 ? (
                <div className="space-y-2 text-sm">
                  <p className="text-stone-700">Copiá este bloque, completá lo que falta y pegalo en <code>.env.local</code> (en producción, en Vercel → Settings → Environment Variables):</p>
                  <CopiarTexto bloque texto={faltantes.map((v) => `${v.nombre}=`).join('\n')} etiqueta="Copiar" />
                </div>
              ) : (
                <p className="text-sm text-emerald-800">✓ Están todas cargadas.</p>
              )}
              <p className="mt-3 text-xs text-stone-500">
                También se puede hacer desde la terminal, con preguntas una por una y probando cada clave: <code>npm run configurar</code>.
              </p>
            </Tarjeta>

            <Tarjeta titulo={CON_BOTON_CONECTAR.has(canal) || canal === 'email' ? '3. Conectar' : '3. Listo'} descripcion="El sistema le avisa al proveedor a dónde mandar los mensajes. No hace falta entrar a su panel.">
              {!publica.valida && (
                <p className="mb-3 rounded-lg bg-lenga-50 px-3 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200" role="status">
                  ⚠️ {publica.motivo}
                </p>
              )}
              {direccion ? (
                <div className="space-y-4">
                  {CON_BOTON_CONECTAR.has(canal) && <BotonConectar canal={canal} texto={canal === 'telegram' ? 'Conectar el bot' : `Conectar ${ETIQUETAS_CANAL[canal]}`} />}
                  {canal === 'email' && <BotonWebhookCorreo />}
                  <BotonVerificar canal={canal} />
                </div>
              ) : (
                <p className="text-sm text-stone-600">Pedile a la dirección que apriete «Conectar».</p>
              )}

              {urlDelWebhook && (
                <div className="mt-4 border-t border-stone-100 pt-3 text-sm">
                  <p className="mb-1 text-xs font-medium text-stone-600">Plan B: si preferís hacerlo a mano, esta es la dirección que va en el panel del proveedor</p>
                  <CopiarTexto texto={urlDelWebhook} />
                  <p className="mt-1 text-xs text-stone-500">{integracion.webhook?.nota}</p>
                </div>
              )}
            </Tarjeta>
          </>
        )}

        <Tarjeta titulo={integracion ? '4. Ajustes del canal' : 'Ajustes del canal'} descripcion="Saludo, horario de atención y asignación. Se pueden cambiar cuando quieras.">
          {fallo && <Mensaje tono="error">No se pudieron leer los ajustes. Recargá la página.</Mensaje>}
          {ajustes && direccion && <FormAjustes canal={canal} ajustes={ajustes} />}
          {ajustes && !direccion && <p className="text-sm text-stone-600">Los ajustes los cambia la dirección.</p>}
        </Tarjeta>
      </div>
    </Pagina>
  )
}
