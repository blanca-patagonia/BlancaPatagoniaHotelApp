/**
 * ARI — *Availability, Rates and Inventory*: lo que el hotel le **publica** a un
 * canal de venta (lógica pura).
 *
 * ── Qué problema resuelve ───────────────────────────────────────────────────
 *
 * Todo lo que el sistema hace con canales hasta hoy es de **entrada**: importar el
 * informe del extranet, leer un feed iCal, convertir una entrante en reserva. El
 * puerto `CanalVentaProvider` declara un método de salida —`publicarDisponibilidad`—
 * desde la modernización WinPAX, y **nunca tuvo un solo llamador** (auditoría
 * 2026-09, P1-1). O sea: el ADR 0021 promete que enchufar un channel manager es
 * configuración, y no lo era.
 *
 * Este módulo es la mitad pura de esa promesa: dado lo ocupado, lo que hay y las
 * tarifas, calcula **qué habría que publicarle al canal cada día**.
 *
 * ⚠️ **Calcular no es publicar, y publicar no evita el overbooking por sí solo.**
 * Los dos caminos disponibles sin ser Connectivity Partner —el informe CSV y el
 * feed iCal— siguen siendo de solo lectura, así que hoy estas filas se calculan y
 * el proveedor responde `noSoportado`. Eso **no es un error**: es la verdad, y se
 * registra como tal. El día que el hotel contrate un channel manager, lo único que
 * falta es su adapter. Ver ADR 0021 y ADR 0032.
 *
 * ── Las tres decisiones que fija ────────────────────────────────────────────
 *
 * 1. **Se publica el precio RACK con IVA**, no el neto de agencia. Es el precio
 *    que paga el huésped, y es el mismo que muestra el sitio del hotel: publicar
 *    el neto en una OTA rompería la paridad tarifaria que los propios contratos
 *    de OTA exigen, y además le regalaría al canal el margen de la comisión.
 * 2. **El cupo que se publica puede ser menor que el real.** `topeCupo` permite
 *    reservarse unidades para la venta directa. Un hotel que publica todo su
 *    inventario en una OTA queda sin nada que vender por teléfono en temporada.
 * 3. **Cupo cero se publica como cerrado, no se omite.** Omitir un día deja al
 *    canal con el valor anterior, que es justamente el que hay que corregir.
 */

import { diasEntre, listaDias } from '@/lib/fechas'

/* ─────────────────────────────────────────────────────────── entradas ──── */

/** Una estadía, reducida a lo que el cálculo necesita. */
export interface EstadiaOcupada {
  unidadId: string
  tipoUnidadId: string
  checkIn: string
  checkOut: string
}

/** Cómo se le publica un tipo de unidad a un canal. */
export interface MapeoTipo {
  tipoUnidadId: string
  /** Código con el que ese canal conoce a este tipo. Puede no ser el nuestro. */
  codigoCanal: string
  /** Unidades activas del tipo, hoy. */
  unidadesActivas: number
  /**
   * Tope de unidades a publicar. `null` = todas.
   *
   * Es lo que permite reservarse inventario para la venta directa.
   */
  topeCupo: number | null
  /** Estancia mínima que el hotel impone en ese tipo. `null` = sin mínimo. */
  minimoNoches: number | null
  /** El hotel cerró la venta de este tipo en el canal, sin importar el cupo. */
  cerrado: boolean
}

/** Precio por noche de un tipo, ya resuelto para una fecha. */
export interface PrecioDelDia {
  tipoUnidadId: string
  fecha: string
  /** Precio al público **con IVA**, en la moneda del canal. */
  precio: number
}

/**
 * Una restricción por fecha (migración 0087).
 *
 * ── Por qué existe, además de la del tipo ───────────────────────────────────
 *
 * `MapeoTipo` guarda `minimoNoches` y `cerrado` **para siempre**. Con eso el
 * hotel puede decir «la Doble Vista pide 2 noches» pero no puede decir «el fin de
 * semana largo de octubre pide 3»: para imponerlo tendría que ponérselo al tipo
 * todo el año, y entonces deja de vender las noches sueltas de temporada baja.
 */
export interface RestriccionDeFecha {
  /** `null` = aplica a **todos** los tipos. Es el caso más común. */
  tipoUnidadId: string | null
  /** Primera fecha alcanzada. */
  desde: string
  /** Fin **excluido**, igual que el resto de los rangos del sistema. */
  hasta: string
  minimoNoches: number | null
  cerrado: boolean
  /** CTA: se puede estar ese día, pero no empezar la estadía. */
  cerradoLlegada: boolean
  /** CTD: se puede estar ese día, pero no terminarla ahí. */
  cerradoSalida: boolean
}

/** Lo que rige para un tipo en un día, ya resueltas todas las reglas. */
export interface RestriccionResuelta {
  minimoNoches: number | null
  cerrado: boolean
  cerradoLlegada: boolean
  cerradoSalida: boolean
}

/**
 * Combina la restricción del tipo con las de fecha que caen ese día.
 *
 * ⚠️ **Gana la más restrictiva, siempre.** Dos reglas que se pisan tienen que
 * resolverse hacia el lado seguro: quedarse corto vende una noche que el hotel
 * no quería vender —y esa venta ya no se deshace sin cancelarle a alguien—,
 * mientras que quedarse largo sólo pierde una reserva que todavía se puede
 * recuperar por teléfono.
 *
 * Los booleanos se combinan con `or` y el mínimo de noches con `max`, que es lo
 * mismo dicho de dos maneras.
 */
export function restriccionDelDia(
  mapeo: Pick<MapeoTipo, 'tipoUnidadId' | 'minimoNoches' | 'cerrado'>,
  restricciones: readonly RestriccionDeFecha[],
  fecha: string,
): RestriccionResuelta {
  const resuelta: RestriccionResuelta = {
    minimoNoches: mapeo.minimoNoches,
    cerrado: mapeo.cerrado,
    cerradoLlegada: false,
    cerradoSalida: false,
  }

  for (const r of restricciones) {
    // `[desde, hasta)` con el fin EXCLUIDO. Con `<=` la restricción se pasaría un
    // día, que es justamente el error que la convención existe para evitar.
    if (fecha < r.desde || fecha >= r.hasta) continue
    // `null` en la restricción significa «todos los tipos», no «ninguno».
    if (r.tipoUnidadId !== null && r.tipoUnidadId !== mapeo.tipoUnidadId) continue

    if (r.minimoNoches !== null) {
      resuelta.minimoNoches = Math.max(resuelta.minimoNoches ?? 0, r.minimoNoches)
    }
    resuelta.cerrado = resuelta.cerrado || r.cerrado
    resuelta.cerradoLlegada = resuelta.cerradoLlegada || r.cerradoLlegada
    resuelta.cerradoSalida = resuelta.cerradoSalida || r.cerradoSalida
  }

  return resuelta
}

export interface FilaAri {
  tipoUnidadCodigo: string
  fecha: string
  cupo: number
  precio: number
  moneda: string
  minimoNoches?: number
  cerrado?: boolean
  /** CTA. Sólo se informa cuando es `true`: es una instrucción, no un estado. */
  cerradoLlegada?: boolean
  /** CTD. Ídem. */
  cerradoSalida?: boolean
}

/* ────────────────────────────────────────────────────────── el cálculo ──── */

/**
 * Cuántas unidades de cada tipo están ocupadas cada noche.
 *
 * Se cuenta por **unidad distinta** y no por estadía: dos estadías de la misma
 * unidad en la misma noche no pueden existir —lo impide la exclusión GiST del ADR
 * 0002— pero contarlas dos veces daría el tipo por más lleno de lo que está, y el
 * canal dejaría de vender noches que sí se pueden vender.
 */
export function ocupacionPorTipoYNoche(
  estadias: readonly EstadiaOcupada[],
  desde: string,
  hasta: string,
): Map<string, Map<string, Set<string>>> {
  const porTipo = new Map<string, Map<string, Set<string>>>()

  for (const e of estadias) {
    const inicio = e.checkIn < desde ? desde : e.checkIn
    const fin = e.checkOut > hasta ? hasta : e.checkOut
    const cantidad = diasEntre(inicio, fin)
    if (cantidad <= 0) continue

    const noches = porTipo.get(e.tipoUnidadId) ?? new Map<string, Set<string>>()
    for (const noche of listaDias(inicio, cantidad)) {
      const enEsaNoche = noches.get(noche) ?? new Set<string>()
      enEsaNoche.add(e.unidadId)
      noches.set(noche, enEsaNoche)
    }
    porTipo.set(e.tipoUnidadId, noches)
  }

  return porTipo
}

/**
 * El cupo publicable de un tipo para una noche.
 *
 * Nunca negativo: si por un bloqueo manual hubiera más unidades ocupadas que
 * activas, la resta daría negativo y un canal rechazaría la fila entera —o peor,
 * la interpretaría como otra cosa—.
 */
export function cupoPublicable(
  unidadesActivas: number,
  ocupadas: number,
  topeCupo: number | null,
): number {
  const libres = Math.max(0, unidadesActivas - ocupadas)
  if (topeCupo === null) return libres
  return Math.max(0, Math.min(libres, topeCupo))
}

export interface OpcionesAri {
  /** Moneda en la que el canal espera los precios. */
  moneda: string
  /** Primera noche de la ventana, `YYYY-MM-DD`. */
  desde: string
  /** Fin excluido de la ventana. */
  hasta: string
}

/**
 * Arma las filas que habría que publicarle al canal.
 *
 * ── Por qué un tipo sin precio NO se publica ────────────────────────────────
 *
 * Sin tarifa cargada para esa fecha no hay precio que informar, y las dos
 * alternativas son peores que omitir la fila:
 *
 * · Publicar `0` es publicar **una noche gratis**. Ya pasó en este sistema, del
 *   lado público: el «USD 0 al reservar» de la Fase 18 fue exactamente esto, por
 *   temporadas sin cargar.
 * · Publicar el precio de otro día es inventar una tarifa.
 *
 * Se omite y se cuenta aparte, para que la pantalla pueda decir «faltan tarifas
 * en 12 de los 60 días» en vez de mostrar un envío que parece completo.
 *
 * ⚠️ Un tipo **cerrado** sí se publica, con `cerrado: true` y cupo 0. Cerrar es
 * una instrucción para el canal; omitirla lo deja vendiendo con el valor anterior.
 */
export function calcularAri(
  mapeos: readonly MapeoTipo[],
  estadias: readonly EstadiaOcupada[],
  precios: readonly PrecioDelDia[],
  opciones: OpcionesAri,
  /*
    Restricciones por fecha (0087). Opcional para no romper a quien ya llamaba a
    esta función: sin ellas, el comportamiento es exactamente el de antes.
  */
  restricciones: readonly RestriccionDeFecha[] = [],
): { filas: FilaAri[]; sinPrecio: number } {
  const noches = diasEntre(opciones.desde, opciones.hasta)
  if (noches <= 0) return { filas: [], sinPrecio: 0 }

  const ocupacion = ocupacionPorTipoYNoche(estadias, opciones.desde, opciones.hasta)

  const porTipoYFecha = new Map<string, number>()
  for (const p of precios) porTipoYFecha.set(`${p.tipoUnidadId}|${p.fecha}`, p.precio)

  const filas: FilaAri[] = []
  let sinPrecio = 0

  for (const m of mapeos) {
    const nochesDelTipo = ocupacion.get(m.tipoUnidadId)

    for (const fecha of listaDias(opciones.desde, noches)) {
      const precio = porTipoYFecha.get(`${m.tipoUnidadId}|${fecha}`)

      if (precio === undefined || !(precio > 0)) {
        sinPrecio++
        continue
      }

      // Lo del tipo más lo que rija ese día en particular, quedándose siempre con
      // lo más restrictivo (ver `restriccionDelDia`).
      const regla = restriccionDelDia(m, restricciones, fecha)

      const ocupadas = nochesDelTipo?.get(fecha)?.size ?? 0
      const cupo = regla.cerrado ? 0 : cupoPublicable(m.unidadesActivas, ocupadas, m.topeCupo)

      const fila: FilaAri = {
        tipoUnidadCodigo: m.codigoCanal,
        fecha,
        cupo,
        precio,
        moneda: opciones.moneda,
        // Cupo cero se informa como cerrado. Un canal que recibe cupo 0 sin la
        // marca puede seguir aceptando reservas «en lista de espera».
        cerrado: regla.cerrado || cupo === 0,
      }
      if (regla.minimoNoches && regla.minimoNoches > 1) fila.minimoNoches = regla.minimoNoches
      /*
        CTA y CTD sólo se informan cuando son `true`.

        Son instrucciones, no estados: mandar `cerradoLlegada: false` en todas las
        filas es ruido, y con algunos canales es peor —levanta una restricción que
        el hotel puso a mano desde el extranet—.
      */
      if (regla.cerradoLlegada) fila.cerradoLlegada = true
      if (regla.cerradoSalida) fila.cerradoSalida = true

      filas.push(fila)
    }
  }

  return { filas, sinPrecio }
}

/* ──────────────────────────────────────────────── resumen para pantalla ──── */

export interface ResumenAri {
  filas: number
  /** Noches con cupo publicable mayor que cero. */
  nochesAbiertas: number
  nochesCerradas: number
  sinPrecio: number
  tipos: number
}

export function resumirAri(
  filas: readonly FilaAri[],
  sinPrecio: number,
): ResumenAri {
  return {
    filas: filas.length,
    nochesAbiertas: filas.filter((f) => f.cupo > 0).length,
    nochesCerradas: filas.filter((f) => f.cupo === 0).length,
    sinPrecio,
    tipos: new Set(filas.map((f) => f.tipoUnidadCodigo)).size,
  }
}

/**
 * Ventana de días que se publica hacia adelante.
 *
 * Un año: es lo que Booking y los channel managers aceptan como horizonte y lo
 * que un hotel de temporada necesita —quien reserva El Calafate para enero
 * empieza a mirar en marzo—. Más lejos, la tarifa todavía no está cargada y las
 * filas saldrían todas en `sinPrecio`.
 */
export const DIAS_DE_VENTANA = 365

/**
 * Por qué NO se puede publicar. `null` = se puede intentar.
 *
 * Se separa del envío para que la pantalla pueda explicar la situación antes de
 * que alguien apriete un botón que no va a hacer nada.
 */
export type MotivoNoPublicar = 'sin_mapeos' | 'proveedor_no_publica' | 'sin_filas'

export const MENSAJES_NO_PUBLICAR: Record<MotivoNoPublicar, string> = {
  sin_mapeos:
    'Todavía no hay ningún tipo de unidad mapeado a este canal. Sin el código con el que el canal conoce cada tipo, no hay a qué publicarle.',
  proveedor_no_publica:
    'El proveedor de canal configurado es de solo lectura: puede traer reservas pero no puede informarle al canal qué queda libre. Es la limitación del ADR 0021 y se resuelve contratando un channel manager.',
  sin_filas:
    'No se pudo armar ninguna fila. Suele ser que faltan tarifas cargadas para las fechas de la ventana.',
}

export function motivoNoPublicar(entrada: {
  mapeos: number
  publicaDisponibilidad: boolean
  filas: number
}): MotivoNoPublicar | null {
  if (entrada.mapeos === 0) return 'sin_mapeos'
  if (!entrada.publicaDisponibilidad) return 'proveedor_no_publica'
  if (entrada.filas === 0) return 'sin_filas'
  return null
}
