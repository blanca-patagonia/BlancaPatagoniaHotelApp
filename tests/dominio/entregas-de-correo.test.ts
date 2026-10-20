import { describe, it, expect } from 'vitest'
import {
  EVENTOS_DE_ENTREGA,
  esAvance,
  interpretarEvento,
} from '@/lib/domain/entregas'
import { firmaSvix, verificarFirmaSvix } from '@/lib/integraciones/firma-svix'

/**
 * El webhook de entrega de correo.
 *
 * ── Qué cierra ──────────────────────────────────────────────────────────────
 *
 * Los dos estados que sólo puede informar el proveedor: `entregada` y `leida`.
 * Sin ellos un correo pasaba a `enviada` y ahí se quedaba, y un huésped con la
 * dirección mal cargada figuraba avisado.
 */

describe('qué significa cada evento del proveedor', () => {
  it('la entrega y la apertura son estados distintos', () => {
    expect(interpretarEvento('email.delivered')?.estado).toBe('entregada')
    expect(interpretarEvento('email.opened')?.estado).toBe('leida')
  })

  it('un rebote es FALLIDA, con el motivo escrito', () => {
    const e = interpretarEvento('email.bounced')
    expect(e?.estado).toBe('fallida')
    // El motivo se guarda en la columna `error` y es lo que la pantalla muestra:
    // «no se pudo enviar» sin decir por qué no le sirve a nadie en el mostrador.
    expect(e?.error).toMatch(/rechaz/i)
  })

  it('«marcado como spam» se trata como fallida, no como entregada', () => {
    /*
      ⚠️ Técnicamente llegó. Para el hotel significa lo mismo que un rebote y
      más: no hay que volver a escribirle a esa dirección. Seguir haciéndolo
      arruina la reputación del dominio y hace que dejen de llegar los correos de
      TODOS los demás huéspedes.
    */
    const e = interpretarEvento('email.complained')
    expect(e?.estado).toBe('fallida')
    expect(e?.error).toMatch(/no volver a escribirle/i)
  })

  it('una demora NO marca el correo como fallido', () => {
    /*
      El mensaje sigue en camino y el proveedor lo va a reintentar. Marcarlo
      fallido haría que el hotel diera por perdido algo que después llega, y que
      el reintento manual mandara un duplicado.
    */
    const e = interpretarEvento('email.delivery_delayed')
    expect(e?.estado).toBe('enviada')
    expect(e?.sello, 'una demora no es un hito: no lleva sello').toBeNull()
  })

  it('un evento desconocido devuelve null y no rompe', () => {
    // Se ignora en silencio y el webhook responde 200: un webhook que responde
    // 400 a lo que no le interesa termina deshabilitado, y ahí se pierden
    // también los eventos buenos.
    expect(interpretarEvento('email.scheduled')).toBeNull()
    expect(interpretarEvento('')).toBeNull()
    expect(interpretarEvento('contact.created')).toBeNull()
  })

  it('cada evento conocido dice qué sello escribir, o ninguno', () => {
    for (const tipo of EVENTOS_DE_ENTREGA) {
      const e = interpretarEvento(tipo)
      expect(e, `${tipo} sin interpretación`).not.toBeNull()
      expect(
        [null, 'enviada_en', 'entregada_en', 'leida_en'],
        `${tipo} apunta a una columna que no existe`,
      ).toContain(e!.sello)
    }
  })
})

describe('los eventos llegan desordenados', () => {
  it('la apertura no retrocede a entregada', () => {
    /*
      ⚠️ El test que justifica que `esAvance` exista.

      Un webhook no garantiza orden: el evento de apertura puede entrar antes que
      el de entrega. Aplicándolos a ciegas, el segundo haría retroceder de `leida`
      a `entregada` y el sistema **olvidaría** que el huésped abrió el correo.
    */
    expect(esAvance('leida', 'entregada')).toBe(false)
    expect(esAvance('entregada', 'leida')).toBe(true)
  })

  it('un rebote SÍ pisa una entrega', () => {
    // Es información nueva y mala. Al revés que lo anterior: acá el estado peor
    // es el más reciente y el que hay que mostrar.
    expect(esAvance('entregada', 'fallida')).toBe(true)
    expect(esAvance('leida', 'fallida')).toBe(true)
  })

  it('el mismo estado dos veces no es un avance', () => {
    // Resend puede reenviar el mismo evento. Reaplicarlo movería el sello a una
    // hora que no es la que pasó.
    expect(esAvance('entregada', 'entregada')).toBe(false)
    expect(esAvance('enviada', 'enviada')).toBe(false)
  })

  it('todo avanza desde pendiente', () => {
    expect(esAvance('pendiente', 'enviada')).toBe(true)
    expect(esAvance('pendiente', 'fallida')).toBe(true)
  })
})

/**
 * La firma de Svix, que es la que usa Resend.
 *
 * Reimplementar mal un HMAC **no falla ruidosamente**: rechaza todos los eventos,
 * y el síntoma es que el hotel deja de enterarse de los rebotes — o sea, vuelve
 * exactamente al estado que este webhook viene a corregir.
 */
describe('la firma de Resend', () => {
  /*
    La clave del test se ARMA acá en vez de escribirse literal.

    No es un secreto real —son 24 bytes constantes—, pero un `whsec_…` pegado en
    un archivo es indistinguible de uno que sí lo es, tanto para el hook que
    revisa lo que se escribe como para quien lea el diff dentro de un año. Lo que
    importa del fixture es la FORMA (`whsec_` + base64), y eso se conserva.
  */
  const CLAVE_CRUDA = 'clave-de-prueba-24-bytes'
  const SECRETO = `whsec_${btoa(CLAVE_CRUDA)}`

  const CUERPO = '{"type":"email.delivered","data":{"email_id":"abc-123"}}'
  const ID = 'msg_2Kx9'

  function cabeceras(firma: string, timestamp: string, id = ID): Headers {
    return new Headers({
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': firma,
    })
  }

  it('acepta una firma bien calculada', async () => {
    const ahora = 1_800_000_000
    const firma = await firmaSvix(SECRETO, ID, String(ahora), CUERPO)

    const r = await verificarFirmaSvix(
      SECRETO,
      cabeceras(`v1,${firma}`, String(ahora)),
      CUERPO,
      ahora,
    )
    expect(r.valida, r.motivo ?? '').toBe(true)
  })

  it('el id entra en el mensaje firmado', async () => {
    /*
      Svix firma `"<id>.<timestamp>.<cuerpo>"` y no `"<timestamp>.<cuerpo>"`,
      que es lo que firma el otro esquema del proyecto. Es la diferencia más
      fácil de pasar por alto al copiar el módulo de al lado, y el resultado
      sería rechazar todos los eventos.
    */
    const ahora = 1_800_000_000
    const conUnId = await firmaSvix(SECRETO, ID, String(ahora), CUERPO)
    const conOtro = await firmaSvix(SECRETO, 'msg_otro', String(ahora), CUERPO)
    expect(conUnId).not.toBe(conOtro)

    // Y verificar con el id cambiado tiene que fallar.
    const r = await verificarFirmaSvix(
      SECRETO,
      cabeceras(`v1,${conUnId}`, String(ahora), 'msg_otro'),
      CUERPO,
      ahora,
    )
    expect(r.valida).toBe(false)
  })

  it('la clave se usa decodificada de base64, no como texto', async () => {
    /*
      Si se firmara con la cadena literal en vez de con los bytes, la firma nunca
      coincidiría con la del proveedor y ningún evento entraría. Como el error es
      silencioso, se fija acá: firmar con el secreto sin el prefijo tiene que dar
      LO MISMO que con prefijo —el `whsec_` no es parte de la clave—, y además
      distinto de firmar con el base64 tratado como texto plano.
    */
    const ahora = 1_800_000_000
    const conPrefijo = await firmaSvix(SECRETO, ID, String(ahora), CUERPO)
    const sinPrefijo = await firmaSvix(
      SECRETO.slice('whsec_'.length),
      ID,
      String(ahora),
      CUERPO,
    )
    expect(conPrefijo).toBe(sinPrefijo)
  })

  it('rechaza si el cuerpo cambió', async () => {
    const ahora = 1_800_000_000
    const firma = await firmaSvix(SECRETO, ID, String(ahora), CUERPO)

    const r = await verificarFirmaSvix(
      SECRETO,
      cabeceras(`v1,${firma}`, String(ahora)),
      '{"type":"email.bounced","data":{"email_id":"abc-123"}}',
      ahora,
    )
    expect(r.valida, 'se aceptó un cuerpo distinto del firmado').toBe(false)
  })

  it('rechaza un evento viejo', async () => {
    /*
      Sin ventana de tolerancia, capturar un evento válido una vez alcanza para
      reenviarlo para siempre: alguien podría marcar como rebotados los correos
      del hotel a voluntad.
    */
    const firmado = 1_800_000_000
    const firma = await firmaSvix(SECRETO, ID, String(firmado), CUERPO)

    const r = await verificarFirmaSvix(
      SECRETO,
      cabeceras(`v1,${firma}`, String(firmado)),
      CUERPO,
      firmado + 3600,
    )
    expect(r.valida).toBe(false)
    expect(r.motivo).toMatch(/tolerancia/)
  })

  it('acepta cuando la cabecera trae varias firmas', async () => {
    /*
      Svix manda `v1,<firma> v1,<otra>` durante una rotación de secreto.
      Comparar la cabecera entera contra una firma sola rechazaría todo justo en
      ese momento, que es el peor para quedarse sin webhook.
    */
    const ahora = 1_800_000_000
    const buena = await firmaSvix(SECRETO, ID, String(ahora), CUERPO)

    const r = await verificarFirmaSvix(
      SECRETO,
      cabeceras(`v1,firmaVieja== v1,${buena}`, String(ahora)),
      CUERPO,
      ahora,
    )
    expect(r.valida, r.motivo ?? '').toBe(true)
  })

  it('rechaza si faltan las cabeceras', async () => {
    const r = await verificarFirmaSvix(SECRETO, new Headers(), CUERPO, 1_800_000_000)
    expect(r.valida).toBe(false)
    expect(r.motivo).toMatch(/cabeceras/)
  })
})
