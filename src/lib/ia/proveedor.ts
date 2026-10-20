import 'server-only'
import type { DefinicionHerramienta } from '@/lib/domain/ia-herramientas'
import { registrarErrorSync, registrarInfo } from '@/lib/registro'

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
 * **Gemini (Google AI Studio)** expone ese mismo formato, así que se enchufa
 * sin código: `IA_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`
 * y un modelo como `gemini-2.5-flash`. Lo único propio de Gemini es la
 * «firma de razonamiento» de los modelos 3.x: viaja en `extra_content` de cada
 * pedido de herramienta y hay que devolverla tal cual en la vuelta siguiente,
 * o el proveedor rechaza la conversación. Ver `extra` en `LlamadaHerramienta`.
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
  /**
   * Datos opacos del proveedor que acompañan al pedido (`extra_content`), que
   * hay que devolverle sin tocar en la vuelta siguiente. Hoy los usa Gemini 3
   * para su `thought_signature`; sin devolverla, responde 400 y el asistente
   * no puede terminar ninguna consulta que use una herramienta.
   */
  extra?: Record<string, unknown>
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
  /** `herramientas`: las que el rol de quien pregunta puede usar (`herramientasPara`). */
  chat(mensajes: MensajeIa[], herramientas: DefinicionHerramienta[]): Promise<RespuestaIa>
}

/** Cuánto se espera a la respuesta antes de darla por caída. */
const TIEMPO_LIMITE_MS = 30_000

/**
 * Respuestas que significan «ahora no, probá en un rato»: cupo agotado (429) o
 * servicio saturado (503, «high demand» en Gemini, muy común en el plan
 * gratuito). Se reintenta una vez tras una pausa corta: la mayoría se resuelve
 * sola en segundos y la persona no tiene por qué ver un error por eso.
 */
const ESTADOS_TRANSITORIOS = new Set([429, 500, 502, 503, 504])
const PAUSA_REINTENTO_MS = 1_500

/**
 * Tope de la salida del modelo.
 *
 * Estaba en 1024 y las respuestas largas (un análisis del mes) llegaban
 * cortadas a la mitad: los modelos que razonan antes de contestar —Gemini 2.5 y
 * siguientes— descuentan ese razonamiento del mismo tope, y lo que queda para el
 * texto visible es mucho menos. El costo real lo pone lo que se genera, no el
 * tope, así que subirlo no encarece las respuestas cortas.
 */
const MAX_TOKENS = 8192

/** Se agrega a una respuesta que el proveedor cortó por largo, para que no pase por completa. */
export const AVISO_CORTADA =
  '(La respuesta quedó cortada por lo larga. Pedime un resumen más corto o una parte por vez.)'

/**
 * El proveedor está saturado o sin cupo: no es un error del sistema ni de la
 * configuración. La ruta del chat lo distingue para decirlo así.
 */
export class IaNoDisponible extends Error {
  constructor(
    mensaje: string,
    /**
     * `cupo`: se agotó la cuota del plan (429) — se resuelve esperando a que se
     * renueve, o con un plan pago / un modelo de respaldo con cuota propia.
     * `saturado`: el proveedor está con mucha demanda (5xx) — pasa solo.
     */
    readonly motivo: 'cupo' | 'saturado' = 'saturado',
  ) {
    super(mensaje)
  }
}

function aFormatoOpenAi(mensajes: MensajeIa[], reenviarExtra: boolean) {
  return mensajes.map((m) => {
    if (m.rol === 'assistant' && m.llamadas && m.llamadas.length > 0) {
      return {
        role: 'assistant',
        content: m.contenido || null,
        tool_calls: m.llamadas.map((l) => ({
          id: l.id,
          type: 'function',
          function: { name: l.nombre, arguments: l.argumentos },
          // Sólo al proveedor que la generó: es un campo propio de Gemini, y otro
          // proveedor de la cadena de respaldo podría rechazar el pedido por él.
          ...(l.extra && reenviarExtra ? { extra_content: l.extra } : {}),
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
    /**
     * El siguiente eslabón de la cadena de respaldo, o `null` si es el último.
     *
     * Orden: el modelo principal → otro modelo del mismo proveedor
     * (`IA_MODELO_RESPALDO`) → otro PROVEEDOR (`IA_RESPALDO_*`, por ejemplo
     * Groq). En el plan gratuito, quedarse sin cupo o sin servicio es lo normal
     * y no la excepción; con dos proveedores distintos, que fallen los dos a la
     * vez es mucho menos probable.
     */
    private siguiente: ProveedorIaCompatibleOpenAI | null = null,
  ) {}

  /** Gemini 3 exige que se le devuelva su `extra_content`; los demás no lo conocen. */
  private get esGemini(): boolean {
    return this.baseUrl.includes('generativelanguage.googleapis.com')
  }

  /** Pasa al siguiente eslabón, dejando constancia de por qué. */
  /** Para el diagnóstico: el host, el modelo y la clave de este eslabón. */
  get configuracion() {
    return { baseUrl: this.baseUrl, apiKey: this.apiKey, modelo: this.modelo }
  }

  /** El eslabón siguiente, para recorrer la cadena en el diagnóstico. */
  get proximo(): ProveedorIaCompatibleOpenAI | null {
    return this.siguiente
  }

  private async alSiguiente(
    mensajes: MensajeIa[],
    herramientas: DefinicionHerramienta[],
    motivo: string,
  ): Promise<RespuestaIa> {
    await registrarInfo('ia_respaldo_usado', { desde: this.modelo, hacia: this.siguiente!.modelo, motivo })
    return this.siguiente!.chat(mensajes, herramientas)
  }

  async chat(
    mensajes: MensajeIa[],
    herramientas: DefinicionHerramienta[],
    intento = 1,
  ): Promise<RespuestaIa> {
    const controlador = new AbortController()
    const corte = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS)

    let r: Response
    try {
      r = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelo,
          messages: aFormatoOpenAi(mensajes, this.esGemini),
          // Sin herramientas no se manda `tools` vacío: varios proveedores lo rechazan.
          ...(herramientas.length > 0
            ? { tools: herramientasOpenAi(herramientas), tool_choice: 'auto' }
            : {}),
          max_tokens: MAX_TOKENS,
          temperature: 0.2,
        }),
        signal: controlador.signal,
      })
    } catch (e) {
      // Sin respuesta (tiempo agotado o red caída): el siguiente eslabón, si hay.
      const motivo = e instanceof Error && e.name === 'AbortError' ? 'sin respuesta a tiempo' : 'error de red'
      if (this.siguiente) return this.alSiguiente(mensajes, herramientas, motivo)
      throw new IaNoDisponible(`El proveedor de IA no respondió (${motivo}).`, 'saturado')
    } finally {
      clearTimeout(corte)
    }

    if (!r.ok) {
      const cuerpo = await r.text().catch(() => '')
      const transitorio = ESTADOS_TRANSITORIOS.has(r.status)
      // Saturación o cupo: un reintento corto suele alcanzar.
      if (transitorio && intento === 1) {
        await new Promise((listo) => setTimeout(listo, PAUSA_REINTENTO_MS))
        return this.chat(mensajes, herramientas, 2)
      }
      /*
        Cualquier otra falla también pasa al siguiente eslabón —una clave
        vencida (401) o un pedido que este proveedor no acepta (400)—: mejor
        una respuesta del respaldo que ninguna. Queda registrado en
        `ia_respaldo_usado`, así una clave rota no pasa inadvertida.
      */
      if (this.siguiente) {
        // Con el detalle del proveedor (sin claves): «404» solo no dice si es el
        // modelo, la URL o la cuenta.
        return this.alSiguiente(mensajes, herramientas, `respondió ${r.status}: ${sinClaves(cuerpo).slice(0, 200)}`)
      }
      if (transitorio) {
        throw new IaNoDisponible(
          `El proveedor de IA respondió ${r.status}: ${sinClaves(cuerpo).slice(0, 300)}`,
          r.status === 429 ? 'cupo' : 'saturado',
        )
      }
      throw new Error(`El proveedor de IA respondió ${r.status}: ${sinClaves(cuerpo).slice(0, 300)}`)
    }

    const datos = (await r.json()) as {
      choices?: {
        finish_reason?: string
        message?: {
          content?: string | null
          tool_calls?: {
            id: string
            function: { name: string; arguments: string }
            extra_content?: Record<string, unknown>
          }[]
        }
      }[]
    }
    const mensaje = datos.choices?.[0]?.message
    if (!mensaje) throw new Error('El proveedor de IA respondió sin ningún mensaje.')

    const cortada = datos.choices?.[0]?.finish_reason === 'length'
    return {
      contenido: cortada
        ? `${mensaje.content ?? ''}\n\n${AVISO_CORTADA}`.trim()
        : (mensaje.content ?? null),
      llamadas: (mensaje.tool_calls ?? []).map((t) => ({
        id: t.id,
        nombre: t.function.name,
        argumentos: t.function.arguments,
        ...(t.extra_content ? { extra: t.extra_content } : {}),
      })),
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
  const baseUrl = process.env.IA_BASE_URL!.trim()
  const apiKey = process.env.IA_API_KEY!.trim()
  const modelo = process.env.IA_MODELO!.trim()

  // La cadena se arma de atrás para adelante: primero el último eslabón.
  const otroProveedor = proveedorDeRespaldo()
  const modeloRespaldo = nombreDeModelo('IA_MODELO_RESPALDO')
  const mismoProveedor =
    modeloRespaldo && modeloRespaldo !== modelo
      ? new ProveedorIaCompatibleOpenAI(baseUrl, apiKey, modeloRespaldo, otroProveedor)
      : otroProveedor
  return new ProveedorIaCompatibleOpenAI(baseUrl, apiKey, modelo, mismoProveedor)
}

/**
 * Proveedor de respaldo, de OTRA empresa (por ejemplo Groq), o `null`.
 *
 * Hacen falta las tres variables; con una sola a medias se ignora, en vez de
 * armar un respaldo que va a fallar justo cuando se lo necesite:
 *
 *   IA_RESPALDO_BASE_URL=https://api.groq.com/openai/v1
 *   IA_RESPALDO_API_KEY=<clave de console.groq.com>
 *   IA_RESPALDO_MODELO=openai/gpt-oss-120b
 */
function proveedorDeRespaldo(): ProveedorIaCompatibleOpenAI | null {
  const baseUrl = process.env.IA_RESPALDO_BASE_URL?.trim()
  const apiKey = process.env.IA_RESPALDO_API_KEY?.trim()
  const modelo = nombreDeModelo('IA_RESPALDO_MODELO')
  return baseUrl && apiKey && modelo ? new ProveedorIaCompatibleOpenAI(baseUrl, apiKey, modelo) : null
}

/**
 * ¿Parece una clave y no el nombre de un modelo?
 *
 * Pasó de verdad: una clave de Groq pegada en `IA_MODELO_RESPALDO`. Usada como
 * nombre de modelo, la clave viajaría a OTRO proveedor dentro del pedido, y
 * volvería en su mensaje de error («model gsk_… not found»), que se guarda en la
 * tabla de errores y además se anota en `ia_respaldo_usado`. Un nombre de modelo
 * es corto y legible (`gemini-2.5-flash`, `openai/gpt-oss-120b`,
 * `openai/gpt-oss-120b`); una clave tiene un prefijo conocido o es una tira larga
 * sin separadores.
 */
export function pareceClave(valor: string): boolean {
  if (/^(gsk_|sk-|sk_|AIza|AQ\.|xai-|ghp_|re_|whsec_)/.test(valor)) return true
  return valor.length > 60 || (valor.length >= 30 && !/[-./:]/.test(valor))
}

/**
 * El nombre de modelo de una variable opcional, o `null` si está vacía o si lo
 * que tiene parece una clave. En ese caso se ignora —nunca se manda ni se
 * registra el valor— y queda constancia de QUÉ variable revisar.
 */
function nombreDeModelo(variable: string): string | null {
  const valor = process.env[variable]?.trim()
  if (!valor) return null
  if (pareceClave(valor)) {
    registrarErrorSync('ia_configuracion_invalida', {
      variable,
      motivo: 'Tiene una clave en vez del nombre de un modelo. Se ignora; corregí .env.local.',
    })
    return null
  }
  return valor
}

/**
 * Tapa cualquier cosa con forma de clave en un texto que se va a registrar.
 * Los proveedores a veces repiten en el error lo que recibieron (un nombre de
 * modelo que en realidad era una clave, un encabezado), y ese texto termina en
 * la tabla `errores`, que lee la dirección del hotel.
 */
export function sinClaves(texto: string): string {
  return texto.replace(/(gsk_|sk-|sk_|AIza|AQ\.|xai-)[A-Za-z0-9_.-]{8,}/g, '[clave]')
}

/* ────────────────────────────────────────────────────── diagnóstico ── */

export interface EstadoEslabon {
  /** `principal`, `respaldo 1`, `respaldo 2`… */
  posicion: string
  host: string
  modelo: string
  estado: 'ok' | 'modelo_inexistente' | 'clave_invalida' | 'sin_cupo' | 'error'
  detalle: string
  /** Modelos de chat que ofrece ese proveedor con esa clave (para elegir uno que exista). */
  disponibles: string[]
}

/**
 * Prueba cada eslabón de la cadena: lista los modelos del proveedor con su
 * clave y verifica que el configurado exista. No manda ninguna conversación
 * (no gasta cupo de chat) y nunca devuelve la clave.
 *
 * Existe porque un modelo mal escrito o retirado no se nota hasta que el
 * principal falla y el respaldo —el que se necesitaba— resulta no servir.
 */
export async function diagnosticarProveedores(): Promise<EstadoEslabon[]> {
  if (!iaActiva()) return []
  const resultados: EstadoEslabon[] = []
  let eslabon: ProveedorIaCompatibleOpenAI | null = obtenerProveedorIa() as ProveedorIaCompatibleOpenAI
  let i = 0
  while (eslabon) {
    const { baseUrl, apiKey, modelo } = eslabon.configuracion
    const posicion = i === 0 ? 'principal' : `respaldo ${i}`
    const host = new URL(baseUrl).host
    try {
      const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!r.ok) {
        const cuerpo = sinClaves(await r.text().catch(() => '')).slice(0, 200)
        resultados.push({
          posicion,
          host,
          modelo,
          estado: r.status === 401 || r.status === 403 ? 'clave_invalida' : r.status === 429 ? 'sin_cupo' : 'error',
          detalle: `Respondió ${r.status}. ${cuerpo}`,
          disponibles: [],
        })
      } else {
        const datos = (await r.json()) as { data?: { id: string }[] }
        // Gemini antepone `models/` a los ids; el nombre que se configura no lo lleva.
        const ids = (datos.data ?? []).map((m) => m.id.replace(/^models\//, ''))
        const deChat = ids.filter((id) => !/(embed|tts|image|audio|whisper|guard|imagen|veo|live)/i.test(id)).sort()
        const existe = ids.includes(modelo)
        if (!existe) {
          resultados.push({
            posicion,
            host,
            modelo,
            estado: 'modelo_inexistente',
            detalle: 'La clave funciona, pero ese modelo no está en la lista: elegí uno de los disponibles.',
            disponibles: deChat.slice(0, 40),
          })
        } else {
          /*
            Estar en la lista NO alcanza: Gemini lista modelos que ya no acepta
            para cuentas nuevas («no longer available to new users») y responde
            404 recién al usarlos. Se prueba con un pedido mínimo, de un mensaje
            de una palabra: cuesta casi nada de cupo y dice la verdad.
          */
          const prueba = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: modelo, messages: [{ role: 'user', content: 'ok' }], max_tokens: 16 }),
            signal: AbortSignal.timeout(20_000),
          })
          const cuerpo = prueba.ok ? '' : sinClaves(await prueba.text().catch(() => '')).slice(0, 240)
          resultados.push({
            posicion,
            host,
            modelo,
            estado: prueba.ok
              ? 'ok'
              : prueba.status === 429
                ? 'sin_cupo'
                : prueba.status === 404
                  ? 'modelo_inexistente'
                  : prueba.status === 401 || prueba.status === 403
                    ? 'clave_invalida'
                    : 'error',
            detalle: prueba.ok
              ? 'La clave funciona, el modelo existe y respondió a una prueba.'
              : `El modelo está en la lista pero no respondió (${prueba.status}). ${cuerpo}`,
            disponibles: prueba.status === 404 ? deChat.slice(0, 40) : [],
          })
        }
      }
    } catch (e) {
      resultados.push({
        posicion,
        host,
        modelo,
        estado: 'error',
        detalle: e instanceof Error ? sinClaves(e.message) : 'No respondió.',
        disponibles: [],
      })
    }
    eslabon = eslabon.proximo
    i++
  }
  return resultados
}
