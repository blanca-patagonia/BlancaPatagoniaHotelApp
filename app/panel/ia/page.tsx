import { requerirAcceso } from '@/lib/auth/session'
import { iaActiva } from '@/lib/ia/proveedor'
import { Encabezado, Pagina, Tarjeta } from '../_components/ui'
import { ChatIA } from './chat'

/**
 * Asistente de IA del panel: preguntas sobre ocupación, ADR, facturación,
 * reservas y satisfacción, contestadas con datos reales del sistema (ver
 * `app/panel/ia/herramientas.ts` — nunca inventa un número).
 *
 * Sin proveedor configurado, esta pantalla NO simula una respuesta: lo dice.
 * Es el mismo criterio que ya usa `config/divisas` cuando no hay cotización
 * cargada — mostrar «no hay dato» es mejor que mostrar un dato inventado.
 */
export default async function AsistenteIAPage() {
  await requerirAcceso('ia')
  const activa = iaActiva()

  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo="Asistente IA"
        descripcion="Preguntale por la ocupación, el ADR, la facturación y las reservas del hotel."
        icono="ia"
      />

      {activa ? (
        <Tarjeta className="overflow-hidden p-0">
          <ChatIA />
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
              <li>IA_BASE_URL (la URL del proveedor, por ejemplo el de NVIDIA NIM)</li>
              <li>IA_API_KEY</li>
              <li>IA_MODELO</li>
            </ul>
            <p className="text-stone-600">
              Cualquier proveedor compatible con el formato de OpenAI («chat completions» con
              herramientas) sirve — incluidos los de nivel gratuito.
            </p>
          </div>
        </Tarjeta>
      )}
    </Pagina>
  )
}
