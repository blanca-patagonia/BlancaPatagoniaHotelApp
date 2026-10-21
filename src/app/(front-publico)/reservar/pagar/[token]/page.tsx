import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { opcionesDePago } from '@/lib/payments/opciones'
import { textos, rellenar, idiomaValido, type Diccionario, type Idioma } from '@/lib/i18n'
import { medioTraducido, type MedioTraducido } from '@/lib/i18n/medios-de-pago'
import { motivoNoSeCobra } from '@/lib/domain/cobro'
import { formatearUSD } from '@/lib/domain/moneda'
import type { EstadoReserva } from '@/lib/domain/reservas'
import { Tarjeta, Mensaje, Titulo, botonPublico } from '../../../_publico/ui'
import { Marco, Aviso } from '../../../_publico/marco'
import { registrarFalla } from '@/lib/acciones'
import { pagarDesdeElPortal } from './actions'

/**
 * Pantalla de pago del huésped.
 *
 * El principio de interfaz del proyecto vale especialmente acá: **nada oculto**.
 * Cada medio de pago se muestra con su nombre, su moneda, el importe exacto que
 * se va a cobrar y con qué se puede pagar por ese camino. Un huésped que está por
 * dar su tarjeta tiene que poder ver el número que le van a debitar **en la
 * moneda en la que se lo van a debitar**, antes de tocar nada: si acá dijera
 * «USD 145,20» y en el resumen le apareciera un importe en pesos que no
 * reconoce, la reacción normal es desconocer el consumo.
 */

/** Los mensajes de error que puede traer la vuelta de una acción, por idioma. */
function mensajesError(t: Diccionario['pago']): Record<string, string> {
  return {
    no_encontrada: t.errorNoEncontrada,
    limite: t.errorLimite,
    sin_datos: t.errorSinDatos,
    no_cobrable: t.errorNoCobrable,
    pasarela: t.errorPasarela,
  }
}

/** Pantalla con datos de una reserva: no se indexa (además está en `robots.ts`). */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ idioma?: string }>
}) {
  const tx = textos(idiomaValido((await searchParams).idioma))
  return { title: `${tx.pago.meta} — Blanca Patagonia`, robots: { index: false } }
}

export default async function PagarPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ error?: string; idioma?: string }>
}) {
  const { token } = await params
  const { error, idioma: idiomaPedido } = await searchParams
  // Idioma por consulta, como la confirmación: la dirección viaja en correos.
  const idioma = idiomaValido(idiomaPedido)
  const tx = textos(idioma)
  const t = tx.pago
  const confirmacion =
    idioma === 'es' ? `/reservar/confirmacion/${token}` : `/reservar/confirmacion/${token}?idioma=${idioma}`

  // El token opaco actúa como credencial de acceso; se consulta con service_role.
  const admin = crearClienteAdmin()
  const { data: reserva, error: eReserva } = await admin
    .from('reservas')
    .select('id, codigo, estado')
    .eq('token', token)
    .maybeSingle()
  // «No se pudo leer» no es «no existe»: se avisa y queda en el registro.
  if (eReserva) {
    registrarFalla(eReserva, 'portal:pagar:leer_reserva')
    return (
      <Aviso idioma={idioma} titulo={t.sinCalculoTitulo}>
        {t.sinCalculoTexto}
      </Aviso>
    )
  }
  if (!reserva) notFound()

  const cobro = await estadoDeCobro(admin, reserva.id)
  if (!cobro) {
    return (
      <Aviso idioma={idioma} titulo={t.sinCalculoTitulo}>
        {t.sinCalculoTexto}
      </Aviso>
    )
  }

  const impedimento = motivoNoSeCobra(reserva.estado as EstadoReserva, cobro.saldo)
  if (impedimento) {
    return (
      <Aviso
        idioma={idioma}
        titulo={cobro.saldada ? t.todoPagoTitulo : t.nadaQuePagarTitulo}
        accion={
          <Link href={confirmacion} className={botonPublico('secundario')}>
            {t.verMiReserva}
          </Link>
        }
      >
        {/* El motivo del dominio está en español (lo ve también el staff). */}
        {idioma === 'es' ? impedimento : reserva.estado === 'cancelada' ? t.cancelada : t.sinSaldo}
      </Aviso>
    )
  }

  /*
    Qué se cobra: la seña si todavía no se pagó ninguna, el saldo si ya está.
    Se decide acá y se manda en el formulario, pero la acción **lo vuelve a
    decidir** con los mismos datos: lo que viaja por el navegador no define
    contra qué se imputa la plata.
  */
  const tipo = cobro.tieneSenia ? 'saldo' : 'senia'
  const montoUSD = tipo === 'senia' ? Math.min(cobro.senia, cobro.saldo) : cobro.saldo

  const opciones = await opcionesDePago(montoUSD)

  return (
    <Marco ancho="angosto" idioma={idioma} volver={{ href: confirmacion, texto: t.miReserva }}>
      <Titulo
        titulo={tipo === 'senia' ? t.tituloSenia : t.tituloSaldo}
        descripcion={rellenar(t.descripcion, { codigo: reserva.codigo })}
      />

      {error && (
        <div className="mb-5">
          <Mensaje tono="error">
            {mensajesError(t)[error] ?? t.errorGenerico}
          </Mensaje>
        </div>
      )}

      <Tarjeta className="mb-5">
        <dl className="flex flex-col gap-3 px-5 py-5 sm:px-6">
          <Fila etiqueta={t.totalEstadia} valor={formatearUSD(cobro.total)} />
          {cobro.pagado > 0 && <Fila etiqueta={t.yaPagaste} valor={formatearUSD(cobro.pagado)} />}
          <Fila
            etiqueta={tipo === 'senia' ? t.seniaAhora : t.saldoAhora}
            valor={formatearUSD(montoUSD)}
            destacado
          />
        </dl>
      </Tarjeta>

      {opciones.length === 0 ? (
        <Mensaje tono="aviso">
          <strong className="font-medium">{t.noDisponibleTitulo}</strong> {t.noDisponibleTexto}
        </Mensaje>
      ) : (
        <div className="flex flex-col gap-3">
          {opciones.map((o) => (
            <OpcionDePago
              key={o.medio.id}
              opcion={medioTraducido(o, tx)}
              token={token}
              tipo={tipo}
              idioma={idioma}
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-sm leading-relaxed text-stone-500">{t.nota}</p>
    </Marco>
  )
}

/* ─────────────────────────────────────────────────────── opciones ──────── */

/* ──────────────────────────────────────────────────────── piezas ───────── */

function OpcionDePago({
  opcion,
  token,
  tipo,
  idioma,
}: {
  opcion: MedioTraducido
  token: string
  tipo: 'senia' | 'saldo'
  idioma: Idioma
}) {
  // `valor` es el nombre con el que se elige la pasarela (ver `OpcionDePago`).
  const valorMedio = opcion.valor

  return (
    <form action={pagarDesdeElPortal}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="medio" value={valorMedio} />
      <input type="hidden" name="idioma" value={idioma} />

      <button
        type="submit"
        className="toque w-full rounded-2xl border border-stone-200 bg-white p-5 text-left shadow-sm transition hover:border-lago-400 hover:shadow focus:border-lago-600 focus:outline-none"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-display text-lg font-semibold text-stone-900">
            {opcion.titulo}
          </span>
          <span className="tabular font-display text-lg font-semibold text-lago-800">
            {opcion.importe}
          </span>
        </span>

        <span className="mt-1 block text-sm leading-relaxed text-stone-600">
          {opcion.detalle}
        </span>

        {opcion.equivalencia && (
          <span className="mt-1 block text-sm text-stone-500">{opcion.equivalencia}</span>
        )}

        <span className="mt-3 flex flex-wrap gap-1.5">
          {opcion.formas.map((f) => (
            <span
              key={f}
              className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-600"
            >
              {f}
            </span>
          ))}
        </span>
      </button>
    </form>
  )
}

function Fila({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string
  valor: string
  destacado?: boolean
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-stone-500">{etiqueta}</dt>
      <dd
        className={
          destacado
            ? 'tabular font-display text-lg font-semibold text-stone-900'
            : 'tabular font-medium text-stone-800'
        }
      >
        {valor}
      </dd>
    </div>
  )
}
