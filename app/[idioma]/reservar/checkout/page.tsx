import Image from 'next/image'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { seniaSugerida } from '@/lib/domain/pagos'
import { fotoDe } from '@/lib/domain/catalogo'
import { DIAS_EXPIRACION } from '@/lib/domain/recordatorios'
import { diasEntre } from '@/lib/fechas'
import { HORA_CHECK_IN, HORA_CHECK_OUT } from '@/lib/domain/hotel'
import { formatearUSD } from '@/lib/domain/moneda'
import { opcionesDePago, type OpcionDePago } from '@/lib/payments/opciones'
import { politicaCancelacionPublica } from '@/lib/catalogo/publico'
import {
  textos,
  rellenar,
  plural,
  idiomaValido,
  rutaConIdioma,
  fechaCortaEn,
  fechaLargaEn,
  lineasCancelacion,
  type Diccionario,
  type Idioma,
} from '@/lib/i18n'
import { FormularioCheckout, type MedioOfrecido } from './formulario'
import { Marco } from '@/app/_publico/marco'
import { Pasos } from '@/app/_publico/pasos'

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Un paso intermedio con datos personales: no se indexa. El título sí hace
 * falta: sin él la pestaña heredaba el del layout raíz, «Gestión Hotelera»,
 * que es el nombre del sistema interno y no el del hotel.
 */
export async function generateMetadata({ params }: { params: Promise<{ idioma: string }> }) {
  const t = textos((await params).idioma)
  return { title: `${t.checkout.titulo} — Blanca Patagonia`, robots: { index: false } }
}

/**
 * Checkout: datos del huésped, forma de pago y resumen de la estadía.
 *
 * Estructura tomada del paso «Confirm your stay» de Aman: el formulario a la
 * izquierda y, fijo a la derecha, el resumen con el precio noche por noche, el
 * subtotal, los impuestos, la seña que se paga ahora, el saldo y el total. Quien
 * está por pagar quiere ver exactamente qué paga mientras completa los datos.
 *
 * ⚠️ **Acá NO se piden datos de tarjeta**, aunque Aman lo haga en su página. El
 * número se carga en la página de la pasarela (Stripe, MercadoPago): así el
 * hotel queda en el alcance SAQ-A de PCI-DSS y no guarda nada que se pueda
 * robar (ver `tests/garantia-tarjeta.test.ts` y los ADR 0025 y 0027).
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ idioma: string }>
  searchParams: Promise<{ tipo?: string; check_in?: string; check_out?: string; huespedes?: string }>
}) {
  const idioma = idiomaValido((await params).idioma)
  const tx = textos(idioma)
  const sp = await searchParams
  const tipo = String(sp.tipo ?? '')
  const checkIn = RE_FECHA.test(sp.check_in ?? '') ? sp.check_in! : ''
  const checkOut = RE_FECHA.test(sp.check_out ?? '') ? sp.check_out! : ''
  const huespedes = Math.max(1, Number(sp.huespedes ?? 1) || 1)
  if (!tipo || !checkIn || !checkOut || checkOut <= checkIn) notFound()

  // La búsqueda de la que se vino, para volver a ella con un clic.
  const consulta = new URLSearchParams({
    check_in: checkIn,
    check_out: checkOut,
    huespedes: String(huespedes),
    tipo,
  }).toString()

  const supabase = await crearClienteServidor()
  const { data: tipoData, error: errorTipo } = await supabase
    .from('tipos_unidad')
    .select('nombre, codigo, capacidad_max')
    .eq('id', tipo)
    .maybeSingle()
  registrarFalla(errorTipo, 'portal:checkout:tipo')
  if (!tipoData) notFound()
  const alojamiento = tipoData as { nombre: string; codigo: string; capacidad_max: number }

  const [cot, reglasCancelacion] = await Promise.all([
    cotizarEstadia({ tipoUnidadId: tipo, checkIn, checkOut, tarifaTipo: 'rack' }),
    politicaCancelacionPublica(),
  ])
  const noches = diasEntre(checkIn, checkOut)
  const total = cot.resumen.total
  // Misma regla que `estadoDeCobro`, que es la que después calcula lo que se
  // cobra: lo que se anuncia acá y lo que debita la pasarela son el mismo número.
  const senia = seniaSugerida(total, noches)
  const opciones = await opcionesDePago(senia)

  return (
    <Marco
      idioma={idioma}
      volver={{ href: rutaConIdioma(`/reservar?${consulta}`, idioma), texto: tx.checkout.volverOpciones }}
    >
      <Pasos
        actual={3}
        t={tx.pasos}
        enlaces={{
          1: `${rutaConIdioma(`/reservar?${consulta}`, idioma)}#buscador`,
          2: rutaConIdioma(`/reservar?${consulta}`, idioma),
        }}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-8">
        {/* En el teléfono el resumen va PRIMERO: se confirma qué se reserva
            antes de dar los datos. En escritorio pasa a la derecha y queda fijo. */}
        <aside className="lg:sticky lg:top-24 lg:order-2">
          <Resumen
            tx={tx}
            idioma={idioma}
            nombre={alojamiento.nombre}
            foto={fotoDe(alojamiento.codigo)}
            huespedes={huespedes}
            checkIn={checkIn}
            checkOut={checkOut}
            noches={noches}
            nochesTarifadas={cot.noches}
            subtotal={cot.resumen.totalNeto}
            iva={cot.resumen.iva}
            total={total}
            senia={senia}
          />
        </aside>

        <section className="border border-tinta/10 bg-white px-5 py-10 sm:px-12 sm:py-14 lg:order-1">
          <FormularioCheckout
            tipo={tipo}
            checkIn={checkIn}
            checkOut={checkOut}
            huespedes={huespedes}
            idioma={idioma}
            t={tx.checkout}
            medios={opciones.map((o) => medioOfrecido(o, tx))}
            seniaTexto={formatearUSD(senia)}
            diasExpiracion={DIAS_EXPIRACION}
            cancelacion={reglasCancelacion.length > 0 ? lineasCancelacion(reglasCancelacion, tx) : []}
          />
        </section>
      </div>
    </Marco>
  )
}

/**
 * Lo que el formulario necesita de cada medio, ya traducido.
 *
 * Los títulos de `MEDIOS_DE_COBRO` están en español porque también los usa la
 * pantalla de pago por token; acá se reemplazan por los del diccionario. Un
 * medio desconocido (una pasarela nueva sin traducir) se muestra con su texto
 * original antes que no mostrarse.
 */
function medioOfrecido(o: OpcionDePago, tx: Diccionario): MedioOfrecido {
  const c = tx.checkout
  const traducidos: Record<string, { titulo: string; detalle: string; formas: readonly string[] }> = {
    stripe: { titulo: c.medioStripe, detalle: c.medioStripeDetalle, formas: o.medio.formas },
    mercadopago: {
      titulo: c.medioMercadoPago,
      detalle: c.medioMercadoPagoDetalle,
      formas: c.formasMercadoPago,
    },
    simulado: { titulo: c.medioSimulado, detalle: c.medioSimuladoDetalle, formas: [] },
  }
  const textosMedio = traducidos[o.valor] ?? o.medio
  return {
    valor: o.valor,
    titulo: textosMedio.titulo,
    detalle: textosMedio.detalle,
    formas: [...textosMedio.formas],
    importe: o.importe,
    equivalencia: o.equivalenciaPartes ? rellenar(c.alCambio, o.equivalenciaPartes) : null,
  }
}

/* ───────────────────────────────────────────────────────── resumen ───── */

function Resumen({
  tx,
  idioma,
  nombre,
  foto,
  huespedes,
  checkIn,
  checkOut,
  noches,
  nochesTarifadas,
  subtotal,
  iva,
  total,
  senia,
}: {
  tx: Diccionario
  idioma: Idioma
  nombre: string
  foto: string | null
  huespedes: number
  checkIn: string
  checkOut: string
  noches: number
  nochesTarifadas: { fecha: string; precio: number | null }[]
  subtotal: number
  iva: number
  total: number
  senia: number
}) {
  const c = tx.checkout
  const saldo = Math.max(0, Math.round((total - senia) * 100) / 100)

  return (
    <div className="border border-tinta/25 bg-white">
      <h2 className="border-b border-tinta/25 px-5 py-5 font-display text-2xl font-light tracking-[-0.01em] text-tinta sm:px-6">
        {c.resumenTitulo}
      </h2>

      <div className="space-y-1 px-5 py-4 text-sm sm:px-6">
        <p className="text-tinta">
          <span className="text-tinta-suave">{tx.buscador.llegada}:</span>{' '}
          {fechaLargaEn(checkIn, idioma)} · {rellenar(c.desdeLas, { hora: HORA_CHECK_IN })}
        </p>
        <p className="text-tinta">
          <span className="text-tinta-suave">{tx.buscador.salida}:</span>{' '}
          {fechaLargaEn(checkOut, idioma)} · {rellenar(c.hastaLas, { hora: HORA_CHECK_OUT })}
        </p>
        <p className="pt-1 text-xs font-medium tracking-[0.16em] text-tinta-suave uppercase">
          {plural(noches, tx.buscador.unaNoche, tx.buscador.noches)} ·{' '}
          {plural(huespedes, tx.buscador.huesped, tx.buscador.huespedesN)}
        </p>
      </div>

      <p className="mx-5 border-t border-tinta/10 pt-4 text-[11px] font-medium tracking-[0.18em] text-tinta-suave uppercase sm:mx-6">
        {tx.pasos.alojamiento}
      </p>
      <div className="mx-5 mt-3 flex items-center gap-3 bg-hueso/80 p-3 sm:mx-6">
        <div className="min-w-0 flex-1 text-sm leading-relaxed text-tinta">
          <p className="font-medium">{nombre}</p>
          <p className="text-tinta-suave">{plural(huespedes, tx.buscador.huesped, tx.buscador.huespedesN)}</p>
        </div>
        {foto && (
          <div className="relative h-16 w-24 shrink-0 overflow-hidden">
            <Image src={foto} alt="" fill sizes="80px" className="object-cover" />
          </div>
        )}
      </div>

      {/* Precio noche por noche, SIN IVA, como lo factura el hotel: el IVA se
          discrimina en su propia línea (ADR 0004). Una noche sin tarifa se
          muestra «a confirmar», nunca como 0 (Fase 18). */}
      <dl className="mx-5 mt-4 space-y-1.5 border-b border-tinta/25 pb-4 text-sm sm:mx-6">
        {nochesTarifadas.map((n) => (
          <div key={n.fecha} className="flex justify-between gap-3">
            <dt className="text-tinta-suave">
              {rellenar(c.nocheDel, { fecha: fechaCortaEn(n.fecha, idioma) })}
            </dt>
            <dd className="tabular-nums text-tinta">
              {n.precio === null ? tx.ficha.aConfirmar : formatearUSD(n.precio)}
            </dd>
          </div>
        ))}
      </dl>

      <dl className="mx-5 space-y-1.5 border-b border-tinta/10 py-4 sm:mx-6">
        <Linea etiqueta={c.subtotal} valor={formatearUSD(subtotal)} />
        <Linea etiqueta={c.iva} valor={formatearUSD(iva)} />
      </dl>

      <dl className="mx-5 space-y-1.5 border-b border-tinta/25 py-4 sm:mx-6">
        <Linea etiqueta={c.seniaAhora} valor={formatearUSD(senia)} fuerte />
        <Linea etiqueta={c.saldoRestante} valor={formatearUSD(saldo)} />
      </dl>

      <div className="flex items-end justify-between gap-3 px-5 py-5 sm:px-6">
        <div>
          <p className="font-display text-xl font-light text-tinta">{c.total}</p>
          <p className="text-[10px] font-medium tracking-[0.16em] text-tinta-suave uppercase">
            {tx.ficha.impuestos}
          </p>
        </div>
        <p className="font-display text-2xl font-light whitespace-nowrap tabular-nums text-tinta">
          {formatearUSD(total)}
        </p>
      </div>
    </div>
  )
}

function Linea({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-3 ${fuerte ? 'text-base text-tinta' : 'text-sm text-tinta-suave'}`}
    >
      <dt>{etiqueta}</dt>
      <dd className="tabular-nums">{valor}</dd>
    </div>
  )
}
