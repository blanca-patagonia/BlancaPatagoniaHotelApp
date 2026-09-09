import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerProveedor, type WebhookEvent } from '@/lib/payments'
import { permitirIntento } from '@/lib/limites'
import { puedeAvanzarEstadoPago, type EstadoPago } from '@/lib/domain/pagos'
import { coincideElImporte, imputarEnUSD, MONEDA_BASE } from '@/lib/domain/cobro'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { saldarSiCorresponde } from '@/lib/reservas/saldar'
import { avisarCobroAprobado, avisarCobroRechazado } from '@/lib/notificaciones/cobros'
import { urlDelSitio } from '@/lib/env'
import { registrarError } from '@/lib/registro'

type ClienteAdmin = ReturnType<typeof crearClienteAdmin>

/**
 * Webhook de pagos: `POST /api/webhooks/pagos/{proveedor}`.
 *
 * Idempotente: cada cobro trae un `external_id` único (columna `pagos.external_id`
 * con restricción UNIQUE); un evento repetido choca con la restricción y no se
 * inserta dos veces. Corre con `service_role` (sin sesión de usuario) y, si el
 * pago salda la reserva, la transiciona a `pagada`.
 *
 * ⚠️ Para una pasarela, un `200` significa «entregado, no reintentes». Por eso
 * **todo fallo de base tiene que responder 500**: es el único modo de pedir el
 * reintento. Una respuesta `ok` con el trabajo a medias deja la plata cobrada y
 * la reserva sin marcar, y nadie se entera.
 *
 * ⚠️ EL IMPORTE QUE SALDA NO ES EL QUE INFORMA LA PASARELA. Cuando el sistema
 * originó el cobro ya dejó escrito, en la fila `pendiente`, cuánto se pidió y a
 * qué cotización; el evento solo **confirma**. Si el importe informado no
 * coincide con el pedido, el pago no salda nada y queda marcado para revisión.
 * Recalcularlo con la cotización de hoy movería el saldo de una reserva por el
 * dólar de mañana.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ proveedor: string }> },
) {
  const { proveedor } = await params
  const prov = obtenerProveedor(proveedor)
  if (!prov) return Response.json({ error: 'proveedor desconocido' }, { status: 404 })

  if (!(await prov.verificarFirma(req.clone()))) {
    /*
      El límite se cuenta ACÁ, después del rechazo, y nunca antes.

      Un evento legítimo viene firmado con un secreto que solo tiene la pasarela,
      así que no pasa por esta rama por muchos que lleguen. Limitar por volumen
      *antes* de verificar significaría descartar avisos de cobros reales en un
      pico de ventas: la plata queda cobrada y la reserva figura impaga.
    */
    if (!(await permitirIntento('webhook_pago'))) {
      return Response.json({ error: 'demasiados intentos' }, { status: 429 })
    }
    return Response.json({ error: 'firma inválida' }, { status: 401 })
  }

  const leido = await prov.parsearWebhook(req)

  switch (leido.tipo) {
    case 'ignorar':
      // 200 a propósito: el aviso es legítimo, simplemente no habla de un cobro
      // nuestro. Con 400, la pasarela acumula fallos y termina deshabilitando el
      // endpoint, y ahí se pierden también los avisos buenos.
      return Response.json({ ok: true, ignorado: leido.motivo })
    case 'invalido':
      await registrarError('webhook_pago_evento_invalido', { proveedor, motivo: leido.motivo })
      return Response.json({ error: 'evento inválido' }, { status: 400 })
    case 'reintentar':
      await registrarError('webhook_pago_reintentar', { proveedor, motivo: leido.motivo })
      return Response.json({ error: 'no se pudo procesar' }, { status: 500 })
  }

  const evento = leido.evento
  const admin = crearClienteAdmin()

  /*
    ¿Este cobro lo originó el sistema?

    Si sí, existe una fila `pendiente` con el importe en USD ya congelado. Es la
    fuente autoritativa: dice cuánto se pidió cobrar, en qué moneda y a qué
    cotización. Se lee ANTES de intentar el insert para poder contrastar.
  */
  const { data: previo, error: eLectura } = await admin
    .from('pagos')
    .select('id, estado, monto, moneda, monto_cobrado, cotizacion, reserva_id')
    .eq('external_id', evento.externalId)
    .maybeSingle()

  if (eLectura) {
    return Response.json({ error: eLectura.message }, { status: 500 })
  }

  if (previo) {
    return await confirmarCobroConocido(admin, evento, previo, proveedor)
  }

  return await registrarCobroAjeno(admin, evento, proveedor)
}

interface FilaPago {
  id: string
  estado: string
  monto: number
  moneda: string
  monto_cobrado: number | null
  cotizacion: number | null
  reserva_id: string
}

/**
 * Confirma un cobro que este sistema originó.
 *
 * El importe en USD **no se recalcula**: se usa el que quedó congelado al crear
 * el link. Lo único que hace el evento es mover el estado.
 */
async function confirmarCobroConocido(
  admin: ClienteAdmin,
  evento: WebhookEvent,
  previo: FilaPago,
  proveedor: string,
) {
  /*
    Contraste de importe.

    La pasarela cobra exactamente el número que se le mandó, así que cualquier
    diferencia es una anomalía: un link manipulado, un evento cruzado de otra
    reserva o una integración mal configurada. Ante eso NO se salda la reserva
    —eso es lo caro— y se deja constancia para que alguien lo mire.
  */
  const esperado = previo.monto_cobrado ?? previo.monto
  if (!coincideElImporte(esperado, evento.monto)) {
    await registrarError('webhook_pago_importe_distinto', {
      proveedor,
      externalId: evento.externalId,
      pedido: esperado,
      monedaPedida: previo.moneda,
      informado: evento.monto,
      monedaInformada: evento.moneda,
    })

    const { error } = await admin
      .from('pagos')
      .update({
        estado: 'rechazado',
        nota: `Revisar a mano: la pasarela informó ${evento.monto} ${evento.moneda} y se había pedido ${esperado} ${previo.moneda}.`,
      })
      .eq('id', previo.id)

    // Si ni siquiera se pudo dejar la marca, corresponde 500: que reintente.
    if (error) return Response.json({ error: error.message }, { status: 500 })

    return Response.json({ ok: true, revisar: 'el importe no coincide con el pedido' })
  }

  // La regla de qué transición corresponde vive en el dominio, no acá.
  if (puedeAvanzarEstadoPago(previo.estado as EstadoPago, evento.estado)) {
    const { error } = await admin
      .from('pagos')
      .update({ estado: evento.estado })
      .eq('id', previo.id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  /*
    La conciliación corre TAMBIÉN cuando el estado no se movió, y es deliberado:
    si una vez se registró el pago pero la transición de la reserva falló, la
    fila ya existe y cualquier reenvío la encontraría igual. Si acá se cortara
    por «ya estaba», esa inconsistencia sería permanente. Al reconciliar igual,
    reenviar el evento se convierte en el modo de arreglarlo.
  */
  if (evento.estado === 'aprobado') {
    const r = await saldarReserva(admin, previo.reserva_id)
    if (r.error) return Response.json({ error: r.error }, { status: 500 })

    /*
      Los avisos van DESPUÉS de saldar y nunca cortan la respuesta.

      Después, porque el saldo que se le informa al huésped es el de ya haber
      imputado este cobro; antes, diría que sigue debiendo lo que acaba de pagar.

      Y sin cortar, porque para una pasarela un 500 significa «reintentá»: fallar
      el webhook por un correo que no se pudo anotar haría reprocesar el cobro
      entero para arreglar un aviso.
    */
    await avisarCobroAprobado(admin, {
      reservaId: previo.reserva_id,
      pagoId: previo.id,
      // El importe en USD congelado al crear el link, no el que informa la
      // pasarela: es el mismo criterio con el que se salda la reserva.
      importe: Number(previo.monto),
      medio: evento.medio,
      confirmada: r.confirmada,
    })
  }

  /*
    El rechazo también se avisa, y es lo que convierte una venta perdida en un
    reintento: el huésped se entera en el momento y puede poner otra tarjeta.

    ⚠️ `rechazado` no es final para un pago (la misma referencia externa puede
    prosperar después), así que este aviso puede convivir con el de aprobado.
    Son dos claves distintas y ninguna pisa a la otra.
  */
  if (evento.estado === 'rechazado') {
    await avisarCobroRechazado(admin, {
      reservaId: previo.reserva_id,
      pagoId: previo.id,
      importe: Number(previo.monto),
      enlace: `${urlDelSitio()}/reservar`,
    })
  }

  return Response.json({ ok: true })
}

/**
 * Registra un cobro que el sistema NO originó.
 *
 * Pasa cuando alguien cobra desde el panel de la pasarela y la referencia
 * externa igual apunta a una reserva. Es el único caso en el que hay que
 * convertir a USD acá, porque no hay un importe congelado de antes.
 */
async function registrarCobroAjeno(
  admin: ClienteAdmin,
  evento: WebhookEvent,
  proveedor: string,
) {
  if (!evento.reservaId) {
    // Sin reserva no hay a qué imputarlo. 200 porque el aviso está bien: el que
    // no corresponde es el cobro, y reintentarlo no lo va a arreglar.
    await registrarError('webhook_pago_sin_reserva', { proveedor, externalId: evento.externalId })
    return Response.json({ ok: true, ignorado: 'el cobro no referencia ninguna reserva' })
  }

  /*
    Conversión a USD.

    En moneda extranjera hace falta la cotización, y acá no hay una congelada.
    Se usa la vigente, que es lo mejor disponible, y queda registrada en la fila
    para que el importe en dólares sea auditable.
  */
  let montoUSD = evento.monto
  let cotizacion = 1
  let montoCobrado = evento.monto

  if (evento.moneda !== MONEDA_BASE) {
    const vigente = await cotizacionVigente(evento.moneda)
    // `venta` es la que se cobra: cuántos pesos cuesta comprar un dólar.
    const valor = vigente?.venta ?? null

    if (!valor) {
      // Sin cotización, el importe en USD sería inventado y saldaría mal la
      // reserva. 500 para que la pasarela reintente: puede haberla en un rato.
      await registrarError('webhook_pago_sin_cotizacion', {
        proveedor,
        moneda: evento.moneda,
        externalId: evento.externalId,
      })
      return Response.json({ error: 'sin cotización para convertir' }, { status: 500 })
    }

    const enUSD = imputarEnUSD(evento.monto, valor)
    if (enUSD === null) {
      return Response.json({ error: 'no se pudo convertir el importe' }, { status: 400 })
    }
    montoUSD = enUSD
    cotizacion = valor
    montoCobrado = evento.monto
  }

  const { error } = await admin.from('pagos').insert({
    reserva_id: evento.reservaId,
    medio: evento.medio,
    tipo: evento.tipo,
    monto: montoUSD,
    moneda: evento.moneda,
    monto_cobrado: montoCobrado,
    cotizacion,
    estado: evento.estado,
    external_id: evento.externalId,
    nota: 'Cobro registrado desde la pasarela, sin link generado por el sistema.',
  })

  if (error) {
    // 23505 = unique_violation. Otra entrega del mismo evento se adelantó entre
    // la lectura y este insert. No es un fallo: la fila que quedó es la buena.
    if (error.code === '23505') return Response.json({ ok: true, duplicado: true })
    return Response.json({ error: error.message }, { status: 500 })
  }

  if (evento.estado === 'aprobado') {
    const r = await saldarReserva(admin, evento.reservaId)
    if (r.error) return Response.json({ error: r.error }, { status: 500 })

    /*
      Igual que en el cobro conocido: después de saldar y sin cortar la respuesta.

      La clave de idempotencia del aviso es el `external_id`, que es lo único que
      identifica a este cobro: la fila del pago se acaba de insertar y no se leyó
      de vuelta su `id`. Reprocesar el evento encuentra el aviso que ya está.
    */
    await avisarCobroAprobado(admin, {
      reservaId: evento.reservaId,
      pagoId: evento.externalId,
      importe: montoUSD,
      medio: evento.medio,
      confirmada: r.confirmada,
    })
  }

  return Response.json({ ok: true })
}

/**
 * Marca la reserva como `pagada` si los pagos registrados la saldan.
 *
 * La regla vive en `lib/reservas/saldar.ts`: el mostrador (`registrarPago`) hace lo
 * mismo, las dos copias divergieron una vez —allá se corrigió para consolidar
 * alojamiento + consumos y acá no— y una regla de plata duplicada se vuelve a
 * separar. Esta función queda solo para traducir el resultado a lo que el webhook
 * necesita responder.
 *
 * Devuelve `error: null` cuando no hay nada que hacer o salió bien, y el motivo
 * cuando falló algo de base. Los errores de lectura importan tanto como los de
 * escritura: si no se pudo leer el total o los pagos, el resumen daría «no saldada»
 * y se saltearía la transición **por un problema de infraestructura**, respondiendo
 * `ok`. Eso es exactamente el fallo silencioso que hay que evitar.
 *
 * `confirmada` dice si **este** cobro fue el que pasó la reserva a firme. Es lo que
 * distingue el aviso de «recibimos tu pago» del de «tu reserva está confirmada»: sin
 * ese dato habría que elegir entre prometer de más al recibir la primera seña o no
 * avisar nunca que la habitación quedó asegurada.
 */
async function saldarReserva(
  admin: ClienteAdmin,
  reservaId: string,
): Promise<{ error: string | null; confirmada: boolean }> {
  const { error, noExiste, confirmada } = await saldarSiCorresponde(admin, reservaId)

  // Una reserva inexistente NO es motivo de 500: reintentar no la va a hacer
  // aparecer, y un reintento eterno es peor que aceptar el evento. Por eso el módulo
  // compartido lo devuelve aparte del error.
  if (noExiste) return { error: null, confirmada: false }

  return { error, confirmada }
}
