import { nombreCompleto } from '@/lib/domain/huespedes'
import {
  ETIQUETAS_GARANTIA,
  ETIQUETAS_PLAN,
  ETIQUETAS_SEGMENTO,
  noShowEsCobrable,
  type EstadoReserva,
  type Garantia,
  type Plan,
  type Segmento,
} from '@/lib/domain/reservas'
import {
  desgloseCoincide,
  paxQueOcupa,
  textoOcupantes,
  type Ocupantes,
} from '@/lib/domain/ocupantes'
import { MENSAJES_SIN_EXENCION, type motivoSinExencion } from '@/lib/domain/exencion-iva'
import { type EstadoVerificacionTarjeta } from '@/lib/domain/garantia-tarjeta'
import { formatoFechaCorta, type Periodo } from '@/lib/fechas'
import { formatearUSD } from '@/lib/domain/moneda'
import { fijarOrigenDelPago } from '../cobros.actions'
import { BotonEnvio } from '../../_components/boton-envio'
import { Etiqueta } from '../../_components/ui'

/**
 * Las tarjetas «Huésped» y «Estadía» de la ficha de una reserva, con el
 * desglose de importes y la exención de IVA. Son sólo presentación: todo lo
 * que muestran lo calcula `page.tsx`.
 */

export interface Reserva {
  id: string
  codigo: string
  estado: EstadoReserva
  total: number | string
  /* Desglose fiscal (paso 6). `total` sigue siendo el importe CON IVA. */
  subtotal: number | string
  total_neto: number | string
  iva: number | string
  descuento_pct: number | string
  canal: string
  tarifa_tipo: string
  notas: string
  plan: Plan
  garantia: Garantia
  segmento: Segmento
  voucher: string
  agencia_id: string | null
  huesped_id: string | null
  /** Origen del pago para la exención de IVA (RG 3971). `null` = sin definir. */
  pago_desde_exterior: boolean | null
  /* Garantía de tarjeta (ADR 0025). NUNCA hay acá un número de tarjeta. */
  tarjeta_ultimos4: string | null
  tarjeta_marca: string | null
  tarjeta_vencimiento: string | null
  tarjeta_verificacion: EstadoVerificacionTarjeta
  tarjeta_verificada_en: string | null
  huesped: {
    apellido: string
    nombre: string
    email: string | null
    doc_numero: string
    vip: boolean
    residente_exterior: boolean | null
  } | null
  estadias: EstadiaReserva[]
}

export interface EstadiaReserva {
  periodo: string
  precio_noche: number | string
  huespedes: number
  adultos: number
  menores: number
  bebes: number
  camas_extra: number
  cunas: number
  no_mover: boolean
  unidad: {
    nombre: string
    tipo_unidad_id: string
    tipo: { nombre: string; capacidad_max: number } | null
  } | null
}

/**
 * Un par etiqueta/valor de la ficha.
 *
 * El `wrap-anywhere` del valor no es decorativo. Acá se muestran Email y Voucher,
 * que son cadenas largas y **sin espacios**: sin permitir el corte, un email como
 * `maria.fernanda.gonzalez.iturriaga@corporativoempresarial.com.ar` se sale de la
 * tarjeta blanca y se superpone con la columna de al lado.
 *
 * Es `wrap-anywhere` y no `break-words` a propósito, y la diferencia es la que
 * arregla el problema: las dos permiten partir la palabra al pintar, pero solo
 * `overflow-wrap: anywhere` cuenta ese corte al calcular el ancho **mínimo** del
 * contenido. Con `break-words`, la tarjeta —que es un ítem de grilla, o sea
 * `min-width: auto`— igual se ensancha hasta que el email entre de una pieza, y el
 * desborde se muda del texto a la grilla entera. Los ítems llevan además `min-w-0`.
 */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-stone-600">{etiqueta}</dt>
      <dd className="mt-0.5 wrap-anywhere text-stone-800">{valor}</dd>
    </div>
  )
}

export function SeccionHuesped({ reserva }: { reserva: Reserva }) {
  return (
    <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-stone-700">Huésped</h2>
      <dl className="flex flex-col gap-3">
        <Dato
          etiqueta="Nombre"
          valor={reserva.huesped ? nombreCompleto(reserva.huesped) : '—'}
        />
        <Dato etiqueta="Email" valor={reserva.huesped?.email || '—'} />
        <Dato etiqueta="Documento" valor={reserva.huesped?.doc_numero || '—'} />
        {/* VIP con etiqueta de texto, no sólo una estrellita de color: si el
            dato importa tiene que leerse sin depender del color. */}
        {reserva.huesped?.vip && (
          <div>
            <dt className="text-xs tracking-wide text-stone-600 uppercase">Categoría</dt>
            <dd className="mt-0.5">
              <Etiqueta tono="calafate">★ Huésped VIP</Etiqueta>
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

export function SeccionEstadia({
  reserva,
  estadia,
  periodo,
  noches,
  ocupantes,
  exento,
  motivoExencion,
  importeExento,
}: {
  reserva: Reserva
  estadia: EstadiaReserva | undefined
  periodo: Periodo | null
  noches: number
  ocupantes: Ocupantes
  exento: boolean
  motivoExencion: ReturnType<typeof motivoSinExencion>
  /** Lo que saldría el alojamiento sin IVA (`desglosarConExencion(...).exento`). */
  importeExento: number
}) {
  return (
    <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-stone-700">Estadía</h2>
      <dl className="flex flex-col gap-3">
        <Dato
          etiqueta="Unidad"
          valor={
            estadia?.unidad
              ? `${estadia.unidad.nombre} · ${estadia.unidad.tipo?.nombre ?? ''}`
              : '—'
          }
        />
        <Dato
          etiqueta="Fechas"
          valor={
            periodo
              ? `${formatoFechaCorta(periodo.desde)} → ${formatoFechaCorta(periodo.hasta)} (${noches} noches)`
              : '—'
          }
        />
        {/* Desglose de ocupantes: es lo que recepción necesita para preparar
            la habitación. «2 huéspedes» no dice si van dos camas o una cama
            y una cuna. */}
        <Dato etiqueta="Ocupantes" valor={estadia ? textoOcupantes(ocupantes) : '—'} />

        {/* Si el desglose y el pax guardado no cierran, se dice. Puede pasar
            con filas viejas o escritas por fuera de `crear_reserva`; mostrar
            dos números contradictorios sin avisar es peor que avisar. */}
        {estadia && !desgloseCoincide(ocupantes, estadia.huespedes) && (
          <div>
            <dt className="text-xs tracking-wide text-stone-600 uppercase">Atención</dt>
            <dd className="mt-0.5 text-sm text-lenga-800">
              El desglose suma {paxQueOcupa(ocupantes)} pero la estadía tiene{' '}
              {estadia.huespedes} huésped(es) registrado(s). Revisá el detalle.
            </dd>
          </div>
        )}

        {estadia?.no_mover && (
          <div>
            <dt className="text-xs tracking-wide text-stone-600 uppercase">Asignación</dt>
            <dd className="mt-0.5">
              <Etiqueta tono="alerta">No mover de habitación</Etiqueta>
            </dd>
          </div>
        )}

        {/* Las notas a la vista y no sólo dentro de «Editar ficha»: ahí
            llega el pedido especial que el huésped escribe al reservar
            desde la web —una cuna, la hora de llegada—, y recepción tiene
            que leerlo sin abrir ningún formulario. */}
        {reserva.notas && (
          <div>
            <dt className="text-xs tracking-wide text-stone-600 uppercase">Notas</dt>
            <dd className="mt-0.5 whitespace-pre-line text-stone-800">{reserva.notas}</dd>
          </div>
        )}

        <Dato etiqueta="Plan" valor={ETIQUETAS_PLAN[reserva.plan] ?? reserva.plan} />
        <Dato
          etiqueta="Canal / tarifa / segmento"
          valor={`${reserva.canal} · ${reserva.tarifa_tipo} · ${ETIQUETAS_SEGMENTO[reserva.segmento] ?? reserva.segmento}`}
        />
        <Dato
          etiqueta="Garantía"
          valor={
            (ETIQUETAS_GARANTIA[reserva.garantia] ?? reserva.garantia) +
            (noShowEsCobrable(reserva.garantia) ? '' : ' — un no-show no sería cobrable')
          }
        />

        {reserva.voucher && <Dato etiqueta="Voucher" valor={reserva.voucher} />}

        <Importes reserva={reserva} />

        {/* ── Exención de IVA al turista del exterior (RG 3971, ADR 0024) ──
            Se muestra solo cuando puede aplicar: si el huésped no reside en
            el exterior, este bloque sería ruido en la pantalla de todos los
            días. Una reserva por agencia tampoco lo muestra: ahí el receptor
            del comprobante es la agencia, no el turista. */}
        {reserva.huesped?.residente_exterior && !reserva.agencia_id && (
          <ExencionIva
            reserva={reserva}
            exento={exento}
            motivoExencion={motivoExencion}
            importeExento={importeExento}
          />
        )}
      </dl>
    </div>
  )
}

/* ── Desglose fiscal ──────────────────────────────────────────────────────
   El listado de WinPAX mostraba la tarifa con y sin impuestos. Antes del
   paso 6 esto no se podía: `total` guarda el importe con IVA y
   `tarifas.iva_pct` puede variar por tarifa, así que dividir por 1,21 daba un
   número aproximado y silenciosamente equivocado. */
function Importes({ reserva }: { reserva: Reserva }) {
  return (
    <div className="border-t border-stone-100 pt-3">
      <dt className="text-xs tracking-wide text-stone-600 uppercase">Importes</dt>
      {/*
        Si el desglose no cierra contra el total, se dice en vez de
        publicarlo.

        `neto + iva` tiene que dar `total`. Cuando no da —una reserva
        importada de un canal, una migrada de WinPAX, una cargada por un
        script— la pantalla mostraba «Subtotal USD 0,00 / Neto USD 0,00 /
        IVA USD 0,00 / Total USD 363,00» con toda naturalidad. Eso es peor
        que no mostrar nada: se lee como un comprobante y no cierra, y
        alguien lo puede copiar a una factura.

        Se comparan con un centavo de tolerancia, porque los importes se
        redondean a dos decimales en varios puntos del camino.
      */}
      {Math.abs(Number(reserva.total_neto) + Number(reserva.iva) - Number(reserva.total)) >
      0.01 ? (
        <dd className="mt-1 space-y-1 text-sm">
          <div className="flex justify-between font-semibold text-stone-900">
            <span>Total con IVA</span>
            <span className="tabular">{formatearUSD(Number(reserva.total))}</span>
          </div>
          <p className="rounded-lg bg-lenga-50 px-3 py-2 text-xs text-lenga-800 ring-1 ring-lenga-100">
            Esta reserva no tiene cargado el desglose entre neto e IVA, así que no se
            muestra: los números no cerrarían con el total. El importe que se cobra es el
            de arriba. Si hace falta facturarla, cargá el desglose antes de emitir.
          </p>
        </dd>
      ) : (
        <dd className="mt-1 space-y-0.5 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-500">Subtotal sin IVA</span>
            <span className="tabular text-stone-700">
              {formatearUSD(Number(reserva.subtotal))}
            </span>
          </div>
          {Number(reserva.descuento_pct) > 0 && (
            <div className="flex justify-between">
              <span className="text-stone-500">
                Descuento {Number(reserva.descuento_pct)}%
              </span>
              <span className="tabular text-stone-700">
                −{formatearUSD(Number(reserva.subtotal) - Number(reserva.total_neto))}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-stone-500">Neto gravado</span>
            <span className="tabular text-stone-700">
              {formatearUSD(Number(reserva.total_neto))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">IVA</span>
            <span className="tabular text-stone-700">
              {formatearUSD(Number(reserva.iva))}
            </span>
          </div>
          <div className="flex justify-between border-t border-stone-100 pt-1 font-semibold text-stone-900">
            <span>Total con IVA</span>
            <span className="tabular">
              {formatearUSD(Number(reserva.total))}
            </span>
          </div>
        </dd>
      )}
    </div>
  )
}

function ExencionIva({
  reserva,
  exento,
  motivoExencion,
  importeExento,
}: {
  reserva: Reserva
  exento: boolean
  motivoExencion: ReturnType<typeof motivoSinExencion>
  importeExento: number
}) {
  return (
    <div className="border-t border-stone-100 pt-3">
      <dt className="text-xs tracking-wide text-stone-600 uppercase">
        Exención de IVA · turista del exterior
      </dt>
      <dd className="mt-2 space-y-2 text-sm">
        {exento ? (
          <p className="rounded-lg bg-lenga-50 px-3 py-2 text-lenga-900">
            <strong>Corresponde la exención.</strong> Al facturar, el
            alojamiento sale sin IVA:{' '}
            <span className="tabular font-semibold">
              {formatearUSD(importeExento)}
            </span>{' '}
            en vez de {formatearUSD(Number(reserva.total))}. Los
            consumos (frigobar, excursiones) siguen gravados.
          </p>
        ) : (
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-stone-700">
            {motivoExencion && MENSAJES_SIN_EXENCION[motivoExencion]}
          </p>
        )}

        <form action={fijarOrigenDelPago} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="reserva_id" value={reserva.id} />
          <label className="flex-1 text-xs text-stone-600">
            <span className="mb-1 block">¿De dónde sale el pago?</span>
            <select
              name="origen_pago"
              defaultValue={
                reserva.pago_desde_exterior === true
                  ? 'exterior'
                  : reserva.pago_desde_exterior === false
                    ? 'local'
                    : 'sin_definir'
              }
              className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            >
              <option value="sin_definir">Todavía no se sabe</option>
              <option value="exterior">
                Del exterior — tarjeta emitida afuera o transferencia
              </option>
              <option value="local">
                Local — efectivo, tarjeta o transferencia del país
              </option>
            </select>
          </label>
          <BotonEnvio variante="secundario" cargando="Guardando…">
            Guardar
          </BotonEnvio>
        </form>
      </dd>
    </div>
  )
}
