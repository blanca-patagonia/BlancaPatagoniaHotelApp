import Link from 'next/link'
import { type EstadoReserva } from '@/lib/domain/reservas'
import { formatoFechaCorta } from '@/lib/fechas'
import { registrarPago, verificarTarjetaGarantia, generarLinkDePago } from '../cobros.actions'
import { agregarConsumo, quitarConsumo } from '../consumos.actions'
import { emitirFactura } from '../factura.actions'
import { proveedoresHabilitados, nombreClave } from '@/lib/payments'
import { MEDIOS_DE_COBRO, MONEDA_BASE, motivoNoSeCobra } from '@/lib/domain/cobro'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { MONEDAS_EXTRANJERAS, ETIQUETAS_MONEDA, formatearLocal } from '@/lib/domain/divisas'
import { motivoNoFacturable, MENSAJES_NO_FACTURABLE } from '@/lib/domain/facturacion'
import {
  ETIQUETAS_VERIFICACION,
  MENSAJES_GARANTIA,
  motivoGarantiaNoSirve,
  tarjetaEnmascarada,
  type EstadoVerificacionTarjeta,
} from '@/lib/domain/garantia-tarjeta'
import { BotonEnvio } from '../../_components/boton-envio'
import { Etiqueta } from '../../_components/ui'
import {
  cuentaConsolidada,
  ETIQUETAS_CATEGORIA_PRODUCTO,
  type CategoriaProducto,
} from '@/lib/domain/consumos'
import {
  resumenPagos,
  ETIQUETAS_MEDIO,
  ETIQUETAS_TIPO_PAGO,
  TIPOS_PAGO,
  type MedioPago,
  type TipoPago,
  type EstadoPago,
} from '@/lib/domain/pagos'
import { formatearUSD } from '@/lib/domain/moneda'

/**
 * La columna de la plata de la ficha de una reserva: pagos, cobro en línea,
 * tarjeta de garantía y consumos con la cuenta.
 *
 * Separada de `page.tsx` (2026-10-20), que pasaba las 1.700 líneas: la página
 * lee los datos y decide; estas secciones sólo los muestran y llevan los
 * formularios de sus acciones. Son componentes de servidor, sin estado.
 */

export interface PagoRow {
  id: string
  medio: MedioPago
  tipo: TipoPago
  /** SIEMPRE en USD: es lo único que salda la reserva (migración 0067). */
  monto: number | string
  estado: EstadoPago
  creado_en: string
  /** Moneda que de verdad pasó por la caja o la pasarela. */
  moneda: string | null
  /** Importe en `moneda`. Nulo cuando se cobró en dólares. */
  monto_cobrado: number | string | null
  cupon: string | null
  ultimos4: string | null
  tarjeta_marca: string | null
}

export interface ConsumoRow {
  id: string
  cantidad: number
  precio_unitario: number | string
  producto: { nombre: string; categoria: CategoriaProducto } | null
}

export interface ProductoRow {
  id: string
  nombre: string
  categoria: CategoriaProducto
  precio: number | string
}

const MEDIOS_MANUALES: MedioPago[] = ['efectivo', 'transferencia', 'tarjeta']

export function SeccionPagos({
  reserva,
  resumen,
  pagos,
  senia,
}: {
  reserva: { id: string; total: number | string }
  resumen: ReturnType<typeof resumenPagos>
  pagos: PagoRow[]
  senia: number
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-stone-700">Pagos</h2>
      {/* Total / pagado / saldo son importes en USD: en tres columnas de
          110px se cortaban. En móvil van de a uno. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-stone-50 px-4 py-3">
          <p className="text-xs text-stone-600">Total</p>
          <p className="text-lg font-semibold text-stone-900">
            {formatearUSD(Number(reserva.total))}
          </p>
        </div>
        <div className="rounded-lg bg-emerald-50 px-4 py-3">
          <p className="text-xs text-emerald-600">Pagado</p>
          <p className="text-lg font-semibold text-emerald-700">
            {formatearUSD(resumen.pagado)}
          </p>
        </div>
        <div className="rounded-lg bg-lenga-50 px-4 py-3">
          <p className="text-xs text-lenga-600">Saldo</p>
          <p className="text-lg font-semibold text-lenga-700">
            {formatearUSD(resumen.saldo)}
          </p>
        </div>
      </div>

      {pagos.length > 0 && (
        <ul className="mt-4 divide-y divide-stone-100 text-sm">
          {pagos.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0 text-stone-600">
                {ETIQUETAS_TIPO_PAGO[p.tipo]} · {ETIQUETAS_MEDIO[p.medio]}
                {p.estado !== 'aprobado' && (
                  <>
                    {' '}
                    <Etiqueta tono={p.estado === 'pendiente' ? 'alerta' : 'peligro'}>
                      {p.estado === 'pendiente' ? 'Pendiente' : 'Rechazado'}
                    </Etiqueta>
                  </>
                )}
                {/* El rastro del posnet y el importe en moneda local. Es lo que
                    permite conciliar contra la liquidación de la terminal
                    cuando los números no cierran. */}
                {detalleDelCobro(p) && (
                  <span className="mt-0.5 block text-xs text-stone-500">
                    {detalleDelCobro(p)}
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 font-medium ${p.tipo === 'reembolso' ? 'text-red-600' : 'text-stone-800'} ${p.estado !== 'aprobado' ? 'text-stone-400 line-through' : ''}`}
              >
                {p.tipo === 'reembolso' ? '−' : ''}{formatearUSD(Number(p.monto))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Una reserva saldada también puede necesitar una devolución —de hecho es
          el único caso en que hay algo que devolver—, así que el formulario ya
          no se esconde. Lo que cambia es qué se puede cargar: sobre una saldada,
          sólo un reembolso. Antes el `else` lo ocultaba entero y no había ningún
          camino, ni manual ni por pasarela, para registrar una devolución. */}
      {resumen.saldada && (
        <p className="mt-4 text-sm font-medium text-emerald-700">
          ✓ Reserva saldada. Si hubo que devolver plata, registrala como reembolso.
        </p>
      )}
      {(
        <form action={registrarPago} className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="reserva_id" value={reserva.id} />
          {/* Clave de idempotencia del cobro de mostrador. Se genera acá, al
              renderizar: es la misma para dos envíos del mismo formulario —un
              reintento de red, un F5 sobre el POST, el botón de atrás— y
              distinta en cada carga, así que un segundo pago legítimo entra
              igual. La rechaza el `unique` de `pagos.external_id`. */}
          <input type="hidden" name="idempotencia" value={crypto.randomUUID()} />
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Medio</span>
            <select name="medio" className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm">
              {MEDIOS_MANUALES.map((m) => (
                <option key={m} value={m}>
                  {ETIQUETAS_MEDIO[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Tipo</span>
            <select
              name="tipo"
              defaultValue={
                resumen.saldada ? 'reembolso' : resumen.tieneSenia ? 'saldo' : 'senia'
              }
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            >
              {(resumen.saldada ? (['reembolso'] as const) : TIPOS_PAGO).map((t) => (
                <option key={t} value={t}>
                  {ETIQUETAS_TIPO_PAGO[t]}
                </option>
              ))}
            </select>
          </label>
          {/* La moneda del cobro. Un huésped que paga en efectivo en pesos es
              el caso más común del hotel; antes había que hacer la conversión
              a mano y anotar el resultado, así que no quedaba registro de
              cuántos pesos entraron ni a qué cambio y la caja no cerraba
              contra el sistema. `monto` se sigue guardando en USD —es lo único
              que salda la reserva— y el importe real va aparte. */}
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Moneda</span>
            <select
              name="moneda"
              defaultValue={MONEDA_BASE}
              className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-auto"
            >
              <option value={MONEDA_BASE}>Dólares (USD)</option>
              {MONEDAS_EXTRANJERAS.map((m) => (
                <option key={m} value={m}>
                  {ETIQUETAS_MONEDA[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Monto</span>
            <input
              name="monto"
              type="number"
              step="0.01"
              min="0"
              defaultValue={resumen.tieneSenia ? resumen.saldo : senia}
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-32"
            />
          </label>

          {/* Rastro del posnet. Se piden SIEMPRE, no sólo al elegir tarjeta:
              esconderlos detrás de la selección del medio exigiría JavaScript
              de cliente en una pantalla que hoy es un formulario de servidor, y
              el proyecto prohíbe esconder campos. Son opcionales y la acción
              los ignora si el medio no es tarjeta.
              ⚠️ NO hay campo para el número de tarjeta y no debe haberlo: la
              migración 0067 rechaza un PAN en estas columnas (ADR 0025). */}
          <fieldset className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-stone-200 p-3">
            <legend className="px-1 text-xs text-stone-500">
              Si cobrás con el posnet (opcional)
            </legend>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Cupón / autorización</span>
              <input
                name="cupon"
                inputMode="numeric"
                autoComplete="off"
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-36"
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Últimos 4 dígitos</span>
              <input
                name="ultimos4"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                autoComplete="off"
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-28"
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Marca</span>
              <input
                name="tarjeta_marca"
                autoComplete="off"
                placeholder="Visa"
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-28"
              />
            </label>
          </fieldset>

          {/* El caso que más importa: sin bloqueo, un segundo clic
              registraba el pago dos veces. */}
          <BotonEnvio
            extra="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 sm:w-auto"
            cargando="Registrando…"
          >
            Registrar pago
          </BotonEnvio>
        </form>
      )}
      <p className="mt-3 text-xs text-stone-600">
        Seña sugerida (primera noche): {formatearUSD(senia)}.
      </p>
    </div>
  )
}

/* ── Tarjeta de garantía (ADR 0025) ─────────────────────────────────
    Vive en la columna de la plata y no en «Estadía», que es donde estaba.

    Dos razones. La de fondo: una tarjeta de garantía no describe la
    estadía, es lo que permite COBRAR un no-show, así que su lugar está
    junto a los pagos y la cuenta. La práctica: el formulario ocupa unos
    450 px y siempre está abierto —no se puede plegar, el proyecto lo
    prohíbe—, así que dejaba la tarjeta «Estadía» en 1.100 px, más del
    triple que cualquier otra, y toda la columna derecha en blanco.

    El sistema NO guarda el número de tarjeta: guarda el token que
    devuelve la pasarela, los últimos cuatro dígitos y el resultado de la
    verificación. Ver el ADR antes de agregar campos acá. */
export function SeccionGarantia({
  reserva,
  garantiaOk,
  motivoGarantia,
}: {
  reserva: {
    id: string
    tarjeta_ultimos4: string | null
    tarjeta_marca: string | null
    tarjeta_verificacion: EstadoVerificacionTarjeta
  }
  garantiaOk: boolean
  motivoGarantia: ReturnType<typeof motivoGarantiaNoSirve>
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-stone-700">Tarjeta de garantía</h2>
      <dl>
            <div>
              <dd className="space-y-2 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="tabular font-medium text-stone-800">
                    {tarjetaEnmascarada(reserva.tarjeta_ultimos4, reserva.tarjeta_marca)}
                  </span>
                  <Etiqueta
                    tono={
                      garantiaOk
                        ? 'exito'
                        : reserva.tarjeta_verificacion === 'rechazada'
                          ? 'peligro'
                          : 'alerta'
                    }
                  >
                    {ETIQUETAS_VERIFICACION[reserva.tarjeta_verificacion]}
                  </Etiqueta>
                </p>

                {motivoGarantia && (
                  <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-snug text-stone-700">
                    {MENSAJES_GARANTIA[motivoGarantia]}
                  </p>
                )}

                {/* Formulario SIEMPRE visible: `CLAUDE.md` prohíbe esconder una
                    acción detrás de un `<details>`, y acá pesa doble — si la
                    garantía no sirve, cargar otra tarjeta es justo lo que hay
                    que hacer y no puede estar a un clic de distancia.
                    `autoComplete="off"` en el número y el código: no tienen por
                    qué quedar en el historial de un puesto compartido. */}
                <div className="rounded-lg border border-stone-200 p-3 text-xs">
                  <p className="mb-2 font-medium text-stone-700">
                    {reserva.tarjeta_ultimos4 ? 'Cambiar la tarjeta' : 'Cargar una tarjeta'}
                  </p>
                  <form
                    action={verificarTarjetaGarantia}
                    autoComplete="off"
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    <input type="hidden" name="reserva_id" value={reserva.id} />
                    <label className="sm:col-span-2">
                      <span className="mb-1 block text-stone-600">Número de tarjeta</span>
                      <input
                        name="tarjeta_numero"
                        inputMode="numeric"
                        autoComplete="off"
                        required
                        className="w-full rounded-lg border border-stone-300 px-2 py-1.5"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-stone-600">Vencimiento (MM/AA)</span>
                      <input
                        name="tarjeta_vencimiento"
                        placeholder="12/28"
                        pattern="(0[1-9]|1[0-2])/[0-9]{2}"
                        required
                        className="w-full rounded-lg border border-stone-300 px-2 py-1.5"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-stone-600">Código de seguridad</span>
                      <input
                        name="tarjeta_cvv"
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        className="w-full rounded-lg border border-stone-300 px-2 py-1.5"
                      />
                    </label>
                    <label className="sm:col-span-2">
                      <span className="mb-1 block text-stone-600">Titular</span>
                      <input
                        name="tarjeta_titular"
                        autoComplete="off"
                        className="w-full rounded-lg border border-stone-300 px-2 py-1.5"
                      />
                    </label>
                    <p className="text-[11px] leading-snug text-stone-500 sm:col-span-2">
                      El sistema <strong>no guarda</strong> el número ni el código de seguridad:
                      se los manda a la pasarela y conserva solo los últimos cuatro dígitos y el
                      resultado.
                    </p>
                    <div className="sm:col-span-2">
                      <BotonEnvio variante="secundario" cargando="Verificando…">
                        Verificar tarjeta
                      </BotonEnvio>
                    </div>
                  </form>
                </div>
              </dd>
            </div>
      </dl>
    </div>
  )
}

export function SeccionConsumos({
  reserva,
  factura,
  fallaFactura,
  motivoFactura,
  consumos,
  productos,
  cuenta,
}: {
  reserva: { id: string; codigo: string }
  factura: { numero: string } | null
  fallaFactura: boolean
  motivoFactura: ReturnType<typeof motivoNoFacturable>
  consumos: ConsumoRow[]
  productos: ProductoRow[]
  cuenta: ReturnType<typeof cuentaConsolidada>
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-stone-700">Consumos y cuenta</h2>
        <div className="flex flex-wrap items-center gap-3">
        {/* La cuenta detallada vive aparte: acá está la consolidada, que alcanza
            para el día a día. El detalle por departamento y el split entre folios
            son de administración y ocuparían la pantalla entera. */}
        <Link
          href={`/panel/reservas/${reserva.id}/cuenta`}
          className="text-sm font-medium text-lago-700 hover:underline"
        >
          Ver cuenta detallada
        </Link>
        {factura ? (
          <Link
            href={`/panel/reservas/${reserva.id}/factura`}
            className="text-sm font-medium text-lago-700 hover:underline"
          >
            Ver factura {factura.numero}
          </Link>
        ) : fallaFactura ? (
          /* No se pudo verificar si ya tiene factura: no corresponde ofrecer
             "Emitir factura" sin saberlo — podría estar duplicando una que
             ya existe. */
          <span className="max-w-sm text-right text-xs text-red-700">
            No se pudo verificar si esta reserva ya tiene factura. Recargá antes de emitir una
            nueva.
          </span>
        ) : motivoFactura ? (
          /* El botón no se ofrece si no corresponde: es más claro explicar por
             qué que dejar apretar y devolver un error. */
          <span className="max-w-sm text-right text-xs text-stone-600">
            {MENSAJES_NO_FACTURABLE[motivoFactura]}
          </span>
        ) : (
          <form action={emitirFactura}>
            <input type="hidden" name="reserva_id" value={reserva.id} />
            <BotonEnvio
              cargando="Emitiendo…"
              confirmar={`¿Emitir la factura de ${reserva.codigo}? Una vez emitida no se puede anular desde el sistema.`}
            >
              Emitir factura
            </BotonEnvio>
          </form>
        )}
        </div>
      </div>

      {consumos.length > 0 && (
        <ul className="mt-3 divide-y divide-stone-100 text-sm">
          {consumos.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <span className="text-stone-600">
                {c.cantidad}× {c.producto?.nombre}
                <span className="ml-2 text-xs text-stone-600">
                  {c.producto ? ETIQUETAS_CATEGORIA_PRODUCTO[c.producto.categoria] : ''}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-medium text-stone-800">
                  {formatearUSD((c.cantidad * Number(c.precio_unitario)))}
                </span>
                {/* Quitar un cargo es un borrado irreversible de dinero de la
                    cuenta del huésped. Antes era un `<button>` crudo con `✕`:
                    sin confirmación, sin estado de envío y sin nombre
                    accesible —un lector de pantalla anunciaba «botón»—.
                    `anularComanda` ya hacía lo correcto para el lote; esto
                    quedó afuera. */}
                {/* Con la factura emitida la cuenta está cerrada: el servidor
                    rechaza quitar un cargo, así que tampoco se ofrece. */}
                {!factura && (
                <form action={quitarConsumo}>
                  <input type="hidden" name="reserva_id" value={reserva.id} />
                  <input type="hidden" name="consumo_id" value={c.id} />
                  <BotonEnvio
                    variante="fantasma"
                    cargando="Quitando…"
                    aria-label={`Quitar ${c.producto?.nombre ?? 'el consumo'} de la cuenta`}
                    confirmar={`¿Quitar ${c.cantidad}× ${c.producto?.nombre ?? 'este consumo'} por ${formatearUSD(c.cantidad * Number(c.precio_unitario))} de la cuenta? No se puede deshacer.`}
                  >
                    ✕
                  </BotonEnvio>
                </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form action={agregarConsumo} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="reserva_id" value={reserva.id} />
        <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
          <span className="text-stone-500">Producto / servicio</span>
          <select
            name="producto_id"
            required
            className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
          >
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} — {formatearUSD(Number(p.precio))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
          <span className="text-stone-500">Cant.</span>
          <input
            name="cantidad"
            type="number"
            min="1"
            defaultValue={1}
            className="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
          />
        </label>
        <BotonEnvio extra="w-full sm:w-auto" cargando="Cargando…">
          Cargar
        </BotonEnvio>
      </form>

      <dl className="mt-4 border-t border-stone-100 pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-stone-500">Alojamiento</dt>
          <dd className="text-stone-700">{formatearUSD(cuenta.alojamiento)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">Consumos</dt>
          <dd className="text-stone-700">{formatearUSD(cuenta.consumos)}</dd>
        </div>
        <div className="mt-1 flex justify-between border-t border-stone-100 pt-1 font-semibold text-stone-900">
          <dt>Total cuenta</dt>
          <dd>{formatearUSD(cuenta.total)}</dd>
        </div>
      </dl>
    </div>
  )
}

/* ─────────────────────────────────────────────────── cobro en línea ────── */

/**
 * Generar y reenviar el link de pago del huésped.
 *
 * Resuelve el caso del huésped que reservó por teléfono o WhatsApp: no está en
 * el mostrador para dar la tarjeta y dictarla por teléfono es justo lo que no
 * hay que hacer. Se le manda el link, paga desde su celular y el webhook salda
 * la reserva sin que recepción toque nada.
 *
 * Cuando ya hay un link vivo **se muestra ése y no se ofrece crear otro**: dos
 * links por el mismo saldo son dos cobros posibles, y devolver uno es un trámite
 * manual con la pasarela más una discusión con el huésped.
 */
export function CobroEnLinea({
  reserva,
  cobro,
}: {
  reserva: { id: string; estado: EstadoReserva }
  cobro: Awaited<ReturnType<typeof estadoDeCobro>>
}) {
  if (!cobro) return null

  const impedimento = motivoNoSeCobra(reserva.estado, cobro.saldo)
  const habilitados = new Set(proveedoresHabilitados().map(nombreClave))

  // El catálogo más el simulador, que no está en el catálogo porque no es un
  // medio que se le ofrezca a nadie: es la herramienta de demostración.
  const medios = [
    ...MEDIOS_DE_COBRO.filter((m) => habilitados.has(m.id)).map((m) => ({
      valor: m.id as string,
      titulo: m.titulo,
    })),
    ...(habilitados.has('simulado')
      ? [{ valor: 'simulado', titulo: 'Pago simulado (no mueve dinero)' }]
      : []),
  ]

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-medium text-stone-700">Link de pago</h2>
      <p className="mb-3 text-xs leading-snug text-stone-500">
        Para mandarle al huésped por correo o WhatsApp. Paga desde su teléfono y la reserva se
        salda sola.
      </p>

      {cobro.linksVivos.length > 0 ? (
        <div className="space-y-3">
          {cobro.linksVivos.map((l) => (
            <div key={l.externalId} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-stone-800">
                  {l.tipo === 'senia' ? 'Seña' : 'Saldo'} · {formatearUSD(l.monto)}
                </span>
                {l.moneda !== MONEDA_BASE && l.montoCobrado !== null && (
                  <span className="text-xs text-stone-500">
                    se cobra{' '}
                    {MONEDAS_EXTRANJERAS.includes(l.moneda as (typeof MONEDAS_EXTRANJERAS)[number])
                      ? formatearLocal(
                          l.montoCobrado,
                          l.moneda as (typeof MONEDAS_EXTRANJERAS)[number],
                        )
                      : `${l.moneda} ${l.montoCobrado}`}
                  </span>
                )}
              </p>

              {/* El enlace completo y seleccionable, no un botón de «copiar»:
                  copiar al portapapeles necesita JavaScript de cliente y falla
                  en silencio si el navegador lo bloquea. Un texto que se puede
                  leer y seleccionar funciona siempre. */}
              <p className="mt-1 break-all rounded border border-stone-200 bg-white px-2 py-1.5 font-mono text-xs text-stone-600 select-all">
                {l.url}
              </p>

              <p className="mt-1 text-xs text-stone-500">
                {l.venceEn
                  ? `Vence el ${formatoFechaCorta(l.venceEn.slice(0, 10))}.`
                  : 'Sin vencimiento.'}
              </p>
            </div>
          ))}
          <p className="text-xs text-stone-500">
            Ya hay un link activo por este saldo. No se genera otro para que el huésped no
            pueda pagar dos veces.
          </p>
        </div>
      ) : impedimento ? (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-snug text-stone-600">
          {impedimento}
        </p>
      ) : medios.length === 0 ? (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-snug text-stone-600">
          No hay ninguna pasarela habilitada. Se configura con la variable{' '}
          <code className="font-mono">PAGO_PROVIDER</code>.
        </p>
      ) : (
        <form action={generarLinkDePago} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="reserva_id" value={reserva.id} />
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Medio</span>
            <select
              name="medio"
              className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-auto"
            >
              {medios.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.titulo}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Cobrar</span>
            <select
              name="tipo"
              defaultValue={cobro.tieneSenia ? 'saldo' : 'senia'}
              className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-auto"
            >
              <option value="senia">Seña ({formatearUSD(Math.min(cobro.senia, cobro.saldo))})</option>
              <option value="saldo">Saldo completo ({formatearUSD(cobro.saldo)})</option>
            </select>
          </label>
          <BotonEnvio extra="w-full sm:w-auto" cargando="Generando…">
            Generar link
          </BotonEnvio>
        </form>
      )}
    </div>
  )
}

/**
 * La línea chica bajo un pago: cuánto entró en moneda local y con qué cupón.
 *
 * Devuelve cadena vacía cuando no hay nada que agregar —un pago en dólares sin
 * tarjeta— para no ensuciar la lista con una línea en blanco.
 */
function detalleDelCobro(p: PagoRow): string {
  const partes: string[] = []

  if (p.moneda && p.moneda !== MONEDA_BASE && p.monto_cobrado !== null) {
    const monto = Number(p.monto_cobrado)
    partes.push(
      MONEDAS_EXTRANJERAS.includes(p.moneda as (typeof MONEDAS_EXTRANJERAS)[number])
        ? formatearLocal(monto, p.moneda as (typeof MONEDAS_EXTRANJERAS)[number])
        : `${p.moneda} ${monto}`,
    )
  }

  if (p.tarjeta_marca) partes.push(p.tarjeta_marca)
  if (p.ultimos4) partes.push(`•••• ${p.ultimos4}`)
  if (p.cupon) partes.push(`cupón ${p.cupon}`)

  return partes.join(' · ')
}
