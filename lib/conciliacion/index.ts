import 'server-only'

/**
 * `ExtractoProvider` — el puerto por donde entran los movimientos de dinero
 * reales, para poder contrastarlos contra lo que el sistema dice que cobró.
 *
 * Octavo adapter del proyecto, con el mismo patrón que los siete anteriores:
 * interfaz estable + implementaciones que se eligen por variable de entorno.
 *
 * ── La diferencia con los otros siete ───────────────────────────────────────
 *
 * Acá **no todas las fuentes son API**, y eso está declarado en el tipo en vez de
 * escondido:
 *
 *  · **MercadoPago sí tiene API pública de reportes** (`/v1/account/settlement_report`,
 *    documentada, con el mismo access token que ya usa el cobro). Se puede pedir el
 *    reporte de liquidaciones de un período y traerlo solo.
 *  · **Santander Argentina no.** No hay banca abierta obligatoria en el país y el
 *    banco no publica una API de movimientos para clientes: el camino real es
 *    exportar el extracto desde el Home Banking y subirlo. Por eso el proveedor de
 *    banco declara `puedeConsultar: false` y sólo acepta archivos.
 *
 * Un puerto que fingiera que las dos fuentes son iguales llevaría a que alguien
 * espere que el extracto del banco «se actualice solo», y a que el día que no
 * aparezca un movimiento nadie sepa si falló la conexión o si nadie subió el
 * archivo. `capacidades()` es la misma solución que ya usan canales y pagos.
 *
 * ⚠️ **Nunca se raspa el home banking.** Guardar la clave del banco del hotel para
 * automatizar la descarga sería a la vez una violación de los términos del banco y
 * el peor secreto que este sistema podría almacenar. Si el hotel contrata un
 * agregador bancario con API, se escribe otra implementación de este puerto.
 */

import type { MovimientoExterno, OrigenMovimiento } from '@/lib/domain/conciliacion'

/** Qué sabe hacer una fuente de movimientos. Se declara, no se supone. */
export interface CapacidadesExtracto {
  /** Puede traer movimientos sola, sin que nadie suba un archivo. */
  puedeConsultar: boolean
  /** Acepta un archivo exportado a mano. */
  aceptaArchivo: boolean
  /** Para mostrar en pantalla: cómo llegan los datos de esta fuente. */
  comoLlegan: string
}

export interface PeriodoConsulta {
  /** `YYYY-MM-DD`, inclusive. */
  desde: string
  /** `YYYY-MM-DD`, inclusive. */
  hasta: string
}

export interface ResultadoExtracto {
  ok: boolean
  movimientos: MovimientoExterno[]
  /**
   * La fuente no puede hacer esto, y no es una falla.
   *
   * Distingue «el banco no tiene API» de «la API del banco no respondió». Sin esta
   * separación, la pantalla mostraría un error rojo permanente sobre algo que
   * funciona exactamente como tiene que funcionar. Es la misma distinción que
   * `ResultadoEnvio.noSoportado` en canales (ADR 0021).
   */
  noSoportado?: boolean
  error?: string
}

export interface ExtractoProvider {
  nombre: string
  origen: OrigenMovimiento
  capacidades(): CapacidadesExtracto
  /** Trae los movimientos del período. */
  consultar(periodo: PeriodoConsulta): Promise<ResultadoExtracto>
  /** ¿Está hablando con la fuente de verdad? */
  esReal(): boolean
}

/* ────────────────────────────────────────────── el banco, por archivo ──── */

/**
 * Proveedor de extracto bancario.
 *
 * No es un simulador: es la implementación **real y única** disponible para un
 * banco que no publica API. No inventa movimientos ni devuelve éxito falso —
 * `consultar` responde `noSoportado`, que es la verdad—; los datos entran por
 * `leerExtracto` desde el archivo que sube una persona.
 */
export class ProveedorExtractoArchivo implements ExtractoProvider {
  nombre = 'archivo'
  origen: OrigenMovimiento = 'banco'

  capacidades(): CapacidadesExtracto {
    return {
      puedeConsultar: false,
      aceptaArchivo: true,
      comoLlegan:
        'Subiendo el extracto que se exporta del Home Banking. El banco no publica una API de movimientos para clientes, así que este paso es manual.',
    }
  }

  async consultar(): Promise<ResultadoExtracto> {
    return {
      ok: false,
      movimientos: [],
      noSoportado: true,
      error:
        'El banco no ofrece consulta automática de movimientos. Exportá el extracto desde el Home Banking y subilo.',
    }
  }

  esReal(): boolean {
    // Los datos que entran por acá son los del extracto real del hotel. Lo que no
    // hay es conexión; eso ya lo dice `capacidades()`.
    return true
  }
}

/* ─────────────────────────────────────────────────── qué fuentes hay ──── */

/**
 * Las fuentes disponibles, en el orden en que se muestran.
 *
 * ── Por qué NO hay una variable `EXTRACTO_PROVIDER` ────────────────────────
 *
 * Los otros siete adaptadores eligen **uno** por variable de entorno, y
 * `seleccionarProveedor` hace fallar el arranque en producción si falta (ADR
 * 0018). Acá las dos cosas estarían mal:
 *
 * 1. **No se elige una fuente: se usan las dos a la vez.** El hotel tiene una
 *    cuenta en el banco y otra en MercadoPago, y la conciliación necesita las dos
 *    para cerrar. Es la misma situación que `PAGO_PROVIDER`, que por eso es plural.
 * 2. **El respaldo no es un simulador que miente.** `archivo` es la implementación
 *    real y única para un banco que no publica API: declara que no puede consultar
 *    y no inventa movimientos. Hacer fallar el arranque de producción por una
 *    variable cuyo valor por omisión es correcto sería una molestia sin ninguna
 *    protección a cambio.
 *
 * MercadoPago aparece **solo si hay credencial**, y es la misma que ya usa el
 * cobro: enchufar la conciliación no pide una credencial nueva. Cuando falta, la
 * pantalla puede decir «falta configurar MercadoPago» en vez de mostrar un error
 * de red que no explica nada.
 */
export function fuentesDeExtracto(
  extra: readonly ExtractoProvider[] = [],
): ExtractoProvider[] {
  return [new ProveedorExtractoArchivo(), ...extra]
}
