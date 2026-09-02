import 'server-only'
import { headers } from 'next/headers'

/**
 * Registro estructurado del servidor.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Hasta acá el sistema tenía ~29 `console.error` / `console.warn` sueltos, cada
 * uno con su formato. Eso funciona mientras alguien mira una terminal, y deja de
 * funcionar el día del deploy: en el log de una plataforma, con varias peticiones
 * entrelazadas, no hay forma de saber **qué líneas pertenecen al mismo pedido**.
 * Un error que aparece cinco líneas después de su causa es indistinguible de uno
 * que aparece solo.
 *
 * Esto emite **una línea JSON por evento**, con un identificador de petición
 * compartido. Con eso, buscar por `pedido` en el log de Vercel devuelve la
 * historia completa de lo que pasó en esa navegación.
 *
 * ── Por qué no es una librería ──────────────────────────────────────────────
 *
 * Porque no hace falta y `AGENTS.md` pide no sumar dependencias sin motivo. Lo
 * que un logger serio aporta —niveles, transportes, redacción de campos— acá se
 * reduce a: emitir JSON a stdout, que es lo que cualquier plataforma indexa. Si
 * algún día se contrata un servicio de observabilidad, este módulo es el único
 * lugar que hay que tocar.
 *
 * ⚠️ **Nunca pasar tokens, contraseñas ni números de tarjeta en `datos`.** El
 * proveedor de email ya tuvo ese problema: logueaba el cuerpo entero de los
 * correos, que llevan enlaces con token. `camposProhibidos` de abajo es una red,
 * no un permiso.
 */

export type Nivel = 'info' | 'aviso' | 'error'

/** Campos que nunca deben aparecer en un log, por más que alguien los pase. */
const CAMPOS_PROHIBIDOS = [
  'token',
  'password',
  'contrasena',
  'contraseña',
  'secret',
  'secreto',
  'authorization',
  'apikey',
  'api_key',
  'cvv',
  'pan',
  'tarjeta_numero',
]

/** Un valor que parece un número de tarjeta: 12+ dígitos seguidos. */
const PARECE_PAN = /\d{12,}/

/**
 * Reemplaza lo que no debe salir en un log.
 *
 * Dos capas, porque las dos fallan de formas distintas: por **nombre** de campo
 * (alguien pasa `{ token }` sin pensarlo) y por **contenido** (un mensaje de
 * error de la base que arrastra el valor). La segunda es la que salva cuando el
 * dato viene anidado en un texto libre.
 */
function limpiar(datos: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {}

  for (const [clave, valor] of Object.entries(datos)) {
    if (CAMPOS_PROHIBIDOS.some((p) => clave.toLowerCase().includes(p))) {
      salida[clave] = '[oculto]'
      continue
    }
    if (typeof valor === 'string' && PARECE_PAN.test(valor)) {
      salida[clave] = valor.replace(/\d{12,}/g, '[oculto]')
      continue
    }
    salida[clave] = valor
  }

  return salida
}

/**
 * Identificador de la petición en curso.
 *
 * Se toma de las cabeceras que ponen las plataformas (Vercel manda
 * `x-vercel-id`). Si no hay ninguna —desarrollo local, una tarea programada— se
 * devuelve `null` en vez de inventar uno: un id distinto en cada línea sería
 * peor que ninguno, porque haría creer que son peticiones distintas.
 */
async function idDePedido(): Promise<string | null> {
  try {
    const cabeceras = await headers()
    return (
      cabeceras.get('x-vercel-id') ??
      cabeceras.get('x-request-id') ??
      cabeceras.get('x-amzn-trace-id') ??
      null
    )
  } catch {
    // `headers()` lanza fuera de una petición (cron, webhook, test). No es un
    // error: simplemente no hay pedido al que asociar la línea.
    return null
  }
}

/**
 * ── El sink: además de stdout, la fila en `errores` ──────────────────────────
 *
 * Emitir JSON a stdout resuelve el formato, no el destino. En Vercel esa línea
 * queda en un buffer que nadie del hotel abre: la primera noticia de una falla
 * la sigue trayendo un huésped que se queja. La tabla `errores` (migración
 * 0068) le da un lugar donde quedarse, y el panel un lugar donde mirarla.
 *
 * Tres reglas que no se negocian:
 *
 *  1. **Nunca lanza.** Un logger que rompe la petición que estaba registrando
 *     es peor que no tener logger. Todo va envuelto y el fallo del sink se
 *     reporta por stdout, que siempre está.
 *  2. **Nunca bloquea de más.** Lleva corte por tiempo: si la base no responde,
 *     el pedido del usuario no se queda esperando a que se guarde un log.
 *  3. **Solo errores y avisos.** `info` no se persiste: sería un cañón de filas
 *     por cada navegación y la tabla dejaría de servir para lo que sirve.
 */

/** Corte del sink. Corto a propósito: es un log, no la operación. */
const SINK_MS = 2000

/**
 * El sink se apaga solo en los tests.
 *
 * Sin esto, cada test que ejercita un camino de error escribiría en la base
 * local y `errores` crecería con basura de la suite. Los tests que quieran
 * probar el sink llaman a `guardarError` directo.
 */
function sinkActivo(): boolean {
  if (process.env.VITEST) return false
  if (process.env.REGISTRO_SIN_BASE === '1') return false
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export interface ContextoError {
  pedido?: string | null
  digest?: string | null
  ruta?: string | null
  usuarioId?: string | null
  rol?: string | null
}

/**
 * Guarda una fila en `errores`. Exportada para poder probarla sin simular una
 * petición entera.
 *
 * Escribe con `service_role` porque la tabla no tiene política de INSERT: que
 * nadie pueda borrar ni falsear su propio rastro es justamente el punto.
 */
export async function guardarError(
  nivel: Exclude<Nivel, 'info'>,
  evento: string,
  datos: Record<string, unknown>,
  contexto: ContextoError = {},
): Promise<void> {
  try {
    // Import dinámico: `admin.ts` trae `server-only` y valida el entorno al
    // construirse. Cargarlo arriba haría que cualquier módulo que loguee
    // arrastre esa validación aunque el sink esté apagado.
    const { crearClienteAdmin } = await import('@/lib/supabase/admin')
    const limpios = limpiar(datos)

    // `detalle` sale de `datos.detalle` si está; es la convención que ya usan
    // `cortarSiFalla` y `registrarFalla`.
    const detalle = typeof limpios.detalle === 'string' ? limpios.detalle : null

    const escritura = crearClienteAdmin()
      .from('errores')
      .insert({
        evento,
        nivel,
        detalle,
        pedido: contexto.pedido ?? null,
        digest: contexto.digest ?? null,
        ruta: contexto.ruta ?? null,
        usuario_id: contexto.usuarioId ?? null,
        rol: contexto.rol ?? null,
        datos: limpios,
      })

    const corte = new Promise<{ error: { message: string } | null }>((resolver) =>
      setTimeout(() => resolver({ error: { message: `el sink no respondió en ${SINK_MS} ms` } }), SINK_MS),
    )

    const { error } = await Promise.race([escritura, corte])

    // Si el sink falla, se dice por stdout y se sigue. No se reintenta: un
    // reintento sobre una base caída multiplica el problema que lo causó.
    if (error) console.error(`{"nivel":"error","evento":"sink_errores_fallo","detalle":${JSON.stringify(error.message)}}`)
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error(`{"nivel":"error","evento":"sink_errores_fallo","detalle":${JSON.stringify(motivo)}}`)
  }
}

/** Emite una línea JSON. Nunca lanza: un log que rompe la operación es peor. */
async function emitir(
  nivel: Nivel,
  evento: string,
  datos: Record<string, unknown>,
  contexto: ContextoError = {},
): Promise<void> {
  const pedido = contexto.pedido ?? (await idDePedido())

  try {
    const linea = JSON.stringify({
      nivel,
      evento,
      pedido,
      en: new Date().toISOString(),
      ...limpiar(datos),
    })
    if (nivel === 'error') console.error(linea)
    else if (nivel === 'aviso') console.warn(linea)
    else console.info(linea)
  } catch {
    // Si ni siquiera se pudo serializar, se cae al formato mínimo antes que
    // perder el evento.
    console.error(`{"nivel":"error","evento":"${evento}","detalle":"no se pudo serializar el log"}`)
  }

  // El stdout va primero y el sink después, a propósito: si la base es
  // justamente lo que está fallando, la línea ya salió.
  if (nivel !== 'info' && sinkActivo()) {
    await guardarError(nivel, evento, datos, { ...contexto, pedido })
  }
}

/** Solo a stdout: `info` no se persiste (ver el comentario del sink). */
export async function registrarInfo(
  evento: string,
  datos: Record<string, unknown> = {},
): Promise<void> {
  await emitir('info', evento, datos)
}

export async function registrarAviso(
  evento: string,
  datos: Record<string, unknown> = {},
  contexto: ContextoError = {},
): Promise<void> {
  await emitir('aviso', evento, datos, contexto)
}

export async function registrarError(
  evento: string,
  datos: Record<string, unknown> = {},
  contexto: ContextoError = {},
): Promise<void> {
  await emitir('error', evento, datos, contexto)
}

/**
 * Variante **síncrona**, sin id de petición.
 *
 * ── Por qué existe, teniendo `registrarError` ───────────────────────────────
 *
 * `cortarSiFalla` de `lib/acciones.ts` tiene que ser síncrona: lanza (vía
 * `redirect`) para **detener** la Server Action. Si fuera `async` y alguien
 * olvidara un `await`, el redirect no ocurriría y la acción seguiría como si nada
 * —un bug mucho peor que el que se estaba registrando—.
 *
 * Como `headers()` es asíncrono en Next 16, una función síncrona no puede leer el
 * id de la petición. Se emite sin él y se acepta: la plataforma ya agrupa las
 * líneas por invocación en su propio log, así que la correlación no se pierde del
 * todo. Lo que sí se conserva es el formato JSON y el ocultamiento de datos
 * sensibles, que es lo que más importa.
 *
 * Para todo lo demás va `registrarError`, que sí correlaciona.
 */
export function registrarErrorSync(evento: string, datos: Record<string, unknown> = {}): void {
  try {
    console.error(
      JSON.stringify({
        nivel: 'error',
        evento,
        pedido: null,
        en: new Date().toISOString(),
        ...limpiar(datos),
      }),
    )
  } catch {
    console.error(`{"nivel":"error","evento":"${evento}","detalle":"no se pudo serializar el log"}`)
  }

  if (!sinkActivo()) return

  /*
    El sink desde una función síncrona, sin poder esperarlo.

    Quien llama a esto está por lanzar un `redirect()`, así que la petición
    termina enseguida. En un servidor de siempre la promesa igual se completa;
    en una función serverless, el runtime puede cortar el proceso apenas
    responde y la escritura se perdería.

    `after()` es exactamente el mecanismo que Next da para esto: registra
    trabajo para después de enviar la respuesta, y la plataforma mantiene la
    invocación viva hasta que termine. Fuera de una petición (cron, webhook,
    test) `after()` lanza, y ahí se cae a dispararlo y soltarlo, que es lo mejor
    disponible en ese contexto.
  */
  const escritura = () => guardarError('error', evento, datos)

  import('next/server')
    .then(({ after }) => {
      try {
        after(escritura())
      } catch {
        void escritura()
      }
    })
    .catch(() => {
      void escritura()
    })
}
