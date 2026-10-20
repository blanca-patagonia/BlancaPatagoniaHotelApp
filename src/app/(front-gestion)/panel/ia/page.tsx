import { requerirAcceso } from '@/lib/auth/session'
import Link from 'next/link'
import { diagnosticarProveedores, iaActiva, type EstadoEslabon } from '@/lib/ia/proveedor'
import { preguntasSugeridas } from '@/lib/domain/ia-prompt'
import { Encabezado, Mensaje, Pagina, Tarjeta, botonClases } from '../_components/ui'
import { ChatIA } from './chat'

/**
 * Asistente de IA del panel: preguntas sobre ocupación, ADR, facturación,
 * reservas y satisfacción, contestadas con datos reales del sistema (ver
 * `app/panel/ia/herramientas/` — nunca inventa un número).
 *
 * Sin proveedor configurado, esta pantalla NO simula una respuesta: lo dice.
 * Es el mismo criterio que ya usa `config/divisas` cuando no hay cotización
 * cargada — mostrar «no hay dato» es mejor que mostrar un dato inventado.
 */
export default async function AsistenteIAPage({
  searchParams,
}: {
  searchParams: Promise<{ pregunta?: string; diagnostico?: string }>
}) {
  const sesion = await requerirAcceso('ia')
  // «Analizar con IA» de los informes llega con la pregunta armada: se carga en
  // el campo y la persona decide si mandarla (cada consulta gasta cupo).
  const { pregunta, diagnostico } = await searchParams
  const preguntaInicial = (pregunta ?? '').slice(0, 300)
  const activa = iaActiva()
  /*
    El diagnóstico llama a cada proveedor (sin gastar cupo de chat): sólo se
    corre cuando un admin lo pide, no en cada visita.
  */
  const esAdmin = sesion.rol === 'admin'
  const eslabones = esAdmin && activa && diagnostico === '1' ? await diagnosticarProveedores() : null

  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo="Asistente IA"
        descripcion="Analiza los datos del hotel, responde dudas y te prepara casi cualquier tarea —reservas, check-in y check-out, cancelaciones, mudanzas, facturas, huéspedes, consumos, limpieza, avisos— que se hace recién cuando la confirmás. Los cobros se registran en la ficha de la reserva."
        icono="ia"
      />

      {esAdmin && activa && (
        <div className="mb-4 flex justify-end">
          <Link href="/panel/ia?diagnostico=1" className={botonClases('secundario')}>
            Probar la conexión con los proveedores
          </Link>
        </div>
      )}
      {eslabones && <Diagnostico eslabones={eslabones} />}

      {activa ? (
        <Tarjeta className="overflow-hidden p-0">
          <ChatIA preguntaInicial={preguntaInicial} sugerencias={preguntasSugeridas(sesion.rol)} />
        </Tarjeta>
      ) : (
        <Tarjeta titulo="Todavía no está configurado">
          <div className="flex flex-col gap-3 p-5 text-sm text-stone-700">
            <p className="rounded-lg bg-lenga-50 px-4 py-2 text-lenga-900 ring-1 ring-lenga-200">
              El asistente necesita un proveedor de IA enchufado por variable de entorno. Sin eso,
              esta pantalla no va a inventar una respuesta.
            </p>
            <p>Hacen falta las cuatro, en el entorno del servidor:</p>
            <ul className="list-inside list-disc space-y-1 font-mono text-xs text-stone-600">
              <li>IA_PROVIDER=openai_compatible</li>
              <li>IA_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai</li>
              <li>IA_API_KEY=(la clave de Google AI Studio)</li>
              <li>IA_MODELO=gemini-2.5-flash</li>
            </ul>
            <p className="text-stone-600">
              Los valores de arriba son los de Gemini. Sirve también cualquier otro proveedor
              compatible con el formato de OpenAI («chat completions» con herramientas). Después
              de cargarlas hay que reiniciar el servidor. Paso a paso en `COMO-LEVANTARLO.md`.
            </p>
          </div>
        </Tarjeta>
      )}
    </Pagina>
  )
}

const ETIQUETA_ESTADO: Record<EstadoEslabon['estado'], string> = {
  ok: 'Funciona',
  modelo_inexistente: 'El modelo no existe',
  clave_invalida: 'Clave inválida',
  sin_cupo: 'Sin cupo por ahora',
  error: 'No responde',
}

/**
 * Resultado del diagnóstico: un renglón por eslabón de la cadena (principal y
 * respaldos), y la lista de modelos disponibles cuando el configurado no existe.
 * Nunca muestra claves.
 */
function Diagnostico({ eslabones }: { eslabones: EstadoEslabon[] }) {
  return (
    <Tarjeta titulo="Conexión con los proveedores de IA" className="mb-4">
      <div className="flex flex-col gap-4 p-5 text-sm">
        {eslabones.map((e) => (
          <div key={e.posicion} className="flex flex-col gap-1.5">
            <p className="font-medium text-stone-800">
              {e.posicion === 'principal' ? 'Principal' : e.posicion.replace('respaldo', 'Respaldo')} ·{' '}
              <span className="font-mono text-xs">{e.host}</span> ·{' '}
              <span className="font-mono text-xs">{e.modelo}</span>
            </p>
            <Mensaje tono={e.estado === 'ok' ? 'ok' : 'error'}>
              {ETIQUETA_ESTADO[e.estado]}. {e.detalle}
            </Mensaje>
            {e.estado === 'modelo_inexistente' && e.disponibles.length > 0 && (
              <p className="text-xs text-stone-600">
                Disponibles: <span className="font-mono">{e.disponibles.join(' · ')}</span>
              </p>
            )}
          </div>
        ))}
      </div>
    </Tarjeta>
  )
}
