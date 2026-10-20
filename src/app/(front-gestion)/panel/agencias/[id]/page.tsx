import Link from 'next/link'
import { mensajeDe } from '@/lib/listados'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import {
  saldoCuenta,
  pagadoPorReserva,
  primerCheckIn,
  pagoAgenciaVencido,
  vencimientoPagoAgencia,
  ETIQUETAS_TIPO_CUENTA,
  ETIQUETAS_MOVIMIENTO,
  type TipoCuenta,
  type TipoMovimiento,
  type Movimiento,
} from '@/lib/domain/cuentas'
import {
  MONEDAS_EXTRANJERAS,
  esMonedaExtranjera,
  formatearLocal,
} from '@/lib/domain/divisas'
import {
  registrarMovimiento,
  regenerarEnlacePortal,
  revocarEnlacePortal,
  eliminarComprobantePagoAgencia,
} from '../actions'
import { type CondicionIva } from '@/lib/domain/facturacion'
import {
  Encabezado,
  EstadoVacio,
  FILA,
  Mensaje,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../../_components/ui'
import { Icono } from '../../_components/iconos'
import { BotonEnvio } from '../../_components/boton-envio'
import { SubirFoto } from '../../_components/subir-foto'
import { FotoAdjuntaEliminable } from '../../_components/foto-adjunta-eliminable'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import { registrarFalla } from '@/lib/acciones'
import { hoyISO, formatoFechaCorta } from '@/lib/fechas'
import { traerTodo } from '@/lib/paginado'

interface Agencia {
  id: string
  nombre: string
  tipo: TipoCuenta
  cuit: string | null
  email: string | null
  descuento_pct: number
  telefono: string | null
  activo: boolean
  condicion_iva: CondicionIva
}
interface MovRow {
  id: string
  tipo: TipoMovimiento
  /** SIEMPRE en USD (migración 0078). Es lo único que entra al saldo. */
  monto: number | string
  moneda: string
  /** Importe del comprobante en `moneda`. Nulo si el movimiento fue en USD. */
  monto_origen: number | string | null
  concepto: string
  fecha: string
  reserva_id: string | null
  /** Ruta en el bucket privado `adjuntos-operativos` (migración 0103). Nulo si no tiene adjunto. */
  comprobante_ruta: string | null
  reserva: { codigo: string } | null
}

/** Lo mínimo para juzgar si el pago de una reserva de agencia está vencido (ver `lib/domain/cuentas.ts`). */
interface ReservaAgenciaRow {
  id: string
  codigo: string
  estado: string
  total: number | string
  estadias: { periodo: string }[] | null
}

/**
 * Mensajes de las acciones de esta ficha.
 *
 * Esta pantalla no recibía `searchParams`, así que el `?ok=datos` que las
 * acciones ya mandaban al guardar nunca se vio, y los fallos de escritura
 * tampoco.
 */
const MENSAJES_ERROR: Record<string, string> = {
  reserva_ajena: 'Esa reserva no es de esta agencia. El pago no se registró.',
  movimiento: 'No se pudo registrar el movimiento. El saldo de la cuenta quedó sin cambios.',
  movimiento_datos: 'Revisá el tipo y el importe: el monto tiene que ser mayor que cero.',
  moneda: 'Esa moneda no está entre las que el sistema sabe convertir.',
  sin_cotizacion:
    'No hay cotización disponible para esa moneda, así que el importe en dólares sería inventado. Cargá una a mano en Configuración o registrá el movimiento en USD.',
  datos: 'No se pudieron guardar los datos de la agencia.',
  activo: 'No se pudo cambiar el estado de la cuenta.',
  enlace: 'No se pudo actualizar el enlace del portal. El anterior sigue vigente.',
  comprobante: 'No se pudo subir el comprobante. Probá de nuevo o registrá el movimiento sin adjunto.',
  comprobante_eliminar: 'No se pudo eliminar el comprobante. Probá de nuevo.',
}

const MENSAJES_OK: Record<string, string> = {
  datos: 'Datos actualizados.',
  enlace: 'Enlace nuevo generado. El anterior dejó de funcionar: reenviale el nuevo al socio.',
  enlace_revocado: 'Enlace dado de baja. El socio ya no puede entrar al portal.',
  comprobante_eliminado: 'Comprobante eliminado.',
}

export default async function AgenciaDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  await requerirAcceso('agencias')
  const { id } = await params
  const { ok: okParam, error: errorParam } = await searchParams
  const supabase = await crearClienteServidor()

  /*
    El token va por `crearClienteAdmin` y el resto por el cliente del usuario.

    Desde la migración 0060 `agencias.token` **no es legible** con una sesión de
    staff: es la credencial de `/portal/<token>`, y con ella cualquiera de los
    cuatro roles podía abrir la cuenta corriente del socio y firmar un contrato
    en su nombre. Se lee aparte, con el cliente privilegiado, solo para armar el
    enlace que esta pantalla muestra.

    El resto de la fila sigue pasando por RLS, que es lo que corresponde: la
    política de lectura ya limita quién ve la ficha.
  */
  /*
    Los movimientos y las reservas van por `traerTodo`: el saldo se calcula
    sumando TODO el historial, y PostgREST corta en 1000 filas sin avisar. Una
    agencia con años de movimientos mostraba un saldo equivocado sin que nada
    lo delatara.
  */
  const [
    { data: agenciaData, error: eAgencia },
    movsLectura,
    { data: tokenData, error: eToken },
    reservasLectura,
  ] = await Promise.all([
    supabase.from('agencias').select('id, nombre, tipo, cuit, email, telefono, descuento_pct, activo, condicion_iva').eq('id', id).maybeSingle(),
    traerTodo<MovRow>((desde, hasta) =>
      supabase
        .from('movimientos_cuenta')
        .select(
          'id, tipo, monto, moneda, monto_origen, concepto, fecha, reserva_id, comprobante_ruta, reserva:reservas(codigo)',
        )
        .eq('agencia_id', id)
        .order('fecha', { ascending: false })
        .order('creado_en', { ascending: false })
        .order('id')
        .range(desde, hasta) as never,
    ),
    crearClienteAdmin()
      .from('agencias')
      .select('token, token_revocado_en')
      .eq('id', id)
      .maybeSingle(),
    // Reservas de esta agencia, para el aviso de pago vencido (regla del
    // dueño del hotel: se paga con un mes de anticipación al check-in). Las
    // canceladas quedan afuera: una reserva cancelada no genera reclamo.
    traerTodo<ReservaAgenciaRow>((desde, hasta) =>
      supabase
        .from('reservas')
        .select('id, codigo, estado, total, estadias(periodo)')
        .eq('agencia_id', id)
        .neq('estado', 'cancelada')
        .order('id')
        .range(desde, hasta) as never,
    ),
  ])
  registrarFalla(eAgencia, 'agencias:ficha')
  registrarFalla(eToken, 'agencias:token_portal')
  if (!agenciaData) notFound()
  if (movsLectura.error) registrarFalla({ message: movsLectura.error }, 'agencias:movimientos')
  if (reservasLectura.error) {
    registrarFalla({ message: reservasLectura.error }, 'agencias:reservas_vencimiento')
  }
  // Un saldo calculado sobre un historial incompleto se ve igual que uno real:
  // la pantalla lo avisa en vez de mostrarlo como cierto.
  const saldoIncompleto = Boolean(movsLectura.error || movsLectura.truncado)
  const agencia = agenciaData as Agencia
  // Puede ser null si la lectura privilegiada falla: la pantalla lo contempla
  // en vez de romperse, porque el enlace del portal es accesorio a la ficha.
  const datosToken = tokenData as { token: string; token_revocado_en: string | null } | null
  const tokenPortal = datosToken?.token ?? null
  const revocado = Boolean(datosToken?.token_revocado_en)
  const cabeceras = await headers()
  const origen = `${cabeceras.get('x-forwarded-proto') ?? 'http'}://${cabeceras.get('host') ?? 'localhost:3000'}`
  const movs = movsLectura.filas
  const saldo = saldoCuenta(movs.map((m) => ({ tipo: m.tipo, monto: Number(m.monto) }) as Movimiento))

  /*
    Pagos vencidos (pedido del dueño del hotel, 2026-09): una agencia tiene que
    abonar la reserva con un mes de anticipación al check-in. El vencimiento se
    deriva del check-in de la estadía —nunca se guarda (migración 0103)— y lo
    pagado es la suma de los pagos de ESTA reserva puntual, no el saldo general
    de la cuenta: una agencia puede estar al día con una reserva y atrasada con
    otra.
  */
  const pagadoPorReservaId = pagadoPorReserva(movs)
  const hoy = hoyISO()
  const reservasDeAgencia = reservasLectura.filas
  const reservasVencidas = reservasDeAgencia
    .map((r) => ({
      ...r,
      checkIn: primerCheckIn((r.estadias ?? []).map((e) => e.periodo)),
      totalPagado: pagadoPorReservaId.get(r.id) ?? 0,
    }))
    .filter(
      (r): r is typeof r & { checkIn: string } =>
        r.checkIn !== null &&
        pagoAgenciaVencido({ checkIn: r.checkIn, totalReserva: Number(r.total), totalPagado: r.totalPagado }, hoy),
    )

  return (
    <Pagina>
      <Link
        href="/panel/agencias"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a agencias
      </Link>

      {errorParam && (
        <div className="mb-4">
          <Mensaje tono="error">
            {mensajeDe(MENSAJES_ERROR, errorParam, 'No se pudo completar la operación.')}
          </Mensaje>
        </div>
      )}
      {okParam && MENSAJES_OK[okParam] && (
        <div className="mb-4">
          <Mensaje tono="ok">{MENSAJES_OK[okParam]}</Mensaje>
        </div>
      )}

      <Encabezado
        titulo={agencia.nombre}
        descripcion={`${ETIQUETAS_TIPO_CUENTA[agencia.tipo]}${agencia.cuit ? ` · CUIT ${agencia.cuit}` : ''} · ${agencia.email || 'sin email'} · descuento ${agencia.descuento_pct}%`}
        icono="agencias"
        acciones={
          <Link href={`/panel/agencias/${agencia.id}/editar`} className={botonClases('secundario')}>
            <Icono nombre="config" tam={16} />
            Editar datos
          </Link>
        }
      />
      {!agencia.activo && (
        <div className="mb-4">
          <Mensaje tono="error">
            Esta cuenta está dada de baja: no aparece al cargar reservas nuevas.
          </Mensaje>
        </div>
      )}
      {saldoIncompleto && (
        <div className="mb-4">
          <Mensaje tono="error">
            No se pudieron leer todos los movimientos de la cuenta: el saldo y el historial de
            abajo pueden estar incompletos. No lo uses para reclamar ni para conciliar.
          </Mensaje>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-600">Saldo</p>
          <p className={`text-2xl font-semibold ${saldo > 0 ? 'text-red-600' : 'text-stone-900'}`}>
            {formatearUSD(saldo)}
          </p>
          <p className="text-xs text-stone-600">
            {saldo > 0 ? 'adeuda al hotel' : 'sin deuda'} · en dólares
          </p>
        </div>
        <form action={registrarMovimiento} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="agencia_id" value={agencia.id} />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Tipo</span>
            <select name="tipo" className="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
              <option value="cargo">Cargo</option>
              <option value="pago">Pago</option>
            </select>
          </label>
          {/*
            Moneda del comprobante, no del saldo.

            El saldo de la cuenta vive en USD y sigue viviendo ahí; lo que se
            elige acá es en qué moneda está el papel que se está cargando. Sin
            este campo, un cargo de ARS 185.000 entraba como USD 185.000
            (auditoría 2026-09, P1-3).
          */}
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Moneda</span>
            <select
              name="moneda"
              defaultValue="USD"
              className="rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            >
              <option value="USD">USD</option>
              {MONEDAS_EXTRANJERAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Monto</span>
            <input
              name="monto"
              type="number"
              step="0.01"
              min="0"
              className="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Concepto</span>
            <input name="concepto" className="w-40 rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          {/*
            A qué reserva corresponde un PAGO. Sin esto, el aviso de «pago
            vencido» nunca se enteraba de lo cobrado —suma los pagos de cada
            reserva— y toda reserva de agencia figuraba vencida para siempre.
          */}
          {reservasDeAgencia.length > 0 && (
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              <span className="text-stone-500">Reserva (si es un pago)</span>
              <select
                name="reserva_id"
                defaultValue=""
                className="min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              >
                <option value="">— Ninguna en particular —</option>
                {reservasDeAgencia.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.codigo} · {formatearUSD(Number(r.total))}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/*
            Comprobante opcional (ADR 0037, migración 0103). Sirve sobre todo
            para un `pago`: es la constancia que la agencia mandó por correo o
            trajo impresa. Se sube junto con el movimiento — no hay forma de
            adjuntarlo después a uno ya cargado.
          */}
          <div className="w-40">
            <SubirFoto nombre="comprobante" etiqueta="Comprobante" ayuda="Opcional. JPG, PNG, WEBP o PDF." />
          </div>
          {/* Mueve dinero: el botón se bloquea mientras viaja al servidor para
              que un segundo clic no duplique el movimiento. */}
          <BotonEnvio cargando="Registrando…">Registrar</BotonEnvio>
        </form>
      </div>

      {/*
        Pagos vencidos (pedido del dueño del hotel, 2026-09): la agencia tiene
        que abonar la reserva con un mes de anticipación al check-in. Es el
        aviso que necesita el mostrador para reclamar o, en el peor caso,
        decidir liberar la unidad — no una cifra escondida en un reporte.
      */}
      {reservasVencidas.length > 0 && (
        <div className="mt-5">
          <Mensaje tono="error">
            <span className="block font-semibold">
              {reservasVencidas.length === 1
                ? 'Hay una reserva con el pago vencido.'
                : `Hay ${reservasVencidas.length} reservas con el pago vencido.`}
            </span>
            <span className="mt-1 block">
              La política del hotel es cobrarle a la agencia un mes antes del check-in. Estas ya
              pasaron esa fecha sin cubrir el total:
            </span>
            <ul className="mt-2 space-y-1">
              {reservasVencidas.map((r) => (
                <li key={r.id}>
                  <Link href={`/panel/reservas/${r.id}`} className="font-medium underline">
                    {r.codigo}
                  </Link>{' '}
                  · check-in {formatoFechaCorta(r.checkIn)} · vencía el{' '}
                  {formatoFechaCorta(vencimientoPagoAgencia(r.checkIn))} · pagado{' '}
                  {formatearUSD(r.totalPagado)} de {formatearUSD(Number(r.total))}
                </li>
              ))}
            </ul>
          </Mensaje>
        </div>
      )}


      {/* Enlace del portal: el socio ve sus contratos y su cuenta sin cuenta de usuario. */}
      <section className="mt-5 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-base font-semibold text-stone-900">Portal del socio</h2>
        <p className="mt-1 text-sm text-stone-500">
          Enlace personal para que consulte sus contratos y su cuenta corriente. Quien lo tenga
          accede: mandalo solo al contacto de la empresa.
        </p>
        <code className="mt-3 block rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs break-all text-stone-700 ring-1 ring-stone-200">
          {origen}/portal/{tokenPortal}
        </code>
        {revocado && (
          <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
            <strong>Este enlace está dado de baja.</strong> El socio no puede entrar. Generá uno
            nuevo si necesita volver a acceder.
          </p>
        )}
        {!agencia.activo && (
          <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
            La cuenta está dada de baja, así que el portal no abre aunque el enlace exista.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={`/portal/${tokenPortal}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            Abrir el portal
          </a>

          {/* Regenerar y revocar son la respuesta a un enlace filtrado: hasta la
              migración 0063 no había ninguna, y el token servía para siempre. */}
          <form action={regenerarEnlacePortal}>
            <input type="hidden" name="agencia_id" value={agencia.id} />
            <BotonEnvio
              variante="secundario"
              cargando="Generando…"
              confirmar="¿Generar un enlace nuevo? El actual deja de funcionar en el momento, así que hay que reenviarle el nuevo al socio."
            >
              Generar enlace nuevo
            </BotonEnvio>
          </form>

          {!revocado && (
            <form action={revocarEnlacePortal}>
              <input type="hidden" name="agencia_id" value={agencia.id} />
              <BotonEnvio
                variante="fantasma"
                cargando="Dando de baja…"
                confirmar="¿Dar de baja el enlace? El socio pierde el acceso al portal hasta que se le genere uno nuevo."
              >
                Dar de baja el enlace
              </BotonEnvio>
            </form>
          )}
        </div>
      </section>

      <Tarjeta titulo="Movimientos" className="mt-6 overflow-hidden">
        {movs.length === 0 ? (
          <EstadoVacio titulo="Sin movimientos" icono="agencias" />
        ) : (
          <Tabla resumen="Movimientos de la cuenta corriente, con cargos y pagos">
            <thead>
              <tr>
                <th className={TH}>Fecha</th>
                <th className={TH}>Concepto</th>
                <th className={`${TH} text-right`}>Cargo</th>
                <th className={`${TH} text-right`}>Pago</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id} className={FILA}>
                  <td className={`${TD} text-stone-500`}>{m.fecha}</td>
                  <td className={`${TD} text-stone-700`}>
                    {m.concepto || ETIQUETAS_MOVIMIENTO[m.tipo]}
                    {m.reserva && <span className="ml-2 text-xs text-stone-600">{m.reserva.codigo}</span>}
                    {/*
                      Lo que decía el comprobante, cuando no fue en dólares. Las dos
                      columnas de la derecha están en USD porque el saldo vive ahí;
                      sin esta línea, quien concilia contra el papel no encuentra el
                      número que está buscando.
                    */}
                    {m.monto_origen !== null && esMonedaExtranjera(m.moneda) && (
                      <span className="block text-xs text-stone-500">
                        {formatearLocal(Number(m.monto_origen), m.moneda)} en el comprobante
                      </span>
                    )}
                    {/* Archivo adjunto (ADR 0037, migración 0103): subido desde el
                        mostrador al registrar el movimiento, o por la agencia desde
                        su portal. */}
                    {m.comprobante_ruta && (
                      <div className="mt-2">
                        <FotoAdjuntaEliminable
                          ruta={m.comprobante_ruta}
                          alt={`Comprobante de ${m.concepto || ETIQUETAS_MOVIMIENTO[m.tipo]}`}
                          accion={eliminarComprobantePagoAgencia}
                          camposOcultos={{ agencia_id: id, movimiento_id: m.id }}
                        />
                      </div>
                    )}
                  </td>
                  <td className={`${TD} tabular text-right text-stone-800`}>
                    {m.tipo === 'cargo' ? importe(Number(m.monto)) : ''}
                  </td>
                  <td className={`${TD} tabular text-right text-emerald-700`}>
                    {m.tipo === 'pago' ? importe(Number(m.monto)) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
    </Pagina>
  )
}
