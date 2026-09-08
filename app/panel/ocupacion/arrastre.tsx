'use client'

import { useCallback, useRef, useState, type ReactNode, type DragEvent } from 'react'
import { cambiarUnidadReserva } from '../reservas/actions'
import { BotonEnvio } from '../_components/boton-envio'
import { Icono } from '../_components/iconos'
import { botonClases, CAMPO } from '../_components/ui'
import { formatoFechaCorta, diasEntre } from '@/lib/fechas'
import {
  motivoRechazoArrastre,
  ventanaAlcanza,
  MENSAJES_RECHAZO_ARRASTRE,
  type MotivoRechazoArrastre,
  type TramoOcupado,
} from '@/lib/domain/arrastre-grilla'
import type { EstadoReserva } from '@/lib/domain/reservas'

/**
 * Arrastrar una reserva de una habitación a otra, dentro de la grilla.
 *
 * Lo pidió el hotel mirando WinPAX. Es la mudanza que ya existía (migración
 * 0028) pedida con el mouse en lugar de con un formulario en otra pantalla.
 *
 * ── Por qué es un envoltorio y no una grilla de cliente ──────────────────────
 * La tabla la sigue dibujando el Server Component: son cuarenta filas por
 * treinta días con datos de huéspedes, y mandarlas todas al navegador para
 * poder arrastrarlas sería pagar el peso de la grilla entera por un gesto que
 * se usa unas pocas veces al día. Este componente recibe esa tabla ya
 * renderizada como `children` y sólo escucha los eventos de arrastre, que
 * **burbujean**: `dragstart`, `dragover` y `drop` suben hasta acá desde
 * cualquier celda. Lo que la tabla aporta son atributos `data-*`; el estado
 * vive en el navegador y no vuelve al servidor hasta que alguien confirma.
 *
 * ── Lo que este componente NO hace ───────────────────────────────────────────
 * · **No mueve fechas.** Correrlas recotiza la estadía —cambia lo que el huésped
 *   paga— y eso no puede salir de un gesto que se dispara sin querer. Sigue en
 *   la pantalla de reprogramar.
 * · **No decide si el destino está libre.** Adelanta la respuesta con lo que hay
 *   en pantalla para no dejar soltar sobre una habitación vendida, pero la
 *   garantía es la restricción de exclusión de la base (ADR 0002): entre que se
 *   dibujó la grilla y se soltó el bloque, otra recepcionista pudo vender esa
 *   unidad.
 * · **No es el único camino.** Con el dedo no hay arrastre, y con teclado
 *   tampoco: el bloque sigue siendo un enlace a la ficha de la reserva, que
 *   tiene el cambio de unidad de siempre. Es un atajo, no una puerta.
 */

/** Una unidad de la grilla, con lo justo para armar el diálogo. */
export interface UnidadArrastre {
  id: string
  nombre: string
  /** Código del tipo (STD, SUP, CA2…). Sirve para detectar el cambio de tipo. */
  tipoCodigo: string
  tipoNombre: string
  activa: boolean
}

/** Un tramo ocupado de una unidad, dentro de la ventana visible. */
export interface TramoDeUnidad extends TramoOcupado {
  reservaId: string
}

/** Lo que se leyó del bloque agarrado. */
interface Agarrado {
  reservaId: string
  unidadId: string
  estado: EstadoReserva
  desde: string
  hasta: string
  codigo: string
  huesped: string
  tipoCodigo: string
}

/** La mudanza propuesta, esperando confirmación. */
interface Propuesta extends Agarrado {
  destino: UnidadArrastre
}

/** Clases que marcan la fila mientras se arrastra por encima. */
const MARCA_VALIDA = 'bg-lago-50'
const MARCA_INVALIDA = 'bg-red-50'
/** Atenúa las noches de la reserva que se está moviendo. */
const MARCA_EN_VUELO = 'opacity-40'

export function ArrastreDeReservas({
  unidades,
  ocupacion,
  ventana,
  filtros,
  children,
}: {
  unidades: readonly UnidadArrastre[]
  /** unidad_id → tramos ocupados dentro de la ventana visible. */
  ocupacion: Record<string, readonly TramoDeUnidad[]>
  ventana: TramoOcupado
  /** Filtros vigentes de la grilla, para volver a esta misma vista. */
  filtros: Record<string, string | undefined>
  children: ReactNode
}) {
  const raiz = useRef<HTMLDivElement>(null)
  /*
    El bloque agarrado va en un ref y no en estado: se escribe en `dragstart` y
    se lee en `dragover`, que se dispara decenas de veces por segundo mientras
    el mouse se mueve. Con estado, cada movimiento volvería a renderizar la
    grilla entera.
  */
  const agarrado = useRef<Agarrado | null>(null)
  const filaMarcada = useRef<HTMLElement | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null)
  const [rechazo, setRechazo] = useState<MotivoRechazoArrastre | null>(null)

  const porId = useCallback(
    (id: string): UnidadArrastre | null => unidades.find((u) => u.id === id) ?? null,
    [unidades],
  )

  /** Saca el resaltado de la fila sobre la que se estaba pasando. */
  const desmarcar = useCallback(() => {
    if (!filaMarcada.current) return
    filaMarcada.current.classList.remove(MARCA_VALIDA, MARCA_INVALIDA)
    filaMarcada.current = null
  }, [])

  /** Por qué no se puede soltar el bloque en esta unidad, o `null` si se puede. */
  const evaluar = useCallback(
    (bloque: Agarrado, destinoId: string): MotivoRechazoArrastre | null => {
      const destino = porId(destinoId)
      if (!destino) return 'destino_inactivo'
      return motivoRechazoArrastre(
        bloque,
        { id: destino.id, activa: destino.activa },
        ocupacion[destinoId] ?? [],
      )
    },
    [ocupacion, porId],
  )

  const alEmpezar = useCallback((e: DragEvent) => {
    const bloque = (e.target as HTMLElement).closest<HTMLElement>('[data-bloque]')
    if (!bloque) return

    const d = bloque.dataset
    if (!d.reserva || !d.unidad || !d.desde || !d.hasta) return

    agarrado.current = {
      reservaId: d.reserva,
      unidadId: d.unidad,
      estado: d.estado as EstadoReserva,
      desde: d.desde,
      hasta: d.hasta,
      codigo: d.codigo ?? '',
      huesped: d.huesped ?? '',
      tipoCodigo: d.tipo ?? '',
    }
    setArrastrando(true)
    setRechazo(null)

    /*
      Firefox no arranca el arrastre si el `dataTransfer` va vacío, aunque nadie
      lea el dato. Y el bloque es un enlace: sin esta línea el navegador
      arrastraría la URL de la ficha, y soltarla en otra pestaña abriría la
      reserva — un efecto que nadie pidió.
    */
    e.dataTransfer.setData('text/plain', d.reserva)
    e.dataTransfer.effectAllowed = 'move'

    // Todas las noches de la misma reserva se atenúan juntas: lo que se mueve es
    // la estadía entera, no la noche que se agarró.
    raiz.current
      ?.querySelectorAll<HTMLElement>(`[data-reserva="${CSS.escape(d.reserva)}"]`)
      .forEach((n) => n.classList.add(MARCA_EN_VUELO))
  }, [])

  const alPasar = useCallback(
    (e: DragEvent) => {
      const bloque = agarrado.current
      if (!bloque) return
      const fila = (e.target as HTMLElement).closest<HTMLElement>('[data-fila-unidad]')
      if (!fila) return

      if (fila !== filaMarcada.current) {
        desmarcar()
        const motivo = evaluar(bloque, fila.dataset.filaUnidad ?? '')
        fila.classList.add(motivo ? MARCA_INVALIDA : MARCA_VALIDA)
        filaMarcada.current = fila
        setRechazo(motivo)
      }

      /*
        `preventDefault` en CADA `dragover` es lo que mantiene viva la zona de
        soltado: el navegador la da por rechazada apenas un evento pasa sin él,
        y entonces el `drop` no llega nunca. Por eso se llama afuera del `if`
        de arriba, que sólo corre cuando se cambia de fila.
      */
      if (!fila.classList.contains(MARCA_INVALIDA)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }
    },
    [desmarcar, evaluar],
  )

  const alTerminar = useCallback(() => {
    desmarcar()
    raiz.current
      ?.querySelectorAll<HTMLElement>(`.${MARCA_EN_VUELO}`)
      .forEach((n) => n.classList.remove(MARCA_EN_VUELO))
    agarrado.current = null
    setArrastrando(false)
    setRechazo(null)
  }, [desmarcar])

  const alSoltar = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const bloque = agarrado.current
      const fila = (e.target as HTMLElement).closest<HTMLElement>('[data-fila-unidad]')
      alTerminar()
      if (!bloque || !fila) return

      const destino = porId(fila.dataset.filaUnidad ?? '')
      if (!destino) return
      // Se vuelve a evaluar en el soltado y no se confía en el resaltado: entre
      // el último `dragover` y el `drop` el navegador pudo no repintar nada.
      if (evaluar(bloque, destino.id)) return

      setPropuesta({ ...bloque, destino })
    },
    [alTerminar, evaluar, porId],
  )

  return (
    <>
      <div
        ref={raiz}
        onDragStart={alEmpezar}
        onDragOver={alPasar}
        onDragEnd={alTerminar}
        onDrop={alSoltar}
      >
        {children}
      </div>

      {/* Aviso mientras se arrastra: dice qué hacer y, si la fila está en rojo,
          por qué no acepta el bloque. Una fila marcada sin explicación deja a
          quien la usa probando habitaciones al azar. */}
      {arrastrando && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-40 mx-auto w-fit max-w-[92vw] rounded-lg bg-stone-900/90 px-4 py-2 text-center text-sm text-white shadow-lg"
        >
          {rechazo ? (
            <span className="text-red-200">{MENSAJES_RECHAZO_ARRASTRE[rechazo]}</span>
          ) : (
            'Soltá el bloque sobre la habitación a la que querés mudar la reserva.'
          )}
        </div>
      )}

      {propuesta && (
        <DialogoDeMudanza
          propuesta={propuesta}
          ventana={ventana}
          filtros={filtros}
          alCerrar={() => setPropuesta(null)}
        />
      )}
    </>
  )
}

/**
 * Confirmación de la mudanza.
 *
 * Soltar no aplica nada: pregunta. Un arrastre accidental en una grilla de
 * cuarenta filas no puede cambiarle la habitación a un huésped que ya está
 * durmiendo en ella, así que acá se lee en palabras qué se va a hacer antes de
 * hacerlo.
 */
function DialogoDeMudanza({
  propuesta,
  ventana,
  filtros,
  alCerrar,
}: {
  propuesta: Propuesta
  ventana: TramoOcupado
  filtros: Record<string, string | undefined>
  alCerrar: () => void
}) {
  const { destino } = propuesta
  const noches = diasEntre(propuesta.desde, propuesta.hasta)
  const cambiaDeTipo = Boolean(propuesta.tipoCodigo) && destino.tipoCodigo !== propuesta.tipoCodigo
  const completa = ventanaAlcanza(propuesta, ventana)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
        onClick={alCerrar}
        aria-label="Cancelar la mudanza"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-mudanza"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="titulo-mudanza" className="font-display text-lg font-semibold text-lago-900">
            Cambiar de habitación
          </h2>
          <button
            type="button"
            onClick={alCerrar}
            className="rounded-lg p-1.5 text-stone-500 transition hover:bg-stone-100"
            aria-label="Cerrar"
          >
            <Icono nombre="cerrar" tam={18} />
          </button>
        </div>

        {/* Qué se mueve, en palabras. El código y el apellido primero: es como
            recepción identifica una reserva cuando la tiene al teléfono. */}
        <dl className="mb-4 space-y-1.5 rounded-lg bg-stone-50 p-3 text-sm">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-stone-500">Reserva</dt>
            <dd className="min-w-0 font-medium text-stone-800">
              {propuesta.codigo}
              {propuesta.huesped && ` · ${propuesta.huesped}`}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-stone-500">Fechas</dt>
            <dd className="min-w-0 text-stone-800">
              {formatoFechaCorta(propuesta.desde)} → {formatoFechaCorta(propuesta.hasta)}{' '}
              <span className="text-stone-500">
                ({noches} {noches === 1 ? 'noche' : 'noches'}, no cambian)
              </span>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-stone-500">Pasa a</dt>
            <dd className="min-w-0 font-medium text-stone-800">
              {destino.nombre} <span className="font-normal text-stone-500">· {destino.tipoNombre}</span>
            </dd>
          </div>
        </dl>

        {!completa && (
          /* Honestidad sobre el alcance de lo que se comprobó: la grilla sólo
             trajo las estadías de la ventana que muestra, así que de una reserva
             que se sale por un costado no puede afirmar que el destino esté
             libre todas sus noches. La base sí, y contesta al guardar. */
          <p className="mb-4 rounded-lg bg-lenga-50 p-3 text-xs text-lenga-900">
            Esta reserva se extiende fuera de los días que muestra la grilla. Que{' '}
            {destino.nombre} esté libre todas sus noches lo confirma el sistema al guardar.
          </p>
        )}

        <form action={cambiarUnidadReserva} className="space-y-4">
          <input type="hidden" name="reserva_id" value={propuesta.reservaId} />
          <input type="hidden" name="unidad_destino" value={destino.id} />
          {/* Token de lista blanca, nunca una URL: ver `retornoDeMudanza` en
              `app/panel/reservas/actions.ts`. */}
          <input type="hidden" name="volver" value="ocupacion" />
          {Object.entries(filtros).map(([clave, valor]) =>
            valor ? <input key={clave} type="hidden" name={`g_${clave}`} value={valor} /> : null,
          )}

          {cambiaDeTipo && (
            <fieldset>
              <legend className="mb-1.5 block text-sm font-medium text-stone-700">Tarifa</legend>
              <p className="mb-2 text-xs text-stone-500">
                {destino.nombre} es de otro tipo que la unidad actual.
              </p>
              <div className="space-y-1.5">
                <label className="flex items-start gap-2 text-sm text-stone-700">
                  <input
                    type="radio"
                    name="politica_tarifa"
                    value="mantener"
                    defaultChecked
                    className="mt-1"
                  />
                  <span>
                    Mantener el precio acordado
                    <span className="block text-xs text-stone-500">
                      El huésped paga lo que ya se le cotizó.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-stone-700">
                  <input type="radio" name="politica_tarifa" value="recotizar" className="mt-1" />
                  <span>
                    Recotizar según {destino.tipoNombre}
                    <span className="block text-xs text-stone-500">
                      Cambia el total de la reserva.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          <div>
            <label
              htmlFor="motivo-mudanza"
              className="mb-1.5 block text-sm font-medium text-stone-700"
            >
              Motivo <span className="font-normal text-stone-500">(opcional)</span>
            </label>
            <input
              id="motivo-mudanza"
              name="motivo"
              type="text"
              maxLength={200}
              placeholder="Calefactor roto, pedido del huésped…"
              className={CAMPO}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={alCerrar}
              className={botonClases('secundario', 'w-full sm:w-auto')}
            >
              Cancelar
            </button>
            <BotonEnvio cargando="Mudando…" extra="w-full sm:w-auto">
              Cambiar de habitación
            </BotonEnvio>
          </div>
        </form>
      </div>
    </div>
  )
}
