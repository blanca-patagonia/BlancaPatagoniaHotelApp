import 'server-only'

/**
 * Selección de proveedor para las integraciones externas.
 *
 * Por qué existe. Los cinco adaptadores del proyecto (`PaymentProvider`,
 * `EmailProvider`, `FirmaElectronicaProvider`, `FacturacionElectronicaProvider`
 * y `AsistenteProvider`) eligen su implementación con el mismo gesto:
 *
 *     process.env.X_PROVIDER ?? 'stub'
 *
 * Ese `??` es cómodo en desarrollo y peligroso en producción. Si la variable
 * falta, está mal escrita o el despliegue no la propagó, el sistema **no falla**:
 * sigue andando con el simulador y nadie se entera. Las consecuencias no son
 * teóricas:
 *
 *  · `facturacion` devuelve un CAE simulado de 14 dígitos, con la forma del real,
 *    sobre una factura verdadera. Es un comprobante apócrifo ante AFIP.
 *  · `email` escribe el correo en la consola del servidor. La confirmación de
 *    reserva, el enlace de firma y la encuesta nunca llegan al huésped.
 *  · `firma` registra una aceptación que el propio módulo documenta como **sin
 *    validez legal**.
 *
 * Un fallo ruidoso al arrancar cuesta un despliegue. Un stub silencioso en
 * producción cuesta facturas mal emitidas que hay que rectificar de a una.
 *
 * La regla que impone este módulo: **en producción, usar un simulador es una
 * decisión explícita, nunca un descuido.** Quien de verdad quiera correr con el
 * simulador puede hacerlo declarándolo con `<CLAVE>=<nombre-del-simulador>`.
 */

/** Un proveedor que sabe decir si opera contra el servicio real. */
export interface ProveedorConModo {
  /** `false` cuando es un simulador: no llama a ningún servicio externo. */
  esReal(): boolean
}

export interface OpcionesDeSeleccion<T> {
  /** Nombre de la variable de entorno, para que el mensaje de error sea accionable. */
  variable: string
  /** Implementaciones disponibles, por nombre. */
  proveedores: Record<string, T>
  /** El que se usa cuando no hay nada configurado. Debe ser un simulador. */
  simulado: string
  /** Valor efectivo de la variable (se pasa para poder testear sin tocar process.env). */
  valor?: string
}

/** ¿Estamos corriendo en producción? Se aísla para poder probar ambos caminos. */
export function esProduccion(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Devuelve el proveedor configurado.
 *
 * Fuera de producción cae al simulador sin ruido: es lo que hace posible
 * desarrollar y correr los tests sin credenciales.
 *
 * En producción hay solo dos caminos válidos: la variable nombra un proveedor
 * real que existe, o nombra el simulador de forma explícita. Cualquier otra cosa
 * —falta, error de tipeo, nombre inexistente— **lanza**, porque cada una de esas
 * situaciones significa que el despliegue está mal y seguir andando empeora el
 * problema en lugar de contenerlo.
 */
export function seleccionarProveedor<T>({
  variable,
  proveedores,
  simulado,
  valor,
}: OpcionesDeSeleccion<T>): T {
  const configurado = valor?.trim()
  const disponibles = Object.keys(proveedores).join(', ')

  if (configurado && proveedores[configurado]) return proveedores[configurado]

  if (!esProduccion()) return proveedores[simulado]

  if (!configurado) {
    throw new Error(
      `Falta ${variable} y el sistema está en producción.\n` +
        `Sin esa variable se usaría «${simulado}», que es un simulador y no ejecuta la ` +
        `operación de verdad.\n` +
        `Definí ${variable} con uno de: ${disponibles}. ` +
        `Si de verdad querés correr con el simulador, poné ${variable}=${simulado}.`,
    )
  }

  throw new Error(
    `${variable}="${configurado}" no corresponde a ningún proveedor conocido.\n` +
      `Disponibles: ${disponibles}.\n` +
      `Antes este caso caía en silencio al simulador «${simulado}»; ahora falla para que ` +
      `un error de tipeo no se confunda con una integración funcionando.`,
  )
}

/**
 * Igual que `seleccionarProveedor`, pero devuelve **varios**.
 *
 * Por qué existe una versión plural, si los otros seis adaptadores se arreglan
 * con uno solo. Porque en pagos la pregunta del negocio es distinta: el hotel no
 * elige «con qué pasarela trabaja», elige **qué medios de pago le ofrece al
 * huésped**, y son varios a la vez. Un huésped de Alemania paga con su tarjeta
 * en dólares por Stripe y uno de Buenos Aires paga en pesos y cuotas por
 * MercadoPago; obligar a elegir una sola dejaría a la mitad de los huéspedes sin
 * poder pagar. Correo, facturación o firma no tienen ese problema: hay un solo
 * proveedor y punto.
 *
 * La variable se escribe separada por comas: `PAGO_PROVIDER=mercadopago,stripe`.
 *
 * Las garantías del singular se mantienen todas: fuera de producción cae al
 * simulador sin ruido, y en producción **un nombre desconocido lanza** en vez de
 * ignorarse. Que un error de tipeo achique en silencio la lista de medios de
 * pago sería exactamente la degradación silenciosa que el ADR 0018 evita —el
 * hotel perdería cobros sin que nadie vea un error—.
 */
export function seleccionarProveedores<T>({
  variable,
  proveedores,
  simulado,
  valor,
}: OpcionesDeSeleccion<T>): T[] {
  const disponibles = Object.keys(proveedores).join(', ')
  const nombres = (valor ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)

  if (nombres.length === 0) {
    if (!esProduccion()) return [proveedores[simulado]]
    throw new Error(
      `Falta ${variable} y el sistema está en producción.\n` +
        `Sin esa variable se usaría «${simulado}», que es un simulador y no cobra de verdad.\n` +
        `Definí ${variable} con uno o varios de: ${disponibles} (separados por comas). ` +
        `Si de verdad querés correr con el simulador, poné ${variable}=${simulado}.`,
    )
  }

  const desconocidos = nombres.filter((n) => !proveedores[n])
  if (desconocidos.length > 0) {
    if (!esProduccion()) {
      console.warn(
        `[integraciones] ${variable} nombra proveedores que no existen: ${desconocidos.join(', ')}. ` +
          `Disponibles: ${disponibles}.`,
      )
    } else {
      throw new Error(
        `${variable}="${valor}" nombra proveedores que no existen: ${desconocidos.join(', ')}.\n` +
          `Disponibles: ${disponibles}.\n` +
          `Se falla en vez de ignorarlos para que un error de tipeo no deje al hotel sin ese ` +
          `medio de pago sin que nadie se entere.`,
      )
    }
  }

  // `Set` para que repetir un nombre no duplique el medio en la pantalla.
  const elegidos = [...new Set(nombres)].filter((n) => proveedores[n]).map((n) => proveedores[n])
  return elegidos.length > 0 ? elegidos : [proveedores[simulado]]
}

/**
 * Advierte cuando un proveedor simulado quedó activo en producción de forma
 * deliberada.
 *
 * No lanza: si alguien lo declaró explícitamente, es su decisión. Pero deja
 * rastro en el log, que es lo mínimo para que aparezca en una investigación.
 */
export function advertirSiEsSimulado(proveedor: ProveedorConModo, variable: string): void {
  if (!esProduccion() || proveedor.esReal()) return
  console.warn(
    `[integraciones] ${variable} apunta a un simulador y el sistema está en producción. ` +
      `Las operaciones de esta integración NO se ejecutan de verdad.`,
  )
}
