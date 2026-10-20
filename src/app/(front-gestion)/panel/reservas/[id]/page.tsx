import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarAccesoHuesped } from '@/lib/auditoria/accesos'
import { nombreCompleto } from '@/lib/domain/huespedes'
import { registrarFalla } from '@/lib/acciones'
import { transicionesPosibles, ETIQUETAS_ESTADO_RESERVA } from '@/lib/domain/reservas'
import { type Ocupantes } from '@/lib/domain/ocupantes'
import { cargoDeCancelacion } from '@/lib/reservas/cancelacion'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import {
  pagadoPorReserva,
  pagoAgenciaVencido,
  vencimientoPagoAgencia,
  type TipoMovimiento,
} from '@/lib/domain/cuentas'
import { parsearPeriodo, diasEntre, hoyISO } from '@/lib/fechas'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { motivoNoFacturable, ALICUOTA_ALOJAMIENTO } from '@/lib/domain/facturacion'
import { condicionesDePrecio } from '@/lib/reservas/condiciones-de-precio'
import { exentoDeIva, motivoSinExencion, desglosarConExencion } from '@/lib/domain/exencion-iva'
import { garantiaSirveParaCobrar, motivoGarantiaNoSirve } from '@/lib/domain/garantia-tarjeta'
import { puedeCambiarUnidad } from '@/lib/domain/mudanzas'
import { unidadesDisponibles } from '@/lib/availability/disponibilidad'
import { TONO_ESTADO } from '../../_components/estilos'
import { Encabezado, Etiqueta, Pagina } from '../../_components/ui'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { resumenPagos, seniaSugerida, type Pago } from '@/lib/domain/pagos'
import {
  CobroEnLinea,
  SeccionConsumos,
  SeccionGarantia,
  SeccionPagos,
  type ConsumoRow,
  type PagoRow,
  type ProductoRow,
} from './seccion-cuenta'
import { SeccionAvisos } from './seccion-avisos'
import { SeccionEstadia, SeccionHuesped, type Reserva } from './seccion-datos'
import { SeccionAcciones } from './seccion-acciones'
import { SeccionEditarFicha, SeccionMudanza, SeccionReprogramar } from './seccion-cambios'

/**
 * Ficha de una reserva.
 *
 * Esta página hace las lecturas y los cálculos; cada tarjeta de la pantalla
 * es un componente `seccion-*.tsx` de esta carpeta que sólo presenta lo que
 * recibe: avisos, datos (huésped y estadía), acciones de estado, cambios
 * (reprogramar, mudar, editar ficha) y la cuenta.
 */

export default async function DetalleReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    error?: string
    detalle?: string
    ok?: string
    nuevo_check_in?: string
    nuevo_check_out?: string
    v_plan?: string
    v_segmento?: string
    v_voucher?: string
    v_notas?: string
    v_adultos?: string
    v_menores?: string
    v_bebes?: string
    v_cunas?: string
    v_no_mover?: string
  }>
}) {
  await requerirAcceso('reservas')
  const { id } = await params
  const {
    error: errorParam,
    detalle: detalleParam,
    ok: okParam,
    nuevo_check_in: nuevoCheckIn,
    nuevo_check_out: nuevoCheckOut,
    v_plan: vPlan,
    v_segmento: vSegmento,
    v_voucher: vVoucher,
    v_notas: vNotas,
    v_adultos: vAdultos,
    v_menores: vMenores,
    v_bebes: vBebes,
    v_cunas: vCunas,
    v_no_mover: vNoMover,
  } = await searchParams
  // Lo que se tecleó la última vez que «Editar ficha» rechazó el envío
  // (auditoría QA/UX 2026-10-14): si vino en la URL, gana sobre el valor
  // guardado en la base. Solo aparece cuando `editarFichaReserva` redirigió
  // con un error — un envío exitoso no deja estos parámetros.
  const huboIntentoDeFicha = vPlan !== undefined
  const supabase = await crearClienteServidor()

  const { data, error: eReserva } = await supabase
    .from('reservas')
    .select(
      'id, codigo, estado, total, subtotal, total_neto, iva, descuento_pct, canal, tarifa_tipo, notas, plan, garantia, segmento, voucher, agencia_id, huesped_id, pago_desde_exterior, tarjeta_ultimos4, tarjeta_marca, tarjeta_vencimiento, tarjeta_verificacion, tarjeta_verificada_en, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, email, doc_numero, vip, residente_exterior), estadias(periodo, precio_noche, huespedes, adultos, menores, bebes, camas_extra, cunas, no_mover, unidad:unidades(nombre, tipo_unidad_id, tipo:tipos_unidad(nombre, capacidad_max)))',
    )
    .eq('id', id)
    .maybeSingle()

  // `data` también queda en null si la lectura falló por otro motivo
  // que «no existe» (permisos, red): sin loguear, esos casos se ven idénticos a
  // una reserva borrada y nadie se entera de que hubo un problema de verdad.
  if (eReserva) registrarFalla(eReserva, 'reservas:ficha')
  if (!data) notFound()
  const reserva = data as unknown as Reserva
  const estadia = reserva.estadias?.[0]

  // Desglose de ocupantes en la forma del dominio. Se arma una vez y se reusa,
  // en vez de leer seis campos sueltos en cada lugar de la pantalla.
  const ocupantes: Ocupantes = {
    adultos: estadia?.adultos ?? 0,
    menores: estadia?.menores ?? 0,
    bebes: estadia?.bebes ?? 0,
    camasExtra: estadia?.camas_extra ?? 0,
    cunas: estadia?.cunas ?? 0,
  }
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0
  const transiciones = transicionesPosibles(reserva.estado)

  /*
    Re-precio inline de la reprogramación (patrón de referencia: Hotel PMS,
    "Reservation 360"). Antes había que apretar «Reprogramar» a ciegas para
    enterarse del total nuevo — el propio botón ya avisaba «recotiza el
    total», pero recién después de confirmar.

    Es un paso de GET, mismo patrón que «Buscar disponibilidad» en el alta de
    reservas (`nueva/page.tsx`): la fecha vive en la URL porque es un paso de
    consulta, no una acción con efecto. Reusa `cotizarEstadia`, la misma
    función que ya usa el alta y el cálculo de cancelación de acá arriba —
    ninguna regla de precio se repite a mano.
  */
  const RE_FECHA_PREVIEW = /^\d{4}-\d{2}-\d{2}$/
  const previewValido =
    periodo &&
    estadia?.unidad?.tipo_unidad_id &&
    RE_FECHA_PREVIEW.test(nuevoCheckIn ?? '') &&
    RE_FECHA_PREVIEW.test(nuevoCheckOut ?? '') &&
    nuevoCheckOut! > nuevoCheckIn! &&
    (nuevoCheckIn !== periodo.desde || nuevoCheckOut !== periodo.hasta)
  // Con las mismas condiciones que va a usar la acción (promoción y descuento
  // adicional incluidos): la vista previa y lo que se aplica son el mismo número.
  const condicionesPreview = previewValido ? await condicionesDePrecio(supabase, reserva.id) : null
  const previewCotizacion =
    previewValido && condicionesPreview?.ok
      ? await cotizarEstadia({
          tipoUnidadId: estadia!.unidad!.tipo_unidad_id,
          checkIn: nuevoCheckIn!,
          checkOut: nuevoCheckOut!,
          tarifaTipo: reserva.tarifa_tipo as 'neto' | 'rack',
          promocion: condicionesPreview.condiciones.promocion,
          descuentoAdicionalPct: condicionesPreview.condiciones.descuentoAdicionalPct,
          anticipacionDias: condicionesPreview.condiciones.anticipacionDias(nuevoCheckIn!),
          cliente: supabase,
        }).catch(() => null)
      : null

  /*
    Exención de IVA al turista del exterior (RG 3971, ADR 0024).

    Se calcula con la MISMA función que usa `emitirFactura`, para que lo que la
    pantalla anuncia y lo que el comprobante hace no puedan separarse. Si acá se
    reimplantara la regla, un cambio en una sola de las dos copias haría que la
    ficha prometiera una exención que la factura después no aplica.
  */
  const condicionExencion = {
    residenteExterior: Boolean(reserva.huesped?.residente_exterior),
    pagoDesdeExterior: reserva.pago_desde_exterior,
  }
  const exento = !reserva.agencia_id && exentoDeIva(condicionExencion)
  const motivoExencion = motivoSinExencion(condicionExencion)

  /*
    El importe que la ficha anuncia sale de `desglosarConExencion`, la MISMA
    función que usa `emitirFactura`. No de `reserva.total_neto`.

    Se hacía así y estaba mal: `total_neto` es una columna que puebla el alta
    (migración 0039) y **puede venir en cero** —una reserva creada por un camino
    que no la completa, o anterior a esa migración—. Con `total_neto = 0` la
    pantalla anunciaba «sale sin IVA: USD 0,00 en vez de USD 363,00», un número
    absurdo dicho con total confianza. Y peor: la factura sí calculaba bien los
    USD 300, así que **la ficha prometía una cosa y el comprobante hacía otra**.

    Detectado abriendo la pantalla en el navegador; ningún test lo veía porque el
    número venía de la base y no del dominio.

    Acá se pasa `consumosConIva: 0` a propósito: es una **vista previa del
    alojamiento**, que es lo que cambia con la exención. Los consumos se suman en
    la cuenta y siguen gravados, y el texto lo aclara.
  */
  const ALICUOTA_PREVIA = ALICUOTA_ALOJAMIENTO
  const previaExencion = desglosarConExencion({
    alojamientoConIva: Number(reserva.total),
    consumosConIva: 0,
    alicuota: ALICUOTA_PREVIA,
    exento: true,
  })

  /*
    Garantía de tarjeta (ADR 0025).

    La pregunta que responde no es «¿la tarjeta es válida hoy?» sino «¿va a
    servir el día que haya que cobrar un no-show?». Por eso la fecha de
    referencia es la del check-in y no la de hoy: una tarjeta que vence el mes
    que viene no sirve para una estadía de dentro de dos meses.
  */
  const garantiaTarjeta = {
    estado: reserva.tarjeta_verificacion,
    verificadaEn: reserva.tarjeta_verificada_en,
    vencimiento: reserva.tarjeta_vencimiento,
  }
  const fechaGarantia = periodo?.desde ?? hoyISO()
  const garantiaOk = garantiaSirveParaCobrar(garantiaTarjeta, fechaGarantia)
  const motivoGarantia = motivoGarantiaNoSirve(garantiaTarjeta, fechaGarantia)

  /*
    Preview del cargo por cancelación (política estándar).

    La cuenta vive en `lib/reservas/cancelacion.ts` y no acá porque el correo que
    se le manda al huésped **al** cancelar tiene que anunciar el mismo número que
    esta pantalla mostró **antes** de cancelar. Cuando estuvo duplicada con
    `saldarSiCorresponde` pasó lo previsible: divergió, y se notó en la plata.
  */
  /*
    Todo lo que sigue depende sólo de `id` y de la reserva ya leída, así que va
    en un solo `Promise.all`: antes eran siete viajes a la base uno detrás de
    otro en la pantalla que recepción más abre.
  */
  // Pago vencido de la agencia (pedido del dueño del hotel, 2026-09): abona un
  // mes antes del check-in. Sólo aplica a una reserva DE agencia y sólo
  // mientras siga vigente —una cancelada no genera reclamo—, así que la
  // consulta extra se hace nada más que para esa minoría de fichas.
  const aplicaPagoAgencia = Boolean(reserva.agencia_id && periodo && reserva.estado !== 'cancelada')
  // Unidades a las que se puede mudar la reserva. Solo se consulta si el estado
  // lo permite: para un check-out o una cancelación la lista no tendría sentido.
  // La unidad actual no aparece —está ocupada por esta misma reserva—, que es
  // justo lo que se quiere.
  const puedeMudarse = Boolean(periodo) && puedeCambiarUnidad(reserva.estado)
  const [
    ,
    cargo,
    { data: pagosData, error: ePagos },
    movsAgencia,
    cobroEnLinea,
    { data: consumosData, error: eConsumos },
    { data: productosData, error: eProductos },
    { data: facturaData, error: eFactura },
    [libres, tiposData],
  ] = await Promise.all([
    // Auditoría de lectura de la ficha del huésped (`lib/auditoria/accesos.ts`).
    // Va primero y en el mismo lote: no depende de ninguna otra lectura.
    reserva.huesped_id
      ? registrarAccesoHuesped(supabase, reserva.huesped_id, 'ficha_reserva')
      : Promise.resolve(),

    periodo && transiciones.includes('cancelada')
      ? cargoDeCancelacion(supabase, {
          checkIn: periodo.desde,
          checkOut: periodo.hasta,
          total: Number(reserva.total),
          tipoUnidadId: estadia?.unidad?.tipo_unidad_id ?? '',
          tarifaTipo: reserva.tarifa_tipo as 'neto' | 'rack',
          noches,
        })
      : Promise.resolve(null),
    supabase
      .from('pagos')
      .select('id, medio, tipo, monto, estado, creado_en, moneda, monto_cobrado, cupon, ultimos4, tarjeta_marca')
      .eq('reserva_id', id)
      .order('creado_en'),
    aplicaPagoAgencia
      ? supabase.from('movimientos_cuenta').select('tipo, monto, reserva_id').eq('reserva_id', id)
      : Promise.resolve({ data: [], error: null }),
    // Estado de cobro consolidado (alojamiento + consumos) y links de pago vivos.
    // Es la misma lectura que usa el portal público, para que el huésped y
    // recepción no vean saldos distintos.
    estadoDeCobro(supabase, id),
    supabase
      .from('consumos')
      .select('id, cantidad, precio_unitario, producto:productos_servicios(nombre, categoria)')
      .eq('reserva_id', id)
      .order('creado_en'),
    supabase
      .from('productos_servicios')
      .select('id, nombre, categoria, precio')
      .eq('activo', true)
      .order('categoria'),
    supabase.from('facturas').select('numero').eq('reserva_id', id).maybeSingle(),
    puedeMudarse && periodo
      ? Promise.all([
          unidadesDisponibles(periodo.desde, periodo.hasta),
          supabase.from('tipos_unidad').select('id, nombre'),
        ])
      : Promise.resolve([[], { data: [] }] as const),
  ])

  if (ePagos) registrarFalla(ePagos, 'reservas:pagos')
  const pagos = (pagosData ?? []) as PagoRow[]
  // Si esta lectura falla, la ficha mostraría "sin pagos" en una reserva que sí
  // cobró: es el mismo riesgo que la alerta de overbooking del dashboard.
  const fallaPagos = Boolean(ePagos)

  let avisoPagoAgenciaVencido: { vencimiento: string; totalPagado: number } | null = null
  if (aplicaPagoAgencia && periodo) {
    if (movsAgencia.error) registrarFalla(movsAgencia.error, 'reservas:pago_agencia')
    const totalPagadoAgencia =
      pagadoPorReserva(
        (movsAgencia.data ?? []) as { tipo: TipoMovimiento; monto: number; reserva_id: string | null }[],
      ).get(id) ?? 0
    if (
      pagoAgenciaVencido(
        { checkIn: periodo.desde, totalReserva: Number(reserva.total), totalPagado: totalPagadoAgencia },
        hoyISO(),
      )
    ) {
      avisoPagoAgenciaVencido = {
        vencimiento: vencimientoPagoAgencia(periodo.desde),
        totalPagado: totalPagadoAgencia,
      }
    }
  }

  const senia = seniaSugerida(Number(reserva.total), noches)

  registrarFalla(eConsumos, 'reservas:consumos')
  registrarFalla(eProductos, 'reservas:catalogo_productos')
  // Mismo riesgo que `fallaPagos` arriba: si esto falla, `factura` da `null`
  // igual que "todavía no facturada", y la pantalla podría ofrecer "Facturar"
  // sobre una reserva que YA tiene factura (bloqueado después por
  // `emitirFactura`, que sí revisa esto bien, pero no debería llegar a
  // ofrecerse el botón en primer lugar).
  const fallaFactura = Boolean(eFactura)
  registrarFalla(eFactura, 'reservas:factura_existente')
  const consumos = (consumosData ?? []) as unknown as ConsumoRow[]
  const productos = (productosData ?? []) as unknown as ProductoRow[]
  const factura = facturaData as { numero: string } | null
  // Misma regla que usa la acción: la pantalla no puede ofrecer algo que
  // el servidor va a rechazar.
  const motivoFactura = motivoNoFacturable(reserva.estado, Boolean(factura))
  const cuenta = cuentaConsolidada(
    Number(reserva.total),
    consumos.map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }) as Consumo),
  )
  /*
    Pagado y saldo, contra la cuenta CONSOLIDADA (alojamiento + consumos): la
    misma que usan `saldarSiCorresponde` y el cobro en línea. Antes se medía
    contra el alojamiento solo, y la sección Pagos daba por saldado a un huésped
    con el frigobar sin pagar mientras el cobro en línea le pedía la diferencia.
    Si no se pudieron leer los consumos, el saldo sale más bajo de lo real: se
    trata como falla de lectura, igual que la de pagos.
  */
  const resumen = resumenPagos(
    cuenta.total,
    pagos.map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado }) as Pago),
  )
  const fallaCuenta = fallaPagos || Boolean(eConsumos)

  const nombreTipo = new Map(
    ((tiposData.data ?? []) as { id: string; nombre: string }[]).map((t) => [t.id, t.nombre]),
  )


  return (
    <Pagina>
      <Link
        href="/panel/reservas"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a reservas
      </Link>

      <Encabezado
        titulo={reserva.codigo}
        descripcion={reserva.huesped ? nombreCompleto(reserva.huesped) : 'Sin huésped asociado'}
        icono="reservas"
        acciones={
          <Etiqueta tono={TONO_ESTADO[reserva.estado]}>
            {ETIQUETAS_ESTADO_RESERVA[reserva.estado]}
          </Etiqueta>
        }
      />

      <SeccionAvisos
        errorParam={errorParam}
        detalleParam={detalleParam}
        okParam={okParam}
        fallaPagos={fallaPagos}
        fallaCuenta={fallaCuenta}
        estado={reserva.estado}
        saldo={resumen.saldo}
        totalReserva={Number(reserva.total)}
        avisoPagoAgenciaVencido={avisoPagoAgenciaVencido}
      />

      {/*
        Dos columnas en escritorio, con TODO a la vista al mismo tiempo: nada de
        pestañas ni bloques plegados. A la izquierda la reserva y qué hacer con
        ella; a la derecha la plata. En el teléfono se apila en ese mismo orden.
      */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {/*
            `items-start`: cada tarjeta mide lo suyo.

            Sin esto la grilla las estira a la altura de la más alta —es el
            comportamiento por omisión— y «Huésped», que tiene cuatro datos, quedaba
            con mil píxeles de blanco al lado de «Estadía», que trae además el
            formulario de tarjeta y el desglose de importes. La pantalla se veía rota
            aunque no lo estuviera.
          */}
          <div className="grid gap-4 sm:grid-cols-2 sm:items-start lg:grid-cols-1 xl:grid-cols-2">
            <SeccionHuesped reserva={reserva} />
            <SeccionEstadia
              reserva={reserva}
              estadia={estadia}
              periodo={periodo}
              noches={noches}
              ocupantes={ocupantes}
              exento={exento}
              motivoExencion={motivoExencion}
              importeExento={previaExencion.exento}
            />
          </div>

          <SeccionAcciones reserva={reserva} transiciones={transiciones} cargo={cargo} />

          {/* Con factura emitida el total no puede cambiar: el servidor lo rechaza. */}
          {periodo && !factura && !['cancelada', 'no_show', 'checkout'].includes(reserva.estado) && (
            <SeccionReprogramar
              reserva={reserva}
              periodo={periodo}
              nuevoCheckIn={nuevoCheckIn}
              nuevoCheckOut={nuevoCheckOut}
              previewValido={Boolean(previewValido)}
              previewCotizacion={previewCotizacion}
            />
          )}

          {puedeMudarse && (
            <SeccionMudanza
              reserva={reserva}
              periodo={periodo!}
              noMover={estadia?.no_mover}
              libres={libres}
              nombreTipo={nombreTipo}
            />
          )}

          {/*
            Editar ficha: plan, segmento, voucher, notas, cunas, «no mover» y la
            composición. Hasta ahora, una vez creada, una reserva solo se podía
            reprogramar, mudar de unidad o cancelar y volver a cargar — no había
            forma de corregir uno de estos datos sin pasar por uno de esos tres
            caminos, que tocan cosas que acá no cambian (fechas, unidad, estado).

            Mismo criterio que «Cambiar de unidad»: si la reserva ya no admite
            mudanza (cancelada, no-show, con el huésped afuera), tampoco tiene
            sentido seguir editando cunas o composición.

            Nunca recotiza: ninguno de estos campos entra en el cálculo del precio
            (ver el comentario de `editarFichaReserva`), así que `reserva.total` no
            se toca.
          */}
          {puedeMudarse && estadia && (
            <SeccionEditarFicha
              reserva={reserva}
              estadia={estadia}
              ocupantes={ocupantes}
              intento={
                huboIntentoDeFicha
                  ? {
                      plan: vPlan,
                      segmento: vSegmento,
                      voucher: vVoucher,
                      notas: vNotas,
                      adultos: vAdultos,
                      menores: vMenores,
                      bebes: vBebes,
                      cunas: vCunas,
                      noMover: vNoMover,
                    }
                  : null
              }
            />
          )}
        </div>

        {/* Columna de la cuenta: lo que se cobró y lo que se consumió. */}
        <div className="flex min-w-0 flex-col gap-4">
          <SeccionPagos
            reserva={{ id: reserva.id, total: cuenta.total }}
            resumen={resumen}
            pagos={pagos}
            senia={senia}
          />

          {/* ── Cobro en línea ────────────────────────────────────────────────
              El caso del huésped que reservó por teléfono o WhatsApp: no está para
              dar la tarjeta y no conviene que la dicte. Se le manda el link, paga
              desde su celular y el webhook salda la reserva solo. */}
          <CobroEnLinea reserva={reserva} cobro={cobroEnLinea} />

          {/* Tarjeta de garantía (ADR 0025): ver el porqué en `seccion-cuenta.tsx`. */}
          <SeccionGarantia reserva={reserva} garantiaOk={garantiaOk} motivoGarantia={motivoGarantia} />

          <SeccionConsumos
            reserva={reserva}
            factura={factura}
            fallaFactura={fallaFactura}
            motivoFactura={motivoFactura}
            consumos={consumos}
            productos={productos}
            cuenta={cuenta}
          />
        </div>
      </div>
    </Pagina>
  )
}
