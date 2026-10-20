'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'
import { esDireccion } from '@/lib/domain/permisos'
import { saldarSiCorresponde } from '@/lib/reservas/saldar'
import { motivoNoConciliar } from '@/lib/domain/canales-costos'
import { movimientoEnMoneda } from '@/lib/domain/cuentas'
import { esMonedaExtranjera } from '@/lib/domain/divisas'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { hoyISO, inicioFinDeMes } from '@/lib/fechas'
import { avisarDiscrepanciaFactura } from '@/lib/notificaciones/eventos'
import {
  MODALIDADES_COBRO,
  referenciaTransferenciaCanal,
  type ModalidadCobro,
} from '@/lib/domain/canales-cobro'
import { requerirAcceso } from '@/lib/auth/session'

/**
 * La plata del canal (ADR 0023): transferencias que manda el canal, modalidad de
 * cobro, facturas de comisión y su conciliación contra lo calculado.
 */

const DESTINO = '/panel/canales'

/**
 * Registra la transferencia que el canal hizo al hotel.
 *
 * ── Por qué esto es lo más cerca de una «notificación de pago» ──────────────
 *
 * Sin ser Connectivity Partner **no hay** aviso de «Booking te pagó»: no existe
 * webhook ni push. Lo que sí se puede hacer es que, cuando alguien ve la
 * transferencia en el extracto del banco o en la liquidación del extranet, la
 * registre acá — y que eso cierre la fila en la lista de conciliación.
 *
 * ── Idempotencia sin tabla nueva ni enum nuevo ───────────────────────────────
 *
 * El pago se inserta con `external_id = 'booking-payout:<referencia>'`. Como
 * `pagos.external_id` ya tiene restricción única (migración 0009, puesta para los
 * webhooks de pasarela), registrar dos veces la misma liquidación **choca con la base
 * en vez de duplicar la plata**. Y `medio` va como `'transferencia'` en lugar de
 * agregarle un valor `'canal'` al enum: una transferencia de Booking **es** una
 * transferencia, y tocar el enum habría exigido dos migraciones (SQLSTATE 55P04).
 */
export async function registrarTransferenciaCanal(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('canales')

  const entranteId = String(formData.get('entrante_id') ?? '')
  const referencia = String(formData.get('referencia') ?? '').trim().slice(0, 60)
  const monto = Number(formData.get('monto'))

  if (!entranteId) redirect(`${DESTINO}?vista=cobros&error=falta_id`)
  if (!referencia) redirect(`${DESTINO}?vista=cobros&error=transf_referencia`)
  if (!Number.isFinite(monto) || monto <= 0) {
    redirect(`${DESTINO}?vista=cobros&error=transf_monto`)
  }

  const supabase = await crearClienteServidor()

  const { data: entrante, error: eLectura } = await supabase
    .from('canal_reservas')
    .select('canal, reserva_id')
    .eq('id', entranteId)
    .maybeSingle<{ canal: string; reserva_id: string | null }>()

  cortarSiFalla(eLectura, `${DESTINO}?vista=cobros`, 'transf_lectura')
  if (!entrante) redirect(`${DESTINO}?vista=cobros&error=transf_no_existe`)

  // Sin reserva propia no hay a qué imputarle el pago. Pasa si la entrante todavía
  // no se importó, y el mensaje lo dice en vez de fallar por una FK.
  if (!entrante.reserva_id) redirect(`${DESTINO}?vista=cobros&error=transf_sin_reserva`)

  const { error: ePago } = await supabase.from('pagos').insert({
    reserva_id: entrante.reserva_id,
    medio: 'transferencia',
    tipo: 'saldo',
    monto,
    estado: 'aprobado',
    external_id: referenciaTransferenciaCanal(entrante.canal, referencia),
    nota: `Liquidación de ${entrante.canal}, referencia ${referencia}.`,
    creado_por: sesion.userId,
  })

  // 23505 = la misma liquidación ya se registró. NO es un error del usuario: es la
  // idempotencia funcionando, y decirle «ya estaba» es más útil que un error genérico.
  if (ePago?.code === '23505') {
    redirect(`${DESTINO}?vista=cobros&ok=transf_repetida`)
  }
  cortarSiFalla(ePago, `${DESTINO}?vista=cobros`, 'transf_pago')

  // Se anota cuándo se liquidó. Escritura accesoria: el pago ya está registrado y es
  // lo que importa, así que un fallo acá no puede tapar el éxito del cobro.
  const { error: eFecha } = await supabase
    .from('canal_reservas')
    .update({ liquidado_en: hoyISO() })
    .eq('id', entranteId)
  registrarFalla(eFecha, `anotar la fecha de liquidación de la entrante ${entranteId}`)

  // Puede haber quedado saldada: se recalcula por el camino compartido.
  const { error: eSaldada } = await saldarSiCorresponde(supabase, entrante.reserva_id)
  registrarFalla(
    eSaldada ? { message: eSaldada } : null,
    `saldar la reserva ${entrante.reserva_id} tras la transferencia del canal`,
  )

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=cobros&ok=transferencia`)
}

/**
 * Fija quién cobra, en una entrante o en todas las que están sin determinar.
 *
 * ── Por qué existe la opción «todas» ────────────────────────────────────────
 *
 * Cuando el informe del extranet no trae la columna de forma de pago, **todas** las
 * reservas quedan en `desconocida`. Obligar a tocar 40 filas de a una garantiza que
 * nadie lo haga, y la lista queda inútil.
 *
 * En la práctica un hotel chico suele tener una sola modalidad activa por temporada,
 * así que «todas las que no sabemos, cobra el hotel» resuelve el caso real en un clic.
 * Sigue siendo una afirmación de una persona, no una suposición del sistema — que es
 * la diferencia que importa.
 */
export async function fijarModalidadCobro(formData: FormData): Promise<void> {
  await requerirAcceso('canales')

  const modalidad = String(formData.get('modalidad') ?? '')
  if (!MODALIDADES_COBRO.includes(modalidad as ModalidadCobro)) {
    redirect(`${DESTINO}?vista=cobros&error=modalidad_invalida`)
  }

  const entranteId = String(formData.get('entrante_id') ?? '')
  const todas = String(formData.get('todas') ?? '') === '1'

  if (!entranteId && !todas) redirect(`${DESTINO}?vista=cobros&error=falta_id`)

  const supabase = await crearClienteServidor()

  const consulta = supabase.from('canal_reservas').update({ modalidad_cobro: modalidad })
  const { error } = todas
    ? // Solo las que están sin determinar: no se pisan las que alguien ya resolvió.
      await consulta.eq('canal', 'booking').eq('modalidad_cobro', 'desconocida')
    : await consulta.eq('id', entranteId)

  cortarSiFalla(error, `${DESTINO}?vista=cobros`, 'modalidad')

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=cobros&ok=modalidad`)
}

/**
 * Registra la factura de comisión del canal.
 *
 * ── Qué hace y qué NO hace ──────────────────────────────────────────────────
 *
 * Crea **dos** cosas: la línea en `canal_cargos` con `origen = 'factura_comision'`
 * —que es la que se compara contra lo devengado— y el asiento en
 * `movimientos_proveedor`, que es el que hereda la antigüedad de saldos, el
 * vencimiento y el estado del comprobante (0022, 0026).
 *
 * **No concilia sola.** La pantalla muestra devengado, facturado y diferencia antes
 * de que alguien apriete nada, y esta acción no marca los cargos como conciliados:
 * decidir que una diferencia es aceptable es una decisión de gerencia, no un efecto
 * secundario de cargar un número.
 *
 * ── Por qué exige el proveedor configurado ──────────────────────────────────
 *
 * Sin `canal_config.proveedor_id` no hay contra quién asentar la deuda. Se corta con
 * un mensaje accionable en vez de crear la línea del cargo y dejar el asiento a
 * medias, que es el estado del que después nadie se acuerda.
 */
export async function registrarFacturaComision(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('canales')

  // Registrar una factura mueve el libro mayor: es de gerencia, no del mostrador.
  // La política RLS de `movimientos_proveedor` ya lo impone; se verifica acá también
  // para poder explicarlo en español en vez de mostrar un error de base.
  if (!esDireccion(sesion.rol)) {
    redirect(`${DESTINO}?vista=costos&error=factura_rol`)
  }

  const comprobante = String(formData.get('comprobante') ?? '').trim().slice(0, 60)
  const monto = Number(formData.get('monto'))
  const moneda = String(formData.get('moneda') ?? 'USD')
  const periodo = String(formData.get('periodo') ?? '').trim()
  const vencimiento = String(formData.get('vencimiento') ?? '').trim()

  if (!comprobante) redirect(`${DESTINO}?vista=costos&error=factura_comprobante`)
  if (!Number.isFinite(monto) || monto <= 0) {
    redirect(`${DESTINO}?vista=costos&error=factura_monto`)
  }
  if (moneda !== 'USD' && !esMonedaExtranjera(moneda)) {
    redirect(`${DESTINO}?vista=costos&error=factura_moneda`)
  }
  // `periodo` llega como `YYYY-MM` de un `<input type="month">`: se normaliza al
  // primer día, que es con qué la vista de conciliación agrupa (`date_trunc`).
  if (!/^\d{4}-\d{2}$/.test(periodo)) redirect(`${DESTINO}?vista=costos&error=factura_periodo`)
  const imputadoEl = `${periodo}-01`

  const supabase = await crearClienteServidor()

  const { data: config, error: eConfig } = await supabase
    .from('canal_config')
    .select('proveedor_id')
    .eq('canal', 'booking')
    .maybeSingle<{ proveedor_id: string | null }>()

  cortarSiFalla(eConfig, `${DESTINO}?vista=costos`, 'factura_config')
  if (!config?.proveedor_id) redirect(`${DESTINO}?vista=costos&error=factura_sin_proveedor`)

  /*
    La moneda de la factura del canal (auditoría 2026-09, P1-3).

    Booking no factura en dólares: emite en euros o en pesos según el contrato, y
    hasta esta corrección el importe entraba tal cual a `movimientos_proveedor`,
    que suma en USD. Una comisión de EUR 1.200 se convertía en una deuda de USD
    1.200 con el canal.

    ⚠️ Las dos tablas guardan la moneda con convenciones DISTINTAS, y es a
    propósito:
      · `canal_cargos.monto` está en `moneda` y la conversión va en `monto_usd`
        (0049), porque es un libro auxiliar que tiene que poder mostrar el número
        del archivo del canal sin tocarlo.
      · `movimientos_proveedor.monto` está en USD (0078), porque es el libro mayor
        y ahí el saldo se suma plano.
    Mezclarlas es escribir un cargo cien veces más grande sin ningún error.
  */
  const vigente = moneda === 'USD' ? null : await cotizacionVigente(moneda)
  const mov = movimientoEnMoneda(monto, moneda, vigente?.venta ?? null)
  if (!mov) redirect(`${DESTINO}?vista=costos&error=factura_sin_cotizacion`)

  // 1) El asiento del libro mayor. Va primero: si falla, no queda una línea de
  //    cargo sin contrapartida contable.
  const { data: movimiento, error: eMov } = await supabase
    .from('movimientos_proveedor')
    .insert({
      proveedor_id: config.proveedor_id,
      tipo: 'cargo',
      monto: mov.monto,
      moneda: mov.moneda,
      monto_origen: mov.montoOrigen,
      cotizacion: mov.cotizacion,
      concepto: `Comisión Booking ${periodo}`,
      comprobante,
      vencimiento: vencimiento || null,
      creado_por: sesion.userId,
    })
    .select('id')
    .single<{ id: string }>()

  cortarSiFalla(eMov, `${DESTINO}?vista=costos`, 'factura_movimiento')

  // 2) La línea comparable contra lo devengado. `canal_reserva_id` queda nulo: es
  //    el total del mes, no el costo de una reserva puntual.
  const { error: eCargo } = await supabase.from('canal_cargos').insert({
    canal: 'booking',
    concepto: 'comision',
    origen: 'factura_comision',
    monto,
    moneda,
    monto_usd: mov.monto,
    tipo_cambio: mov.cotizacion,
    imputado_el: imputadoEl,
    movimiento_proveedor_id: movimiento?.id ?? null,
    clave_idempotencia: `factura_comision:comision:${comprobante}`,
    detalle: `Factura ${comprobante} del período ${periodo}.`,
    creado_por: sesion.userId,
  })

  // Si esto falla, el asiento contable ya existe. NO se deshace con `cortarSiFalla`
  // encadenado —taparía cuál de las dos escrituras falló— y borrar el movimiento
  // sería peor: la deuda con el canal es real y perderla es el fallo más caro.
  // Queda el aviso y el movimiento visible en Proveedores.
  if (eCargo?.code === '23505') {
    redirect(`${DESTINO}?vista=costos&error=factura_repetida`)
  }
  cortarSiFalla(eCargo, `${DESTINO}?vista=costos`, 'factura_cargo')

  /*
    ¿Coincide con lo que el sistema devengó ese mes?

    Esta comparación **ya existía en la pantalla** y era el motivo de la vista de
    costos. Lo que faltaba es que alguien se enterara sin entrar a mirarla: una
    factura del canal se paga por vencimiento, y si la diferencia se descubre
    después de pagarla, reclamarla es mucho más difícil que discutirla antes.
  */
  await avisarSiHayDiferencia(supabase, {
    periodo,
    imputadoEl,
    facturado: mov.monto,
  })

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=costos&ok=factura`)
}

/**
 * Compara la factura del canal contra lo devengado y avisa si no cierran.
 *
 * **Nunca corta.** El asiento contable ya está hecho: que no se pueda anotar un
 * aviso no puede volverse un error sobre una escritura que salió bien.
 */
async function avisarSiHayDiferencia(
  client: Awaited<ReturnType<typeof crearClienteServidor>>,
  d: { periodo: string; imputadoEl: string; facturado: number },
): Promise<void> {
  /*
    `inicioFinDeMes().fin` ya es el PRIMER día del mes siguiente, o sea un fin
    **excluido**: se usa con `<` y no con `<=`. Sumarle un día metería en la
    comparación el primero del mes que viene.
  */
  const finDeMes = inicioFinDeMes(d.periodo).fin

  /*
    Lo devengado del mes: las comisiones que el sistema calculó reserva por
    reserva, **sin** la factura que se acaba de cargar (`origen` distinto) — si
    no, se estaría comparando la factura contra sí misma.
  */
  const { data, error } = await client
    .from('canal_cargos')
    .select('monto_usd')
    .eq('canal', 'booking')
    .eq('concepto', 'comision')
    .neq('origen', 'factura_comision')
    .gte('imputado_el', d.imputadoEl)
    .lt('imputado_el', finDeMes)

  if (error) {
    registrarFalla(error, `leer lo devengado de ${d.periodo} para comparar con la factura`)
    return
  }

  const devengado = (data ?? []).reduce(
    (t, c) => t + Number((c as { monto_usd: number | null }).monto_usd ?? 0),
    0,
  )

  /*
    El umbral es un centavo, no cero.

    Comparar dos sumas de `numeric` convertidas a `number` con `!==` haría saltar
    el aviso por diferencias de redondeo, y un aviso que suena siempre deja de
    mirarse. Un centavo de diferencia no es un problema contable; diez dólares sí.
  */
  if (Math.abs(devengado - d.facturado) < 0.01) return

  await avisarDiscrepanciaFactura(client, {
    // La clave es el período: una sola alerta por mes, aunque la factura se
    // cargue de nuevo tras corregirla.
    cargoId: `booking:${d.periodo}`,
    canal: 'Booking',
    devengado,
    facturado: d.facturado,
  })
}

/**
 * Cierra —o reabre— la revisión de un cargo del canal.
 *
 * ── El agujero que tapa (auditoría 2026-09, P1-4) ───────────────────────────
 *
 * `estado_conciliacion` existía desde la migración 0049 con sus tres valores, su
 * índice y su columna en pantalla, y **ninguna parte de la aplicación lo
 * escribía**. Todos los cargos quedaban «devengado» para siempre: la pantalla
 * comparaba bien lo devengado contra lo facturado, y después no había forma de
 * dejar registrado que esa comparación ya se hizo.
 *
 * Sin esto, cada mes se vuelve a revisar todo desde cero.
 *
 * ── Por qué es de gerencia ──────────────────────────────────────────────────
 *
 * Aceptar una diferencia contra el canal es aceptar un costo, y disputarla es
 * abrir un reclamo. Ninguna de las dos es una tarea de mostrador, aunque el área
 * `canales` sí alcance a recepción para lo operativo.
 */
export async function conciliarCargo(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('canales')

  if (!esDireccion(sesion.rol)) {
    redirect(`${DESTINO}?vista=costos&error=conciliar_rol`)
  }

  const id = String(formData.get('cargo_id') ?? '')
  const nuevo = String(formData.get('estado') ?? '')
  const nota = String(formData.get('nota') ?? '').slice(0, 500)
  if (!id) redirect(`${DESTINO}?vista=costos`)

  const supabase = await crearClienteServidor()

  const { data: cargo, error: eLectura } = await supabase
    .from('canal_cargos')
    .select('estado_conciliacion')
    .eq('id', id)
    .maybeSingle<{ estado_conciliacion: string }>()

  cortarSiFalla(eLectura, `${DESTINO}?vista=costos`, 'conciliar_lectura')
  if (!cargo) redirect(`${DESTINO}?vista=costos&error=conciliar_inexistente`)

  const motivo = motivoNoConciliar({ actual: cargo.estado_conciliacion, nuevo, nota })
  if (motivo) redirect(`${DESTINO}?vista=costos&error=conciliar_${motivo}`)

  /*
    Volver a `devengado` limpia la firma y el motivo.

    Es lo que la migración 0079 exige (`canal_cargos_cierre_con_firma`), y además
    es lo correcto: dejar el nombre de quien concilió sobre un cargo que ya no está
    conciliado le atribuye una decisión que se dio de baja.
  */
  const vuelveADevengado = nuevo === 'devengado'

  const { error } = await supabase
    .from('canal_cargos')
    .update({
      estado_conciliacion: nuevo,
      conciliado_por: vuelveADevengado ? null : sesion.userId,
      conciliado_en: vuelveADevengado ? null : new Date().toISOString(),
      nota_conciliacion: vuelveADevengado ? null : nota.trim() || null,
    })
    .eq('id', id)

  cortarSiFalla(error, `${DESTINO}?vista=costos`, 'conciliar')

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=costos&ok=conciliar`)
}
