import 'server-only'
import { HERRAMIENTAS_IA, type DefinicionHerramienta } from '@/lib/domain/ia-herramientas'

/**
 * Adapter del asistente de IA.
 *
 * ── Por qué no hay simulador ─────────────────────────────────────────────
 *
 * Los otros nueve adapters del proyecto (`PaymentProvider`, `EmailProvider`…)
 * tienen un simulador que no manda nada real pero deja recorrer la pantalla
 * en desarrollo. Acá no: un simulador de IA tendría que inventar una
 * respuesta, y una respuesta inventada sobre datos del hotel es exactamente
 * lo que este sistema evita en todos los demás módulos (el "USD 0" de la
 * Fase 18, el `precio_neto` del ADR 0016, la cotización que "no inventa" en
 * `lib/divisas`). Por eso, sin credenciales, el asistente simplemente **no
 * se ofrece** — mismo criterio que `WhatsAppProvider` (`lib/whatsapp/`), que
 * tampoco simula un envío.
 *
 * ── Por qué es genérico y no un proveedor con nombre ─────────────────────
 *
 * El hotel todavía no definió con qué modelo va a correr esto (se habló de
 * niveles gratuitos, como NVIDIA NIM). En vez de escribir un adapter atado a
 * una marca, este habla el formato **compatible con OpenAI** ("chat
 * completions" con `tools`) que exponen la gran mayoría de proveedores —
 * OpenAI, NVIDIA NIM, OpenRouter, Groq, y varios más—, así que cambiar de
 * proveedor es cambiar tres variables de entorno, no código:
 *
 *   IA_PROVIDER=openai_compatible
 *   IA_BASE_URL=https://<host del proveedor>/v1
 *   IA_API_KEY=<clave>
 *   IA_MODELO=<nombre del modelo>
 *
 * Sin SDK, por HTTP directo: mismo criterio que el resto de los adapters
 * del proyecto (`lib/payments/*`, `lib/email/resend.ts`).
 */

export type RolMensajeIa = 'system' | 'user' | 'assistant' | 'tool'

export interface LlamadaHerramienta {
  id: string
  nombre: string
  /** JSON crudo tal como lo manda el modelo — se valida al ejecutarla, no acá. */
  argumentos: string
}

export interface MensajeIa {
  rol: RolMensajeIa
  contenido: string
  /** Sólo en mensajes `assistant` que piden ejecutar herramientas. */
  llamadas?: LlamadaHerramienta[]
  /** Sólo en mensajes `tool`: a qué llamada responde. */
  idLlamada?: string
  /** Sólo en mensajes `tool`: nombre de la herramienta ejecutada. */
  nombreHerramienta?: string
}

export interface RespuestaIa {
  contenido: string | null
  llamadas: LlamadaHerramienta[]
}

export interface IaProvider {
  nombre: string
  chat(mensajes: MensajeIa[]): Promise<RespuestaIa>
}

/** Cuánto se espera a la respuesta antes de darla por caída. */
const TIEMPO_LIMITE_MS = 30_000

function aFormatoOpenAi(mensajes: MensajeIa[]) {
  return mensajes.map((m) => {
    if (m.rol === 'assistant' && m.llamadas && m.llamadas.length > 0) {
      return {
        role: 'assistant',
        content: m.contenido || null,
        tool_calls: m.llamadas.map((l) => ({
          id: l.id,
          type: 'function',
          function: { name: l.nombre, arguments: l.argumentos },
        })),
      }
    }
    if (m.rol === 'tool') {
      return { role: 'tool', tool_call_id: m.idLlamada, content: m.contenido }
    }
    return { role: m.rol, content: m.contenido }
  })
}

function herramientasOpenAi(herramientas: DefinicionHerramienta[]) {
  return herramientas.map((h) => ({
    type: 'function',
    function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
  }))
}

class ProveedorIaCompatibleOpenAI implements IaProvider {
  nombre = 'openai_compatible'

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private modelo: string,
  ) {}

  async chat(mensajes: MensajeIa[]): Promise<RespuestaIa> {
    const controlador = new AbortController()
    const corte = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS)

    try {
      const r = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelo,
          messages: aFormatoOpenAi(mensajes),
          tools: herramientasOpenAi(HERRAMIENTAS_IA),
          tool_choice: 'auto',
          max_tokens: 1024,
          temperature: 0.2,
        }),
        signal: controlador.signal,
      })

      if (!r.ok) {
        const cuerpo = await r.text().catch(() => '')
        throw new Error(`El proveedor de IA respondió ${r.status}: ${cuerpo.slice(0, 300)}`)
      }

      const datos = (await r.json()) as {
        choices?: {
          message?: {
            content?: string | null
            tool_calls?: { id: string; function: { name: string; arguments: string } }[]
          }
        }[]
      }
      const mensaje = datos.choices?.[0]?.message
      if (!mensaje) throw new Error('El proveedor de IA respondió sin ningún mensaje.')

      return {
        contenido: mensaje.content ?? null,
        llamadas: (mensaje.tool_calls ?? []).map((t) => ({
          id: t.id,
          nombre: t.function.name,
          argumentos: t.function.arguments,
        })),
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error('El proveedor de IA no respondió a tiempo.')
      }
      throw e
    } finally {
      clearTimeout(corte)
    }
  }
}

/**
 * ¿El asistente tiene con qué funcionar?
 *
 * Las cuatro variables son necesarias: sin alguna, no hay forma de armar el
 * cliente HTTP. A diferencia de los adapters "obligatorios" del ADR 0018,
 * ninguna de estas está en esa lista — el sistema arranca igual sin ellas, y
 * la pantalla del asistente lo dice en vez de fallar al arrancar.
 */
export function iaActiva(): boolean {
  return Boolean(
    process.env.IA_PROVIDER?.trim() === 'openai_compatible' &&
      process.env.IA_API_KEY?.trim() &&
      process.env.IA_BASE_URL?.trim() &&
      process.env.IA_MODELO?.trim(),
  )
}

/** Lanza si `iaActiva()` es falso: no hay ningún camino sin credenciales. */
export function obtenerProveedorIa(): IaProvider {
  if (!iaActiva()) {
    throw new Error(
      'El asistente de IA no está configurado. Faltan IA_PROVIDER=openai_compatible, ' +
        'IA_API_KEY, IA_BASE_URL o IA_MODELO.',
    )
  }
  return new ProveedorIaCompatibleOpenAI(
    process.env.IA_BASE_URL!.trim(),
    process.env.IA_API_KEY!.trim(),
    process.env.IA_MODELO!.trim(),
  )
}
