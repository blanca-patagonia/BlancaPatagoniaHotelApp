import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import {
  saldoCuenta,
  ETIQUETAS_TIPO_CUENTA,
  ETIQUETAS_MOVIMIENTO,
  type TipoCuenta,
  type TipoMovimiento,
  type Movimiento,
} from '@/lib/domain/cuentas'
import { registrarMovimiento, regenerarEnlacePortal, revocarEnlacePortal } from '../actions'
import { type CondicionIva } from '@/lib/domain/facturacion'
import { Encabezado, Mensaje, Pagina, botonClases } from '../../_components/ui'
import { Icono } from '../../_components/iconos'
import { BotonEnvio } from '../../_components/boton-envio'
import { formatearUSD, importe } from '@/lib/domain/moneda'

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
  monto: number | string
  concepto: string
  fecha: string
  reserva: { codigo: string } | null
}

/**
 * Mensajes de las acciones de esta ficha.
 *
 * Esta pantalla no recibía `searchParams`, así que el `?ok=datos` que las
 * acciones ya mandaban al guardar nunca se vio, y los fallos de escritura
 * tampoco.
 */
const MENSAJES_ERROR: Record<string, string> = {
  movimiento: 'No se pudo registrar el movimiento. El saldo de la cuenta quedó sin cambios.',
  datos: 'No se pudieron guardar los datos de la agencia.',
  activo: 'No se pudo cambiar el estado de la cuenta.',
  enlace: 'No se pudo actualizar el enlace del portal. El anterior sigue vigente.',
}

const MENSAJES_OK: Record<string, string> = {
  datos: 'Datos actualizados.',
  enlace: 'Enlace nuevo generado. El anterior dejó de funcionar: reenviale el nuevo al socio.',
  enlace_revocado: 'Enlace dado de baja. El socio ya no puede entrar al portal.',
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
  const [{ data: agenciaData }, { data: movsData }, { data: tokenData }] = await Promise.all([
    supabase.from('agencias').select('id, nombre, tipo, cuit, email, telefono, descuento_pct, activo, condicion_iva').eq('id', id).single(),
    supabase
      .from('movimientos_cuenta')
      .select('id, tipo, monto, concepto, fecha, reserva:reservas(codigo)')
      .eq('agencia_id', id)
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false }),
    crearClienteAdmin()
      .from('agencias')
      .select('token, token_revocado_en')
      .eq('id', id)
      .maybeSingle(),
  ])
  if (!agenciaData) notFound()
  const agencia = agenciaData as Agencia
  // Puede ser null si la lectura privilegiada falla: la pantalla lo contempla
  // en vez de romperse, porque el enlace del portal es accesorio a la ficha.
  const datosToken = tokenData as { token: string; token_revocado_en: string | null } | null
  const tokenPortal = datosToken?.token ?? null
  const revocado = Boolean(datosToken?.token_revocado_en)
  const cabeceras = await headers()
  const origen = `${cabeceras.get('x-forwarded-proto') ?? 'http'}://${cabeceras.get('host') ?? 'localhost:3000'}`
  const movs = (movsData ?? []) as unknown as MovRow[]
  const saldo = saldoCuenta(movs.map((m) => ({ tipo: m.tipo, monto: Number(m.monto) }) as Movimiento))

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
            {MENSAJES_ERROR[errorParam] ?? 'No se pudo completar la operación.'}
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

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-600">Saldo</p>
          <p className={`text-2xl font-semibold ${saldo > 0 ? 'text-red-600' : 'text-stone-900'}`}>
            {formatearUSD(saldo)}
          </p>
          <p className="text-xs text-stone-600">{saldo > 0 ? 'adeuda al hotel' : 'sin deuda'}</p>
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
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Monto (USD)</span>
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
          {/* Mueve dinero: el botón se bloquea mientras viaja al servidor para
              que un segundo clic no duplique el movimiento. */}
          <BotonEnvio cargando="Registrando…">Registrar</BotonEnvio>
        </form>
      </div>


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

      <h2 className="mt-6 mb-2 text-sm font-medium text-stone-700">Movimientos</h2>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Concepto</th>
              <th className="px-4 py-2.5 text-right">Cargo</th>
              <th className="px-4 py-2.5 text-right">Pago</th>
            </tr>
          </thead>
          <tbody>
            {movs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-stone-600">
                  Sin movimientos.
                </td>
              </tr>
            )}
            {movs.map((m) => (
              <tr key={m.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2 text-stone-500">{m.fecha}</td>
                <td className="px-4 py-2 text-stone-700">
                  {m.concepto || ETIQUETAS_MOVIMIENTO[m.tipo]}
                  {m.reserva && <span className="ml-2 text-xs text-stone-600">{m.reserva.codigo}</span>}
                </td>
                <td className="px-4 py-2 text-right text-stone-800">
                  {m.tipo === 'cargo' ? importe(Number(m.monto)) : ''}
                </td>
                <td className="px-4 py-2 text-right text-emerald-700">
                  {m.tipo === 'pago' ? importe(Number(m.monto)) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Pagina>
  )
}
