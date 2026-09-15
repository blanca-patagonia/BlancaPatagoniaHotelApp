import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import {
  saldoCuenta,
  pagoAgenciaVencido,
  vencimientoPagoAgencia,
  type Movimiento,
} from '@/lib/domain/cuentas'
import {
  contratosDeEntidad,
  ETIQUETAS_ESTADO_CONTRATO,
  estaVigente,
  motivoNoFirmable,
  type EstadoContrato,
  type TipoContrato,
} from '@/lib/domain/contratos'
import {
  ETIQUETAS_ESTADO_COMPROBANTE,
  type EstadoComprobante,
} from '@/lib/domain/antiguedad'
import { esMonedaExtranjera, formatearLocal } from '@/lib/domain/divisas'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import { hoyISO, formatoFechaCorta, parsearPeriodo } from '@/lib/fechas'
import { subirComprobantePagoAgencia } from './actions'
import { SubirFoto } from '@/app/panel/_components/subir-foto'
import { FotoAdjunta } from '@/app/panel/_components/foto-adjunta'
import { BotonEnvio } from '@/app/panel/_components/boton-envio'

/**
 * Portal del socio: agencias y proveedores.
 *
 * Ven **solo lo suyo** — sus contratos y su cuenta corriente — sin necesidad de
 * una cuenta de usuario. El token opaco de la URL es la credencial y se resuelve
 * en el servidor con `service_role`, igual que la confirmación de reserva, la
 * firma y la encuesta. `anon` no tiene ninguna política de lectura sobre estas
 * tablas (ver ADR 0014).
 *
 * Server Component puro: sin JavaScript en el cliente.
 */

export const metadata = { title: 'Portal del socio — Blanca Patagonia' }

interface Socio {
  id: string
  nombre: string
  email: string | null
  cuit: string | null
}

interface ContratoRow {
  id: string
  tipo: TipoContrato
  entidad_id: string
  titulo: string
  estado: EstadoContrato
  vigencia_desde: string | null
  vigencia_hasta: string | null
}

interface MovRow {
  tipo: 'cargo' | 'pago'
  /** SIEMPRE en USD (migración 0078): es la moneda en la que cierra el saldo. */
  monto: number | string
  moneda: string
  /** Importe del comprobante en `moneda`. Nulo si el movimiento fue en USD. */
  monto_origen: number | string | null
  concepto: string
  fecha: string
  estado?: EstadoComprobante
  vencimiento?: string | null
  /** Solo en `movimientos_cuenta` (agencias): a qué reserva pertenece, si a alguna. */
  reserva_id?: string | null
  /** Ruta en el bucket privado `adjuntos-operativos` (migración 0103). */
  comprobante_ruta?: string | null
}

/** Reserva de la agencia, lo mínimo para el aviso de pago vencido y el selector de subida. */
interface ReservaRow {
  id: string
  codigo: string
  estado: string
  total: number | string
  estadias: { periodo: string }[] | null
}

const TONO_ESTADO: Record<EstadoContrato, string> = {
  borrador: 'bg-stone-100 text-stone-600',
  enviado: 'bg-lago-50 text-lago-800 ring-1 ring-lago-200',
  firmado: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  rechazado: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  vencido: 'bg-lenga-50 text-lenga-800 ring-1 ring-lenga-200',
}

const MENSAJES_ERROR: Record<string, string> = {
  limite: 'Recibimos varios envíos desde tu conexión. Probá de nuevo en un rato.',
  comprobante_datos: 'Elegí la reserva y el archivo antes de enviar.',
  token: 'Este enlace ya no está activo.',
  reserva: 'No encontramos esa reserva entre las tuyas.',
  reserva_cancelada: 'Esa reserva está cancelada: no hace falta comprobante.',
  subida: 'No se pudo subir el archivo. Probá de nuevo.',
  comprobante_guardar: 'El archivo se subió, pero no se pudo registrar. Escribinos y lo resolvemos.',
}

export default async function PortalSocioPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const { token } = await params
  const { ok: okParam, error: errorParam } = await searchParams
  const admin = crearClienteAdmin()

  /*
    El token identifica a una agencia o a un proveedor: se prueban ambos.

    ⚠️ Las dos condiciones de abajo no son decorativas. Antes esta consulta
    resolvía solo por token, así que:

      · dar de baja una agencia **no le cerraba el portal** — seguía viendo su
        cuenta corriente, sus contratos y el enlace para firmarlos;
      · un enlace filtrado servía para siempre, porque no había forma de
        invalidarlo (migración 0063).

    `activo` cierra el portal al dar de baja al socio; `token_revocado_en` lo
    cierra al regenerar el enlace, que es lo que se hace cuando uno se filtró.
  */
  const [{ data: agencia }, { data: proveedor }] = await Promise.all([
    admin
      .from('agencias')
      .select('id, nombre, email, cuit')
      .eq('token', token)
      .eq('activo', true)
      .is('token_revocado_en', null)
      .maybeSingle(),
    admin
      .from('proveedores')
      .select('id, nombre, email, cuit')
      .eq('token', token)
      .eq('activo', true)
      .is('token_revocado_en', null)
      .maybeSingle(),
  ])

  // `notFound()` y no un mensaje explicando que el enlace se dio de baja: a quien
  // tiene un token que ya no sirve no hay por qué confirmarle que alguna vez fue
  // válido, ni de qué socio era.
  const socio = (agencia ?? proveedor) as Socio | null
  if (!socio) notFound()
  const tipo: TipoContrato = agencia ? 'agencia' : 'proveedor'
  const esAgencia = tipo === 'agencia'

  const [{ data: contratosData }, { data: movsData }, { data: reservasData }] = await Promise.all([
    admin
      .from('contratos')
      .select('id, tipo, entidad_id, titulo, estado, vigencia_desde, vigencia_hasta')
      .eq('tipo', tipo)
      .eq('entidad_id', socio.id)
      .order('creado_en', { ascending: false }),
    esAgencia
      ? admin
          .from('movimientos_cuenta')
          .select('tipo, monto, moneda, monto_origen, concepto, fecha, reserva_id, comprobante_ruta')
          .eq('agencia_id', socio.id)
          .order('fecha', { ascending: false })
      : admin
          .from('movimientos_proveedor')
          .select('tipo, monto, moneda, monto_origen, concepto, fecha, estado, vencimiento')
          .eq('proveedor_id', socio.id)
          .order('fecha', { ascending: false }),
    // Solo para agencias: reservas vigentes, para el aviso de pago vencido y
    // el selector del formulario de subida. `esAgencia` decide con `? :`, no
    // con un `if` aparte, para poder pedirla en el mismo `Promise.all`.
    esAgencia
      ? admin
          .from('reservas')
          .select('id, codigo, estado, total, estadias(periodo)')
          .eq('agencia_id', socio.id)
          .neq('estado', 'cancelada')
          .order('creada_en', { ascending: false })
      : Promise.resolve({ data: null }),
  ])

  // El filtro por entidad ya lo hace la consulta; se vuelve a aplicar la regla
  // del dominio para que el aislamiento y el ocultamiento de borradores sean
  // una sola verdad testeada, y no dependan de recordar el `.eq()`.
  const contratos = contratosDeEntidad(
    tipo,
    socio.id,
    (contratosData ?? []) as ContratoRow[],
  )

  const movs = (movsData ?? []) as MovRow[]
  const saldo = saldoCuenta(
    movs.map((m) => ({ tipo: m.tipo, monto: Number(m.monto) }) as Movimiento),
  )

  /*
    Pagos vencidos (pedido del dueño del hotel, 2026-09): la agencia tiene que
    abonar cada reserva un mes antes del check-in. Se calcula igual que en la
    ficha de la agencia del panel (`lib/domain/cuentas.ts`): lo pagado es la
    suma de los pagos vinculados a ESA reserva puntual, no el saldo general —
    una agencia puede estar al día con una reserva y atrasada con otra.
  */
  const pagadoPorReserva = new Map<string, number>()
  for (const m of movs) {
    if (m.tipo !== 'pago' || !m.reserva_id) continue
    pagadoPorReserva.set(m.reserva_id, (pagadoPorReserva.get(m.reserva_id) ?? 0) + Number(m.monto))
  }
  const hoy = hoyISO()
  const reservas = esAgencia ? ((reservasData ?? []) as ReservaRow[]) : []
  const reservasConCheckIn = reservas
    .map((r) => {
      const checkIns = (r.estadias ?? []).map((e) => parsearPeriodo(e.periodo).desde)
      return { ...r, checkIn: checkIns.length ? checkIns.sort()[0] : null }
    })
    .filter((r): r is typeof r & { checkIn: string } => r.checkIn !== null)
  const reservasVencidas = reservasConCheckIn.filter((r) =>
    pagoAgenciaVencido(
      { checkIn: r.checkIn, totalReserva: Number(r.total), totalPagado: pagadoPorReserva.get(r.id) ?? 0 },
      hoy,
    ),
  )

  /*
    Las firmas se piden DESPUÉS y acotadas a los contratos de este socio.

    Antes era `admin.from('firmas').select(...)` sin `.eq()` ni `.limit()`: la
    tabla **entera**, con `service_role`, en cada visita de cualquier socio. Dos
    problemas:

    · **Funcional y silencioso.** PostgREST corta en 1000 filas sin error
      (`max_rows`, supabase/config.toml:10). Pasadas las 1000 firmas, a algunos
      socios les desaparecía el botón «Revisar y firmar» sin que nadie entendiera
      por qué — el mapa no tenía su contrato.
    · **De alcance.** Traer todos los tokens de firma del sistema a la memoria de
      una página pública, cuando se necesitan tres, es una fuga a un `console.log`
      de distancia.

    Va en una segunda consulta y no en el `Promise.all` porque depende de los
    contratos: es un viaje más, sobre una lista de a lo sumo unas decenas de ids.
  */
  const idsContrato = contratos.map((c) => c.id)
  const { data: firmasData } = idsContrato.length
    ? await admin
        .from('firmas')
        .select('contrato_id, token, fecha_firma')
        .in('contrato_id', idsContrato)
        .is('fecha_firma', null)
    : { data: [] }

  const firmas = (firmasData ?? []) as {
    contrato_id: string
    token: string
    fecha_firma: string | null
  }[]
  // El `.is('fecha_firma', null)` ya deja solo las pendientes; el filtro se
  // mantiene para que la regla siga siendo evidente al leer esta línea.
  const tokenPorContrato = new Map(
    firmas.filter((f) => !f.fecha_firma).map((f) => [f.contrato_id, f.token]),
  )

  return (
    <main className="flex flex-1 justify-center bg-gradient-to-b from-lago-50 to-stone-100 px-4 py-10">
      <div className="w-full max-w-3xl">
        <header className="mb-6">
          <p className="text-xs font-medium tracking-[0.2em] text-lago-700 uppercase">
            Blanca Patagonia · Portal del socio
          </p>
          <h1 className="font-display mt-1 text-3xl font-semibold text-stone-900">
            {socio.nombre}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {esAgencia ? 'Agencia / empresa con convenio' : 'Proveedor'}
            {socio.cuit && ` · CUIT ${socio.cuit}`}
          </p>
        </header>

        {errorParam && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
            {MENSAJES_ERROR[errorParam] ?? 'No se pudo completar la operación.'}
          </p>
        )}
        {okParam === 'comprobante' && (
          <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
            Comprobante recibido. El hotel lo va a revisar y confirmar.
          </p>
        )}

        {/* Pagos vencidos: la política del hotel es cobrar un mes antes del check-in. */}
        {esAgencia && reservasVencidas.length > 0 && (
          <div className="mb-4 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-800 ring-1 ring-red-200">
            <p className="font-semibold">
              {reservasVencidas.length === 1
                ? 'Hay una reserva con el pago vencido.'
                : `Hay ${reservasVencidas.length} reservas con el pago vencido.`}
            </p>
            <p className="mt-1">
              El hotel pide el pago un mes antes del check-in. Si ya lo hiciste, subí el
              comprobante más abajo.
            </p>
            <ul className="mt-2 space-y-1">
              {reservasVencidas.map((r) => (
                <li key={r.id}>
                  {r.codigo} · check-in {formatoFechaCorta(r.checkIn)} · vencía el{' '}
                  {formatoFechaCorta(vencimientoPagoAgencia(r.checkIn))}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Cuenta corriente */}
        <section className="mb-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5">
            <h2 className="font-display text-base font-semibold text-stone-900">
              Cuenta corriente
            </h2>
            <span className="text-sm">
              <span className="text-stone-500">
                {esAgencia ? 'Saldo a pagar al hotel: ' : 'Saldo a cobrar al hotel: '}
              </span>
              <span
                className={`tabular font-semibold ${saldo > 0 ? 'text-red-600' : 'text-emerald-700'}`}
              >
                {formatearUSD(saldo)}
              </span>
            </span>
          </header>

          {movs.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-stone-400">
              Todavía no hay movimientos registrados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <caption className="sr-only">
                  Movimientos de la cuenta corriente con su fecha, concepto e importe
                </caption>
                <thead>
                  <tr className="border-b border-stone-100 text-left text-xs tracking-wide text-stone-500 uppercase">
                    <th className="px-5 py-2.5">Fecha</th>
                    <th className="px-5 py-2.5">Concepto</th>
                    <th className="px-5 py-2.5 text-right">Cargo</th>
                    <th className="px-5 py-2.5 text-right">Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {movs.map((m, i) => (
                    <tr key={i} className="border-b border-stone-50 last:border-0">
                      <td className="tabular px-5 py-2 text-stone-500">
                        {formatoFechaCorta(m.fecha)}
                      </td>
                      <td className="px-5 py-2 text-stone-700">
                        {m.concepto || (m.tipo === 'cargo' ? 'Factura' : 'Pago')}
                        {m.vencimiento && (
                          <span className="ml-2 text-xs text-stone-400">
                            vence {formatoFechaCorta(m.vencimiento)}
                            {m.estado && m.estado !== 'pagado' && ` · ${ETIQUETAS_ESTADO_COMPROBANTE[m.estado]}`}
                          </span>
                        )}
                        {/*
                          El importe del comprobante en su moneda. Las dos columnas
                          de la derecha están en USD, que es donde cierra el saldo;
                          el socio necesita reconocer el número de su factura o el
                          estado de cuenta le parece equivocado.
                        */}
                        {m.monto_origen !== null && esMonedaExtranjera(m.moneda) && (
                          <span className="block text-xs text-stone-400">
                            {formatearLocal(Number(m.monto_origen), m.moneda)} en el comprobante
                          </span>
                        )}
                        {m.comprobante_ruta && (
                          <span className="mt-1 block">
                            <FotoAdjunta ruta={m.comprobante_ruta} alt={`Comprobante de ${m.concepto || 'pago'}`} />
                          </span>
                        )}
                      </td>
                      {/* Por `importe()` y no por `toLocaleString`: éste usa entre 0
                          y 3 decimales, así que la misma columna publicaba «726»,
                          «290,4» y «40,11». */}
                      <td className="tabular px-5 py-2 text-right text-stone-800">
                        {m.tipo === 'cargo' ? importe(Number(m.monto)) : ''}
                      </td>
                      <td className="tabular px-5 py-2 text-right text-emerald-700">
                        {m.tipo === 'pago' ? importe(Number(m.monto)) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/*
          Subir comprobante de pago (migración 0103). El hotel NO da el pago por
          confirmado con solo subirlo: queda adjunto a un movimiento `pago` para
          que el mostrador lo revise y cargue el importe real — igual que la
          conciliación bancaria (ADR 0030). Necesita al menos una reserva con
          fecha de check-in para elegir en el selector.
        */}
        {esAgencia && reservasConCheckIn.length > 0 && (
          <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="font-display text-base font-semibold text-stone-900">
              Subir comprobante de pago
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              El hotel lo revisa y lo confirma. Subirlo no da el pago por acreditado todavía.
            </p>
            <form action={subirComprobantePagoAgencia} className="mt-4 flex flex-col gap-4">
              <input type="hidden" name="token" value={token} />
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-stone-700">Reserva</span>
                <select
                  name="reserva_id"
                  required
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-lago-600"
                >
                  {reservasConCheckIn.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.codigo} · check-in {formatoFechaCorta(r.checkIn)}
                    </option>
                  ))}
                </select>
              </label>
              <SubirFoto
                nombre="comprobante"
                etiqueta="Comprobante"
                ayuda="JPG, PNG, WEBP o PDF. Hasta 8 MB."
                requerido
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-stone-700">Nota (opcional)</span>
                <input
                  name="nota"
                  maxLength={500}
                  placeholder="Por ejemplo: importe y fecha del pago"
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-lago-600"
                />
              </label>
              <div>
                <BotonEnvio cargando="Enviando…">Enviar comprobante</BotonEnvio>
              </div>
            </form>
          </section>
        )}

        {/* Contratos */}
        <section className="rounded-2xl border border-stone-200 bg-white shadow-sm">
          <header className="border-b border-stone-100 px-5 py-3.5">
            <h2 className="font-display text-base font-semibold text-stone-900">Contratos</h2>
            <p className="text-xs text-stone-500">
              Convenios y acuerdos vigentes con el hotel.
            </p>
          </header>

          {contratos.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-stone-400">
              No hay contratos para mostrar.
            </p>
          ) : (
            <ul>
              {contratos.map((c) => {
                const vigente = estaVigente(c, hoy)
                const firmable = motivoNoFirmable(c, hoy) === null
                const tokenFirma = tokenPorContrato.get(c.id)
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 border-t border-stone-100 px-5 py-3 first:border-0"
                  >
                    <div className="min-w-40 flex-1">
                      <p className="font-medium text-stone-800">{c.titulo}</p>
                      <p className="text-xs text-stone-400">
                        {c.vigencia_desde || c.vigencia_hasta ? (
                          <>
                            {c.vigencia_desde ? formatoFechaCorta(c.vigencia_desde) : '—'}
                            {' → '}
                            {c.vigencia_hasta ? formatoFechaCorta(c.vigencia_hasta) : 'sin fin'}
                          </>
                        ) : (
                          'sin fechas de vigencia'
                        )}
                        {vigente && ' · vigente'}
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONO_ESTADO[c.estado]}`}
                    >
                      {ETIQUETAS_ESTADO_CONTRATO[c.estado]}
                    </span>

                    {firmable && tokenFirma && (
                      <a
                        href={`/firmar/${tokenFirma}`}
                        className="rounded-lg bg-lago-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-lago-800"
                      >
                        Revisar y firmar
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-stone-400">
          Este enlace es personal: quien lo tenga puede ver esta información. No lo compartas.
          Ante cualquier duda, escribinos a {socio.email ?? 'la recepción del hotel'}.
        </p>
      </div>
    </main>
  )
}
