import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { estadoDeCobro, type EstadoCobro } from '@/lib/reservas/cobro'
import { motivoNoSeCobra } from '@/lib/domain/cobro'
import { formatearUSD } from '@/lib/domain/moneda'
import type { EstadoReserva } from '@/lib/domain/reservas'
import { parsearPeriodo, diasEntre } from '@/lib/fechas'
import { textos, rellenar, idiomaValido, fechaCortaEn, type Diccionario } from '@/lib/i18n'
import { Mensaje, Tarjeta, botonPublico } from '../../../_publico/ui'
import { Aviso, Marco } from '../../../_publico/marco'
import { HORA_CHECK_IN, HORA_CHECK_OUT } from '@/lib/domain/hotel'
import { DIAS_EXPIRACION } from '@/lib/domain/recordatorios'
import { registrarFalla } from '@/lib/acciones'

interface Reserva {
  id: string
  codigo: string
  estado: string
  total: number | string
  huesped: { apellido: string; nombre: string; email: string | null } | null
  estadias: {
    periodo: string
    unidad: { nombre: string; tipo: { nombre: string } | null } | null
  }[]
}

/** Pantalla con datos de una reserva: no se indexa (además está en `robots.ts`). */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ idioma?: string }>
}) {
  const tx = textos(idiomaValido((await searchParams).idioma))
  return { title: `${tx.confirmacion.meta} — Blanca Patagonia`, robots: { index: false } }
}

export default async function ConfirmacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ pago?: string; idioma?: string }>
}) {
  const { token } = await params
  const sp = await searchParams
  /*
    Idioma por consulta (`?idioma=en`) y no por prefijo: esta dirección viaja en
    correos ya enviados y tiene que seguir funcionando. Sin el parámetro, español.
  */
  const idioma = idiomaValido(sp.idioma)
  const tx = textos(idioma)
  const t = tx.confirmacion
  /** Un enlace interno que conserva el idioma. */
  const conIdioma = (ruta: string) => (idioma === 'es' ? ruta : `${ruta}?idioma=${idioma}`)
  // `?pago=fallo`: el checkout creó la reserva pero la pasarela no abrió. La
  // reserva está; lo que falta es la seña, y el botón para pagarla está abajo.
  const pagoFallo = sp.pago === 'fallo'
  // El token opaco actúa como credencial de acceso; se consulta con service_role.
  const admin = crearClienteAdmin()
  const { data, error } = await admin
    .from('reservas')
    .select(
      'id, codigo, estado, total, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, email), estadias(periodo, unidad:unidades(nombre, tipo:tipos_unidad(nombre)))',
    )
    .eq('token', token)
    .maybeSingle()
  /*
    «No se pudo leer» no es «no existe». Antes los dos terminaban en el 404, y
    un huésped que volvía de pagar veía «página no encontrada» sobre su reserva
    pagada sin que quedara rastro en /panel/errores.
  */
  if (error) {
    registrarFalla(error, 'portal:confirmacion:leer_reserva')
    return (
      <Aviso
        idioma={idioma}
        titulo={t.errorLecturaTitulo}
        accion={
          <Link href={conIdioma(`/reservar/confirmacion/${token}`)} className={botonPublico('primario')}>
            {t.reintentar}
          </Link>
        }
      >
        <p>{t.errorLecturaTexto}</p>
      </Aviso>
    )
  }
  if (!data) notFound()

  const reserva = data as unknown as Reserva
  const estadia = reserva.estadias?.[0]
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0

  // Solo se ofrece el enlace si ya hay algo que mostrar: antes del check-out
  // no existe factura, y un botón que lleva a una pantalla vacía es peor que
  // no tener botón.
  const { count: tieneFactura, error: eFactura } = await admin
    .from('facturas')
    .select('*', { count: 'exact', head: true })
    .eq('reserva_id', reserva.id)
  // Accesoria: si falla, simplemente no se ofrece el enlace a la factura.
  registrarFalla(eFactura, 'portal:confirmacion:contar_facturas')

  // El estado de cobro sale de la base, no de la vuelta de la pasarela: la URL
  // de retorno de un checkout se puede abrir a mano sin haber pagado nada.
  // Quien confirma un cobro es el webhook, y esto lee lo que él escribió.
  const cobro = await estadoDeCobro(admin, reserva.id)

  return (
    <Marco ancho="angosto" idioma={idioma}>
      <Tarjeta>
        <div className="px-6 py-8 text-center sm:px-8">
          <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            <svg
              viewBox="0 0 24 24"
              className="size-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>

          <h1 className="font-display text-3xl leading-tight font-semibold text-stone-900">
            {t.titulo}
          </h1>
          <p className="mt-2 leading-relaxed text-stone-600">
            {reserva.huesped
              ? rellenar(t.listoConNombre, {
                  nombre: reserva.huesped.nombre || reserva.huesped.apellido,
                })
              : t.listo}{' '}
            {t.guardaCodigo}
          </p>

          {/* El código, grande y aparte: es el único dato que el huésped
              necesita tener a mano después de cerrar la página. */}
          <p className="tabular mt-5 rounded-2xl bg-lago-50 px-4 py-4 font-display text-3xl font-semibold tracking-wider text-lago-800 ring-1 ring-lago-100">
            {reserva.codigo}
          </p>
        </div>

        <dl className="flex flex-col gap-3 border-t border-stone-100 px-6 py-5 text-left sm:px-8">
          {estadia?.unidad && (
            <Fila
              etiqueta={t.alojamiento}
              valor={estadia.unidad.tipo?.nombre ?? estadia.unidad.nombre}
            />
          )}
          {periodo && (
            <>
              <Fila
                etiqueta={t.llegada}
                valor={rellenar(t.desdeLas, {
                  fecha: fechaCortaEn(periodo.desde, idioma),
                  hora: HORA_CHECK_IN,
                })}
              />
              <Fila
                etiqueta={t.salida}
                valor={rellenar(t.hastaLas, {
                  fecha: fechaCortaEn(periodo.hasta, idioma),
                  hora: HORA_CHECK_OUT,
                })}
              />
              <Fila etiqueta={t.noches} valor={String(noches)} />
            </>
          )}
          <Fila etiqueta={t.total} valor={formatearUSD(cobro?.total ?? Number(reserva.total))} />
          {cobro && cobro.pagado > 0 && (
            <Fila etiqueta={t.pagado} valor={formatearUSD(cobro.pagado)} />
          )}
          {cobro && (
            <Fila
              etiqueta={cobro.saldada ? t.saldo : cobro.tieneSenia ? t.saldoAAbonar : t.seniaAAbonar}
              valor={formatearUSD(
                cobro.saldada ? 0 : cobro.tieneSenia ? cobro.saldo : Math.min(cobro.senia, cobro.saldo),
              )}
              destacado
            />
          )}
        </dl>

        <div className="border-t border-stone-100 px-6 py-5 sm:px-8">
          {pagoFallo && (
            <div className="mb-4">
              <Mensaje tono="aviso">{t.pagoFallo}</Mensaje>
            </div>
          )}
          <EstadoDePago
            reserva={reserva}
            cobro={cobro}
            t={t}
            enlacePago={conIdioma(`/reservar/pagar/${token}`)}
          />

          <div className="mt-5 flex flex-wrap gap-2">
            {Boolean(tieneFactura) && (
              <Link href={`/reservar/factura/${token}`} className={botonPublico('secundario')}>
                {t.verFactura}
              </Link>
            )}
            <Link href={`/${idioma}`} className={botonPublico('secundario')}>
              {t.volverInicio}
            </Link>
            <Link href={`/${idioma}/reservar`} className={botonPublico('secundario')}>
              {t.reservarOtra}
            </Link>
          </div>
        </div>
      </Tarjeta>

      <p className="mt-6 text-center text-sm text-stone-500">{t.favoritos}</p>
    </Marco>
  )
}

/**
 * Qué le decimos al huésped sobre su pago, y qué puede hacer al respecto.
 *
 * Los cuatro casos son distintos y llevan a acciones distintas; mostrarlos con
 * un texto único —«hay que abonar la seña»— era lo que había antes, y le pedía
 * la seña incluso a quien ya la había pagado.
 */
function EstadoDePago({
  reserva,
  cobro,
  t,
  enlacePago,
}: {
  reserva: Reserva
  cobro: EstadoCobro | null
  t: Diccionario['confirmacion']
  enlacePago: string
}) {
  // Sin datos de cobro no se inventa un estado: se dice que no se pudo calcular.
  if (!cobro) {
    return <Mensaje tono="aviso">{t.sinCalculo}</Mensaje>
  }

  if (cobro.saldada) {
    return (
      <Mensaje tono="ok">
        <strong className="font-medium">{t.todoPagoTitulo}</strong> {t.todoPagoTexto}
      </Mensaje>
    )
  }

  const impedimento = motivoNoSeCobra(reserva.estado as EstadoReserva, cobro.saldo)

  return (
    <>
      <Mensaje tono="aviso">
        <strong className="font-medium">
          {cobro.tieneSenia ? t.saldoPendienteTitulo : t.sinConfirmarTitulo}
        </strong>{' '}
        {cobro.tieneSenia
          ? t.saldoPendienteTexto
          : rellenar(t.sinConfirmarTexto, { dias: DIAS_EXPIRACION })}
      </Mensaje>

      {!impedimento && (
        <div className="mt-4">
          <Link href={enlacePago} className={botonPublico('primario')}>
            {cobro.tieneSenia ? t.pagarSaldo : t.pagarSenia}
          </Link>
        </div>
      )}
    </>
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
      <dd className={destacado ? 'font-semibold text-stone-900' : 'font-medium text-stone-800'}>
        {valor}
      </dd>
    </div>
  )
}
