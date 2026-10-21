'use server'

import { redirect } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { encolar } from '@/lib/notificaciones'
import { avisarNuevaReserva } from '@/lib/notificaciones/eventos'
import { formatearUSD } from '@/lib/domain/moneda'
import { urlDelSitio } from '@/lib/env'
import { formatoFecha, diasEntre, hoyISO } from '@/lib/fechas'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'
import { HORA_CHECK_IN, HORA_CHECK_OUT } from '@/lib/domain/hotel'
import { permitirIntento } from '@/lib/limites'
import { mensajeLimite } from '@/lib/domain/limites'
import { validarCapacidad } from '@/lib/domain/unidades'
import { textos, rellenar, idiomaValido } from '@/lib/i18n'
import { abrirCobroDelPortal } from '@/lib/payments/portal'
import { PAGAR_DESPUES } from '@/lib/domain/cobro'
import { registrarFalla } from '@/lib/acciones'
import {
  LARGO_MAXIMO,
  MAX_NOCHES_PUBLICO,
  campoInvalido,
  esUuid,
  mismoApellido,
  problemaDeFechas,
} from '@/lib/domain/reserva-publica'

/** Lo que la persona cargó, para devolvérselo si hay un error (ver el formulario). */
export interface ValoresReservaPublica {
  nombre?: string
  apellido?: string
  email?: string
  telefono?: string
  pedido?: string
  condiciones?: boolean
  promociones?: boolean
}

export interface EstadoReservaPublica {
  error?: string
  valores?: ValoresReservaPublica
}

/**
 * Crea una reserva desde el portal público. Corre con `service_role` (el visitante
 * es anónimo): asigna una unidad libre, cotiza y crea la reserva en estado
 * `pendiente` (bloquea el inventario por la restricción de exclusión). La reserva
 * se confirma con el pago de la seña.
 */
export async function crearReservaPublica(
  _prev: EstadoReservaPublica,
  formData: FormData,
): Promise<EstadoReservaPublica> {
  const tipoUnidadId = String(formData.get('tipo') ?? '')
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  const huespedesCant = Math.max(1, Number(formData.get('huespedes') ?? 1) || 1)
  const nombre = String(formData.get('nombre') ?? '').trim()
  const apellido = String(formData.get('apellido') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const telefono = String(formData.get('telefono') ?? '').trim()
  const medio = String(formData.get('medio') ?? PAGAR_DESPUES)
  const pedido = String(formData.get('pedido') ?? '').trim().slice(0, LARGO_MAXIMO.pedido)
  const aceptaCondiciones = formData.get('condiciones') === 'on'
  const aceptaPromociones = formData.get('promociones') === 'on'
  /*
    Idioma de la pantalla, para devolver los errores en el que la persona está
    leyendo. Un idioma desconocido o ausente cae a español, que es lo que esta
    acción respondía antes de traducir el portal.

    Los mensajes que arman OTROS módulos (`validarCapacidad`, `mensajeLimite`,
    `crearReservaEnUnidadLibre`) están escritos en español y los usa también
    el panel. En español se pasan tal cual; en otro idioma se reemplazan por la
    versión traducida del mismo caso, o por un genérico que no deje al huésped
    frente a un texto que no entiende.
  */
  const idioma = idiomaValido(String(formData.get('idioma') ?? '') || undefined)
  const t = textos(idioma).checkout
  const enEspanol = idioma === 'es'

  const valores: ValoresReservaPublica = {
    nombre: nombre.slice(0, LARGO_MAXIMO.nombre),
    apellido: apellido.slice(0, LARGO_MAXIMO.apellido),
    email: email.slice(0, LARGO_MAXIMO.email),
    telefono: telefono.slice(0, LARGO_MAXIMO.telefono),
    pedido,
    condiciones: aceptaCondiciones,
    promociones: aceptaPromociones,
  }
  /** Todo error devuelve además lo cargado, para no vaciar el formulario. */
  const fallo = (error: string): EstadoReservaPublica => ({ error, valores })

  if (!esUuid(tipoUnidadId)) return fallo(t.errorIncompleto)
  /*
    Fechas: que existan en el calendario, en orden, desde hoy y sin pasar el
    tope de noches. La página ya lo avisa, pero esto es un endpoint público y
    un envío directo podía crear una reserva pendiente en el pasado.
  */
  const problema = problemaDeFechas(checkIn, checkOut, hoyISO(), diasEntre)
  if (problema === 'max_noches') {
    return fallo(rellenar(t.errorMaxNoches, { n: MAX_NOCHES_PUBLICO }))
  }
  if (problema) return fallo(t.errorFechas)

  if (!apellido || !email) return fallo(t.errorApellidoEmail)
  /*
    Datos personales: largo, sin saltos de línea ni enlaces. El nombre viaja al
    correo de confirmación que sale del dominio del hotel hacia el email que
    se escribió acá; sin esta guarda se podía redactar un correo oficial.
  */
  const invalido = campoInvalido({ nombre, apellido, email, telefono })
  if (invalido === 'email') return fallo(t.errorEmail)
  if (invalido === 'telefono') return fallo(t.errorTelefono)
  if (invalido) return fallo(t.errorNombre)
  // Las condiciones incluyen la política de cancelación, que es una promesa de
  // plata en las dos direcciones: sin aceptación expresa no se reserva.
  if (!aceptaCondiciones) return fallo(t.errorCondiciones)

  /*
    Límite de volumen. Es la protección más importante del sistema hacia afuera:
    cada reserva pendiente bloquea una unidad durante 5 días, así que sin esto
    unas decenas de envíos dejan al hotel sin inventario vendible por casi una
    semana (ver `docs/4-seguridad-y-auditorias/SEGURIDAD.md`).

    Se comprueba DESPUÉS de validar los campos para no gastar cupo en envíos
    malformados, y ANTES de escribir nada.
  */
  /*
    La URL del sitio, ANTES de escribir nada: la necesitan el correo y la
    vuelta de la pasarela, y si falta la variable lanza. Calculada después de
    crear la reserva, el huésped veía un error, reintentaba y bloqueaba otra
    unidad. Si va a fallar, que falle acá.
  */
  const sitio = urlDelSitio()

  if (!(await permitirIntento('reserva_publica'))) {
    return fallo(enEspanol ? mensajeLimite('reserva_publica') : t.errorLimite)
  }

  const admin = crearClienteAdmin()

  /*
    Capacidad del alojamiento.

    Hasta acá el límite existía solo en el filtro de la pantalla, que sirve para
    no ofrecer una cabaña de cuatro a quien busca para seis. Pero esta acción es
    un endpoint HTTP público: un envío directo con `huespedes: 50` sobre una
    habitación doble entraba sin objeción, y el hotel se enteraba en el mostrador.
  */
  const { data: tipo, error: eTipo } = await admin
    .from('tipos_unidad')
    .select('capacidad_max')
    .eq('id', tipoUnidadId)
    .maybeSingle()
  if (eTipo) {
    registrarFalla(eTipo, 'portal:checkout:tipo_unidad')
    return fallo(enEspanol ? 'No se pudo verificar el alojamiento elegido.' : t.errorGenerico)
  }
  if (!tipo) return fallo(t.errorNoExiste)

  const excedeCapacidad = validarCapacidad(huespedesCant, Number(tipo.capacidad_max))
  if (excedeCapacidad) {
    return fallo(
      enEspanol ? excedeCapacidad : rellenar(t.errorCapacidad, { n: Number(tipo.capacidad_max) }),
    )
  }

  /*
    Huésped: se reutiliza el que vuelve, sin dejar que un email ajeno alcance.

    El email es como el sistema reconoce a quien vuelve (si no, un habitual
    quedaba repetido una vez por reserva, con la fidelidad partida). Pero desde
    la web nadie prueba que el email sea suyo: antes bastaba escribir el de otra
    persona para colgar la reserva de su ficha, ver su nombre en la confirmación
    y activarle las promociones. Ahora:

    · se reutiliza sólo si además coincide el apellido (`mismoApellido`);
    · si hay varias fichas con ese email —pasa, por eso existe la fusión de la
      0111— se toma la más antigua, en vez de fallar con «no se pudieron
      registrar tus datos» en cada intento;
    · una ficha existente NUNCA se modifica desde acá.
  */
  const { data: candidatos, error: eBusqueda } = await admin
    .from('huespedes')
    .select('id, apellido')
    .eq('email', email)
    .order('creado_en', { ascending: true })
    .limit(20)
  if (eBusqueda) {
    registrarFalla(eBusqueda, 'portal:checkout:buscar_huesped')
    return fallo(enEspanol ? 'No se pudieron registrar tus datos.' : t.errorGenerico)
  }

  let huespedId = candidatos?.find((h) => mismoApellido(String(h.apellido ?? ''), apellido))
    ?.id as string | undefined

  if (!huespedId) {
    /*
      Consentimiento comercial: va SÓLO en la ficha que nace acá. Escribirlo
      sobre una existente podía volver a suscribir a alguien que se dio de baja,
      con el email de otra persona como única «prueba».
    */
    const { data: huesped, error: eHuesped } = await admin
      .from('huespedes')
      .insert({
        nombre: nombre || apellido,
        apellido,
        email,
        telefono,
        acepta_promociones: aceptaPromociones,
      })
      .select('id')
      .single()
    if (eHuesped || !huesped) {
      registrarFalla(eHuesped, 'portal:checkout:alta_huesped')
      return fallo(enEspanol ? 'No se pudieron registrar tus datos.' : t.errorGenerico)
    }
    huespedId = huesped.id as string
  }

  // Alta atómica (service_role): unidad libre + cotización + anti-overbooking.
  const res = await crearReservaEnUnidadLibre(admin, {
    tipoUnidadId,
    checkIn,
    checkOut,
    huespedes: huespedesCant,
    huespedId,
    canal: 'web',
    tarifaTipo: 'rack',
    estado: 'pendiente',
  })
  if (!res.ok) {
    // El único fallo que el huésped puede resolver solo es que otro se llevó
    // la unidad mientras completaba los datos: se le dice eso, en su idioma.
    if (res.error.includes('ya no está disponible')) return fallo(t.errorNoDisponible)
    /*
      Los mensajes de `crearReservaEnUnidadLibre` son para el staff: alguno
      arrastra el texto de Postgres («No se pudo crear la reserva: …»). Al
      público se le muestran sólo los que le sirven; el resto queda en el log.
    */
    if (enEspanol && !res.error.startsWith('No se pudo crear la reserva:')) {
      return fallo(res.error)
    }
    registrarFalla({ message: res.error }, 'portal:checkout:crear_reserva')
    return fallo(t.errorGenerico)
  }
  const nueva = res.reserva

  /*
    El pedido especial va a `reservas.notas`, que es lo que recepción ve en la
    ficha de la reserva del panel. Se marca de dónde vino para que no se
    confunda con una nota que escribió el propio personal.
  */
  if (pedido) {
    const { error: eNotas } = await admin
      .from('reservas')
      .update({ notas: `Pedido del huésped (web): ${pedido}` })
      .eq('id', nueva.id)
    registrarFalla(eNotas, 'portal:checkout:pedido_especial')
  }
  /*
    La URL pública usa el token opaco (no el código, que es enumerable).
    `crear_reserva` devuelve la fila completa, token incluido: antes se volvía
    a leer y, si esa lectura fallaba, se usaba el `id` como token — el
    redirect, el correo y el link de pago apuntaban a un 404.
  */
  const token = nueva.token
  /*
    La confirmación vive fuera de `[idioma]` (su dirección viaja en correos) y
    toma el idioma de la consulta: sin esto, quien reservó en inglés terminaba
    en una pantalla en español.
  */
  const sufijoIdioma = idioma === 'es' ? '' : `?idioma=${idioma}`

  /*
    La confirmación se **encola**, no se envía acá.

    Antes salía dentro de este mismo request y el resultado se descartaba: si el
    proveedor fallaba, el correo se perdía sin rastro ni reintento, y el huésped
    se quedaba sin su confirmación mientras la pantalla decía que todo salió bien.
    Además una API lenta demoraba el alta de la reserva, que es lo que la persona
    está esperando del otro lado.

    La bandeja (migración 0075) lo separa: acá se anota qué comunicar y el cron lo
    manda con reintentos. `confirmacion_reserva` está en los inmediatos, así que
    no espera al horario permitido — es el mensaje que el huésped aguarda.

    El total va con `formatearUSD` y no con `toLocaleString`, que usa entre 0 y 3
    decimales y publicaba «USD 726», «USD 290,4» y «USD 40,11» en el mismo lugar.
  */
  await encolar(admin, {
    evento: 'confirmacion_reserva',
    entidadId: nueva.id,
    destinatario: email,
    // Con WhatsApp enchufado, la confirmación sale por ahí: es el aviso que el
    // huésped está esperando en ese mismo minuto (ver `canalDelAviso`).
    telefono,
    huespedId,
    reservaId: nueva.id,
    variables: {
      nombre: nombre || apellido,
      codigo: nueva.codigo,
      /*
        Con año, y no `formatoFechaCorta`.

        El correo de confirmación decía «10/01» a secas. Dos problemas: el año
        falta justo cuando más importa —una reserva hecha en diciembre para
        enero cruza de año— y `DD/MM` es ambiguo para medio mundo, que lee
        `MM/DD` y entiende una fecha distinta. En una pantalla el contexto
        salva; en un correo que el huésped archiva y relee en tres meses, no.
      */
      check_in: formatoFecha(checkIn),
      check_out: formatoFecha(checkOut),
      hora_check_in: HORA_CHECK_IN,
      hora_check_out: HORA_CHECK_OUT,
      total: formatearUSD(Number(nueva.total)),
      enlace: `${sitio}/reservar/confirmacion/${token}${sufijoIdioma}`,
    },
  })

  /*
    Y el hotel se entera.

    Una reserva que entra por la web a las tres de la mañana no la ve nadie hasta
    que alguien abre el listado. El aviso interno aterriza en la cartelera que el
    staff ya mira, con el código, las fechas y el total: lo mínimo para saber si
    hay que hacer algo antes de que llegue.

    `origen` dice de dónde vino, que es lo que distingue esto de lo que el propio
    mostrador acaba de cargar —eso no se avisa, la persona está ahí—.
  */
  await avisarNuevaReserva(admin, {
    reservaId: nueva.id,
    codigo: nueva.codigo,
    checkIn,
    checkOut,
    total: Number(nueva.total),
    origen: 'Portal web',
  })

  /*
    Pago en el mismo paso.

    Si el huésped eligió una pasarela, se abre el cobro de la seña y se lo manda
    ahí. La reserva YA está creada (`pendiente`) y el aviso al hotel ya salió:
    si la pasarela falla, no se pierde nada —se cae a la confirmación, que
    ofrece «Pagar la seña» con los mismos medios—. Lo que confirma el pago es el
    webhook, no la vuelta del huésped (ADR 0027).
  */
  if (medio !== PAGAR_DESPUES) {
    const cobro = await abrirCobroDelPortal(admin, {
      reservaId: nueva.id,
      codigo: nueva.codigo,
      estado: 'pendiente',
      token,
      medio,
      tipoPedido: 'senia',
      email,
      idioma,
    })
    if (cobro.ok) redirect(cobro.url)
    redirect(`/reservar/confirmacion/${token}?pago=fallo${idioma === 'es' ? '' : `&idioma=${idioma}`}`)
  }

  redirect(`/reservar/confirmacion/${token}${sufijoIdioma}`)
}
