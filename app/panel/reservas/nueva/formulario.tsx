'use client'

import { useActionState, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { crearReservaAction, type EstadoNuevaReserva } from '../actions'
import {
  ETIQUETAS_GARANTIA,
  ETIQUETAS_PLAN,
  ETIQUETAS_SEGMENTO,
  GARANTIAS,
  PLANES,
  SEGMENTOS,
} from '@/lib/domain/reservas'
import { ETIQUETAS_ESTADO_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { claveBorradorReserva } from '@/lib/domain/borrador-reserva'
import {
  CAMPO,
  Campo,
  Etiqueta,
  Mensaje,
  PieDeFormulario,
  Tarjeta,
  botonClases,
} from '../../_components/ui'
import { formatearUSD } from '@/lib/domain/moneda'

/**
 * Borrador del alta (auditoría de calidad 2026-09-09).
 *
 * `sessionStorage`, no `localStorage`: en una recepción con la computadora
 * compartida entre turnos, el nombre de un huésped a medio cargar no debería
 * sobrevivir a que alguien cierre la pestaña. Envuelto en `try/catch` porque
 * Safari en navegación privada puede negar el acceso — si falla, el
 * formulario sigue andando, solo que sin recordar nada (degradación
 * aceptable: hoy ya se pierde SIEMPRE).
 */
function leerBorrador(clave: string): Record<string, string> | null {
  try {
    const crudo = sessionStorage.getItem(clave)
    return crudo ? (JSON.parse(crudo) as Record<string, string>) : null
  } catch {
    return null
  }
}

function guardarBorrador(clave: string, datos: Record<string, string>): void {
  try {
    sessionStorage.setItem(clave, JSON.stringify(datos))
  } catch {
    // Sin espacio o sin acceso: no hay nada mejor que hacer acá.
  }
}

function borrarBorrador(clave: string): void {
  try {
    sessionStorage.removeItem(clave)
  } catch {
    // Nada que limpiar si nunca se pudo escribir.
  }
}

/**
 * Ni el navegador cambia de servidor a cliente más de una vez, así que la
 * suscripción no tiene a qué escuchar: solo hace falta la transición inicial
 * (mismo patrón que `pwa.tsx`, `SIN_CAMBIOS`).
 */
const SIN_CAMBIOS = () => () => {}

export interface OpcionAgencia {
  id: string
  nombre: string
  descuento_pct: number
}

export interface OpcionTipo {
  tipoUnidadId: string
  nombre: string
  categoria: string
  capacidadMax: number
  disponibles: number
  total: number
  /** No hay tarifa cargada para todas las noches del rango. */
  faltanTarifas: boolean
}

/** Unidad física puntual libre, para elegir además del tipo (patrón QloApps). */
export interface OpcionUnidad {
  id: string
  nombre: string
  estado: EstadoHousekeeping
}

const ESTADO_INICIAL: EstadoNuevaReserva = {}

export function FormularioReserva({
  opciones,
  unidadesPorTipo,
  agencias,
  checkIn,
  checkOut,
  huespedes,
  noches,
}: {
  opciones: OpcionTipo[]
  unidadesPorTipo: Record<string, OpcionUnidad[]>
  agencias: OpcionAgencia[]
  checkIn: string
  checkOut: string
  huespedes: number
  noches: number
}) {
  const [estado, accion, pendiente] = useActionState(crearReservaAction, ESTADO_INICIAL)

  const clave = claveBorradorReserva(checkIn, checkOut, huespedes)
  const [borrador, setBorrador] = useState<Record<string, string> | null>(null)
  // Fuerza el remontaje de los campos no controlados cuando llega un borrador
  // después del primer render: `defaultValue` solo se aplica al montar, así
  // que cambiarlo sin remontar no mueve nada en el DOM.
  const [version, setVersion] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)

  // Los valores vuelven desde la acción del servidor si hubo un error de
  // validación (prioridad: son los que el huésped acaba de intentar mandar);
  // si no, un borrador guardado en este mismo navegador para esta misma
  // búsqueda; si no hay ninguno, vacío.
  const v = estado.valores ?? borrador ?? {}

  const cotizables = opciones.filter((o) => !o.faltanTarifas)
  const primeraCotizable = cotizables[0]?.tipoUnidadId

  // Qué tipo está elegido ahora mismo, para mostrar debajo sus unidades
  // puntuales. Sin esto habría que repetir el picker de unidad una vez por
  // tipo, visible todo junto — más ruido que ayuda con seis tipos en pantalla.
  const [tipoElegido, setTipoElegidoState] = useState(v.tipo_unidad_id || primeraCotizable || '')
  const [unidadElegida, setUnidadElegida] = useState('')
  const unidadesDelTipo = unidadesPorTipo[tipoElegido] ?? []

  /*
    `typeof window !== 'undefined'` es VERDADERO desde el primer render del
    cliente —incluso el de hidratación—, así que ajustar estado con esa
    condición pinta el borrador ANTES de que React termine de comparar contra
    el HTML del servidor: "Hydration failed because the server rendered HTML
    didn't match the client" (se reprodujo en el navegador armando este
    mismo caso). `useSyncExternalStore` sí distingue las dos pasadas: en la
    de hidratación fuerza `getServerSnapshot` (acá `false`) aunque ya haya
    `window`, y solo DESPUÉS de que la hidratación cierra pasa a `true` en un
    render aparte, normal, donde ajustar estado ya no choca con nada (mismo
    motivo por el que `pwa.tsx` usa este hook y no `typeof window`).
  */
  const clienteListo = useSyncExternalStore(SIN_CAMBIOS, () => true, () => false)

  // Ajuste de estado durante el render (react.dev/learn/you-might-not-need-an-effect
  // → "adjusting state when a value changes"), no en un `useEffect`: un efecto
  // que llama `setState` en su cuerpo pinta una vez vacío y recién después
  // pinta con el borrador, el rebote que corta `react-hooks/set-state-in-effect`.
  const [borradorLeido, setBorradorLeido] = useState(false)
  if (clienteListo && !borradorLeido && !estado.valores) {
    setBorradorLeido(true)
    const guardado = leerBorrador(clave)
    if (guardado) {
      setBorrador(guardado)
      setVersion((n) => n + 1)
      if (guardado.tipo_unidad_id) setTipoElegidoState(guardado.tipo_unidad_id)
      if (guardado.unidad_id) setUnidadElegida(guardado.unidad_id)
    }
  }

  function descartarBorrador() {
    borrarBorrador(clave)
    setBorrador(null)
    setTipoElegidoState(primeraCotizable || '')
    setUnidadElegida('')
    setVersion((n) => n + 1)
  }

  /** Guarda cada cambio: es lo que sobrevive a un `?check_in=` distinto o a "atrás". */
  function alCambiar() {
    if (!formRef.current) return
    const datos = Object.fromEntries(
      Array.from(new FormData(formRef.current).entries()).map(([k, val]) => [k, String(val)]),
    )
    guardarBorrador(clave, datos)
  }

  // Cambiar de tipo invalida cualquier unidad puntual ya elegida: una unidad de
  // la Cabaña Doble no existe como opción bajo Suite Triple.
  function setTipoElegido(id: string) {
    setTipoElegidoState(id)
    setUnidadElegida('')
    alCambiar()
  }

  return (
    <form
      key={version}
      ref={formRef}
      action={accion}
      onChange={alCambiar}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="check_in" value={checkIn} />
      <input type="hidden" name="check_out" value={checkOut} />
      <input type="hidden" name="huespedes" value={huespedes} />

      {borrador && (
        <Mensaje tono="ok">
          Recuperamos lo que tenías cargado para esta búsqueda.{' '}
          <button
            type="button"
            onClick={descartarBorrador}
            className="font-medium underline underline-offset-2"
          >
            Descartar y empezar de cero
          </button>
        </Mensaje>
      )}

      {/* Si ninguna unidad tiene precio, se avisa ACÁ y no al confirmar: el
          problema es del tarifario, no de lo que cargue quien reserva. */}
      {cotizables.length === 0 && (
        <Mensaje tono="error">
          <span className="block font-medium">
            No hay tarifas cargadas para {noches === 1 ? 'esa noche' : 'esas fechas'}.
          </span>
          Hay unidades libres, pero sin precio no se puede cotizar. Cargá la temporada y sus
          precios en{' '}
          <Link href="/panel/config/temporadas" className="underline">
            Configuración → Temporadas
          </Link>
          .
        </Mensaje>
      )}

      <Tarjeta
        titulo={`2 · ¿Qué unidad?`}
        descripcion={`Precios de referencia por ${noches} ${noches === 1 ? 'noche' : 'noches'}, tarifa de mostrador.`}
      >
        <div className="flex flex-col gap-2 p-5">
          {opciones.map((o) => {
            const sinPrecio = o.faltanTarifas
            return (
              <label
                key={o.tipoUnidadId}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                  sinPrecio
                    ? 'cursor-not-allowed border-stone-200 bg-stone-50 opacity-70'
                    : 'cursor-pointer border-stone-200 hover:border-lago-400 has-[:checked]:border-lago-600 has-[:checked]:bg-lago-50'
                }`}
              >
                <input
                  type="radio"
                  name="tipo_unidad_id"
                  value={o.tipoUnidadId}
                  checked={tipoElegido === o.tipoUnidadId}
                  onChange={() => setTipoElegido(o.tipoUnidadId)}
                  // Sin tarifa no se puede cotizar: se bloquea acá en lugar de
                  // dejar elegir y fallar recién al confirmar.
                  disabled={sinPrecio}
                  required
                  className="size-4 accent-lago-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-stone-800">{o.nombre}</span>
                  <span className="mt-0.5 block text-sm text-stone-500">
                    hasta {o.capacidadMax} · {o.disponibles}{' '}
                    {o.disponibles === 1 ? 'libre' : 'libres'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {sinPrecio ? (
                    <span className="text-sm font-medium text-lenga-700">Sin tarifa cargada</span>
                  ) : (
                    <>
                      <span className="tabular font-semibold text-stone-900">
                        {formatearUSD(o.total)}
                      </span>
                      <span className="block text-xs text-stone-500">total de referencia</span>
                    </>
                  )}
                </span>
              </label>
            )
          })}
        </div>

        {/* Unidad puntual, opcional: sin elegir ninguna, `crear_reserva` toma la
            primera libre del tipo (comportamiento histórico). Recepción la
            necesita cuando el huésped pidió "la de siempre" o hay que evitar
            una que está sucia justo antes de que entre alguien ahora mismo. */}
        {unidadesDelTipo.length > 0 && (
          <div className="border-t border-stone-100 p-5 pt-4">
            <p className="mb-2 text-sm font-medium text-stone-700">¿Cuál en particular?</p>
            <div className="flex flex-wrap gap-2">
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  !unidadElegida
                    ? 'border-lago-600 bg-lago-50 text-lago-900'
                    : 'border-stone-200 text-stone-600 hover:border-lago-400'
                }`}
              >
                <input
                  type="radio"
                  name="unidad_id"
                  value=""
                  checked={!unidadElegida}
                  onChange={() => setUnidadElegida('')}
                  className="size-4 accent-lago-600"
                />
                Cualquiera disponible
              </label>
              {unidadesDelTipo.map((u) => (
                <label
                  key={u.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    unidadElegida === u.id
                      ? 'border-lago-600 bg-lago-50 text-lago-900'
                      : 'border-stone-200 text-stone-600 hover:border-lago-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="unidad_id"
                    value={u.id}
                    checked={unidadElegida === u.id}
                    onChange={() => setUnidadElegida(u.id)}
                    className="size-4 accent-lago-600"
                  />
                  {u.nombre}
                  {u.estado !== 'limpia' && (
                    <Etiqueta tono={u.estado === 'sucia' ? 'alerta' : 'lago'}>
                      {ETIQUETAS_ESTADO_HK[u.estado]}
                    </Etiqueta>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="3 · ¿A nombre de quién?"
        descripcion="Solo el apellido es obligatorio."
      >
        <div className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2">
          <Campo etiqueta="Apellido" requerido>
            <input name="apellido" required defaultValue={v.apellido ?? ''} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Nombre">
            <input name="nombre" defaultValue={v.nombre ?? ''} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Email" ayuda="Si ya se alojó antes, se reutiliza su ficha.">
            <input
              name="email"
              type="email"
              defaultValue={v.email ?? ''}
              className={CAMPO}
            />
          </Campo>
          <Campo etiqueta="Documento">
            <input name="doc_numero" defaultValue={v.doc_numero ?? ''} className={CAMPO} />
          </Campo>

          <Campo etiqueta="Canal" ayuda="Define si se cotiza con tarifa de mostrador o neta.">
            <select name="canal" defaultValue={v.canal ?? 'directo'} className={CAMPO}>
              <option value="directo">Directo / Mostrador (rack)</option>
              <option value="web">Web (rack)</option>
              <option value="booking">Booking (neto)</option>
              <option value="expedia">Expedia (neto)</option>
            </select>
          </Campo>

          {/* Si la reserva entra por convenio, la agencia es la que factura: de
              ella salen la tarifa neta y la letra del comprobante (ADR 0012). */}
          <Campo
            etiqueta="Agencia / empresa"
            ayuda="Con convenio siempre se aplica tarifa neta, sea cual sea el canal."
          >
            <select name="agencia_id" defaultValue={v.agencia_id ?? ''} className={CAMPO}>
              <option value="">Sin convenio (huésped directo)</option>
              {agencias.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                  {a.descuento_pct > 0 ? ` · ${a.descuento_pct}% dto.` : ''}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </Tarjeta>

      {/* ── Paso 4: cómo se ocupa la habitación ──────────────────────────────
          Es lo que recepción necesita para prepararla. Un `2` en «huéspedes» no
          dice si hacen falta dos camas o una cama y una cuna, y eso se descubre
          cuando el huésped llega. Los bebés se registran aparte porque **no
          ocupan plaza**: contarlos daría «completo» de más. */}
      <Tarjeta
        titulo="4 · ¿Quiénes se alojan?"
        descripcion="Los bebés en cuna no cuentan para la capacidad de la unidad."
      >
        <div className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-5">
          <Campo etiqueta="Adultos" requerido>
            <input
              name="adultos"
              type="number"
              min={1}
              max={10}
              defaultValue={v.adultos ?? String(huespedes)}
              required
              className={CAMPO}
            />
          </Campo>
          <Campo etiqueta="Menores">
            <input
              name="menores"
              type="number"
              min={0}
              max={10}
              defaultValue={v.menores ?? '0'}
              className={CAMPO}
            />
          </Campo>
          <Campo etiqueta="Bebés">
            <input
              name="bebes"
              type="number"
              min={0}
              max={10}
              defaultValue={v.bebes ?? '0'}
              className={CAMPO}
            />
          </Campo>
          <Campo etiqueta="Camas extra">
            <input
              name="camas_extra"
              type="number"
              min={0}
              max={4}
              defaultValue={v.camas_extra ?? '0'}
              className={CAMPO}
            />
          </Campo>
          <Campo etiqueta="Cunas">
            <input
              name="cunas"
              type="number"
              min={0}
              max={4}
              defaultValue={v.cunas ?? '0'}
              className={CAMPO}
            />
          </Campo>

          <label className="flex items-center gap-2 text-sm text-stone-700 sm:col-span-5">
            <input
              type="checkbox"
              name="no_mover"
              value="1"
              defaultChecked={v.no_mover === '1'}
              className="size-4 accent-lago-600"
            />
            <span className="font-medium">No mover de habitación</span>
            <span className="text-stone-500">
              (el huésped pidió esta unidad en particular: vista, planta baja, la de siempre)
            </span>
          </label>
        </div>
      </Tarjeta>

      {/* ── Paso 5: datos comerciales ────────────────────────────────────────
          El plan y la garantía no son burocracia: el plan es lo que el hotel
          promete darle de comer, y la garantía es lo que decide si un no-show se
          puede cobrar. */}
      <Tarjeta titulo="5 · Condiciones comerciales">
        <div className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2">
          <Campo etiqueta="Plan" ayuda="Qué incluye la tarifa además del alojamiento.">
            <select name="plan" defaultValue={v.plan ?? 'desayuno'} className={CAMPO}>
              {PLANES.map((p) => (
                <option key={p} value={p}>
                  {ETIQUETAS_PLAN[p]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            etiqueta="Garantía"
            ayuda="Sin garantía, un no-show no se puede cobrar."
          >
            <select name="garantia" defaultValue={v.garantia ?? 'sin_garantia'} className={CAMPO}>
              {GARANTIAS.map((g) => (
                <option key={g} value={g}>
                  {ETIQUETAS_GARANTIA[g]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo etiqueta="Segmento" ayuda="Se usa en los reportes de gerencia.">
            <select name="segmento" defaultValue={v.segmento ?? ''} className={CAMPO}>
              <option value="">Según el canal</option>
              {SEGMENTOS.map((s) => (
                <option key={s} value={s}>
                  {ETIQUETAS_SEGMENTO[s]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo etiqueta="Voucher" ayuda="Número que dio la agencia o el canal, si hay.">
            <input name="voucher" defaultValue={v.voucher ?? ''} className={CAMPO} />
          </Campo>

          <Campo
            etiqueta="Descuento adicional (%)"
            ayuda="Se aplica sobre la tarifa. El descuento del convenio de la agencia va aparte."
          >
            <input
              name="descuento_pct"
              type="number"
              min={0}
              max={100}
              step="0.5"
              defaultValue={v.descuento_pct ?? '0'}
              className={CAMPO}
            />
          </Campo>
        </div>
      </Tarjeta>

      {/* Check-in inmediato: para el walk-in que llega y se aloja en el momento,
          en vez de dejarlo `confirmada` y pedirle a recepción un segundo paso
          en la ficha para pasarlo a `in_house` (patrón QloApps
          `AdminHotelRoomsBookingController`, que deja marcar "In Progress" al
          confirmar la reserva). */}
      <Tarjeta>
        <label className="flex items-center gap-2 p-5 text-sm text-stone-700">
          <input
            type="checkbox"
            name="checkin_inmediato"
            value="1"
            defaultChecked={v.checkin_inmediato === '1'}
            className="size-4 accent-lago-600"
          />
          <span className="font-medium">Marcar check-in ahora</span>
          <span className="text-stone-500">(el huésped ya está en el mostrador)</span>
        </label>
      </Tarjeta>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}

      <PieDeFormulario>
        <button
          type="submit"
          disabled={pendiente || cotizables.length === 0}
          className={botonClases('primario', 'w-full disabled:cursor-not-allowed sm:w-auto')}
        >
          {pendiente ? 'Confirmando…' : 'Confirmar reserva'}
        </button>
        <Link href="/panel/reservas" className={botonClases('secundario', 'w-full sm:w-auto')}>
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
