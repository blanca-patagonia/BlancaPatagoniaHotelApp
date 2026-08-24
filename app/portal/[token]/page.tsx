import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { saldoCuenta, type Movimiento } from '@/lib/domain/cuentas'
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
import { hoyISO, formatoFechaCorta } from '@/lib/fechas'

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
  monto: number | string
  concepto: string
  fecha: string
  estado?: EstadoComprobante
  vencimiento?: string | null
}

const TONO_ESTADO: Record<EstadoContrato, string> = {
  borrador: 'bg-stone-100 text-stone-600',
  enviado: 'bg-lago-50 text-lago-800 ring-1 ring-lago-200',
  firmado: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  rechazado: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  vencido: 'bg-lenga-50 text-lenga-800 ring-1 ring-lenga-200',
}

export default async function PortalSocioPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
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

  const [{ data: contratosData }, { data: movsData }] = await Promise.all([
    admin
      .from('contratos')
      .select('id, tipo, entidad_id, titulo, estado, vigencia_desde, vigencia_hasta')
      .eq('tipo', tipo)
      .eq('entidad_id', socio.id)
      .order('creado_en', { ascending: false }),
    esAgencia
      ? admin
          .from('movimientos_cuenta')
          .select('tipo, monto, concepto, fecha')
          .eq('agencia_id', socio.id)
          .order('fecha', { ascending: false })
      : admin
          .from('movimientos_proveedor')
          .select('tipo, monto, concepto, fecha, estado, vencimiento')
          .eq('proveedor_id', socio.id)
          .order('fecha', { ascending: false }),
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

  const hoy = hoyISO()

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
                USD {saldo.toLocaleString('es-AR')}
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
                      </td>
                      <td className="tabular px-5 py-2 text-right text-stone-800">
                        {m.tipo === 'cargo' ? Number(m.monto).toLocaleString('es-AR') : ''}
                      </td>
                      <td className="tabular px-5 py-2 text-right text-emerald-700">
                        {m.tipo === 'pago' ? Number(m.monto).toLocaleString('es-AR') : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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
