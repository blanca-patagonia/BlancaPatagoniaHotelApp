import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  AREA_DE_PROPUESTA,
  CAMPOS_EN_TARJETA,
  destinoDeRedireccion,
  esIrreversible,
  interpretarDestino,
  describirPropuesta,
  validarPropuesta,
  puedeConfirmar,
} from '@/lib/domain/ia-acciones'
import { herramientasPara } from '@/lib/domain/ia-herramientas'
import { AREAS, rutaDeArea } from '@/lib/domain/permisos'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

describe('validarPropuesta (lo que el asistente puede preparar y vuelve al confirmar)', () => {
  it('acepta un aviso con texto', () => {
    expect(validarPropuesta({ tipo: 'aviso', mensaje: '  Corte de agua a las 15  ' })).toEqual({
      tipo: 'aviso',
      mensaje: 'Corte de agua a las 15',
    })
  })

  it('rechaza un tipo desconocido: el asistente no inventa acciones', () => {
    expect(validarPropuesta({ tipo: 'cancelar_reserva', reservaId: UUID_A })).toBeNull()
    expect(validarPropuesta(null)).toBeNull()
    expect(validarPropuesta('aviso')).toBeNull()
  })

  it('orden de mantenimiento: prioridad de la lista y unidad con id válido o ninguna', () => {
    const base = { tipo: 'orden_mantenimiento', titulo: 'Pierde la ducha', prioridad: 'alta' }
    expect(validarPropuesta({ ...base, unidadId: UUID_A, unidadNombre: 'Hab 12' })).toMatchObject({
      unidadId: UUID_A,
      unidadNombre: 'Hab 12',
    })
    expect(validarPropuesta({ ...base, unidadId: null })).toMatchObject({ unidadId: null })
    expect(validarPropuesta({ ...base, prioridad: 'urgentísima', unidadId: null })).toBeNull()
    expect(validarPropuesta({ ...base, unidadId: 'la 12' })).toBeNull()
  })

  it('consumo: ids, cantidad entera entre 1 y 50 y precio no negativo', () => {
    const base = {
      tipo: 'consumo',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      productoId: UUID_B,
      producto: 'Café',
      cantidad: 2,
      precioUnitario: 3.5,
    }
    expect(validarPropuesta(base)).toEqual(base)
    expect(validarPropuesta({ ...base, cantidad: 0 })).toBeNull()
    expect(validarPropuesta({ ...base, cantidad: 1.5 })).toBeNull()
    expect(validarPropuesta({ ...base, cantidad: 500 })).toBeNull()
    expect(validarPropuesta({ ...base, precioUnitario: -1 })).toBeNull()
    expect(validarPropuesta({ ...base, reservaId: 'BP-1' })).toBeNull()
  })

  it('un texto vacío o desmedido no pasa', () => {
    expect(validarPropuesta({ tipo: 'aviso', mensaje: '   ' })).toBeNull()
    expect(validarPropuesta({ tipo: 'aviso', mensaje: 'x'.repeat(5000) })).toBeNull()
  })
})

describe('describirPropuesta', () => {
  it('el consumo muestra cantidad, producto y total', () => {
    const d = describirPropuesta({
      tipo: 'consumo',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      productoId: UUID_B,
      producto: 'Café',
      cantidad: 2,
      precioUnitario: 3.5,
    })
    expect(d.titulo).toContain('BP-1')
    expect(d.detalle).toEqual(['2 × Café', 'USD 7,00'])
  })

  it('una orden de prioridad alta avisa que va a la cartelera', () => {
    const d = describirPropuesta({
      tipo: 'orden_mantenimiento',
      titulo: 'Sin agua caliente',
      descripcion: '',
      prioridad: 'alta',
      unidadId: null,
      unidadNombre: null,
    })
    expect(d.detalle.join(' ')).toContain('cartelera')
  })
})

describe('rutas de las áreas', () => {
  it('cada área del panel tiene su carpeta (los enlaces del asistente no llevan a un 404)', () => {
    for (const area of AREAS) {
      const carpeta = rutaDeArea(area).replace('/panel', '')
      expect(existsSync(join(process.cwd(), 'src/app/(front-gestion)/panel', carpeta)), area).toBe(true)
    }
  })

  it('cada acción tiene un área', () => {
    for (const area of Object.values(AREA_DE_PROPUESTA)) expect(AREAS).toContain(area)
  })
})

describe('estado de limpieza', () => {
  it('acepta limpia / sucia / inspeccionada con una unidad válida', () => {
    expect(
      validarPropuesta({ tipo: 'estado_unidad', unidadId: UUID_A, unidadNombre: 'Agassiz', estado: 'limpia' }),
    ).toEqual({ tipo: 'estado_unidad', unidadId: UUID_A, unidadNombre: 'Agassiz', estado: 'limpia' })
  })

  it('NO acepta «bloqueada»: sacar una unidad de la venta se decide en la pantalla', () => {
    expect(
      validarPropuesta({ tipo: 'estado_unidad', unidadId: UUID_A, unidadNombre: 'Agassiz', estado: 'bloqueada' }),
    ).toBeNull()
  })

  it('«inspeccionada» avisa que se le comunica a recepción', () => {
    const d = describirPropuesta({ tipo: 'estado_unidad', unidadId: UUID_A, unidadNombre: 'Agassiz', estado: 'inspeccionada' })
    expect(d.detalle.join(' ')).toMatch(/recepción/)
  })
})

describe('acciones sobre reservas, huéspedes y facturas (ADR 0041, ampliación)', () => {
  it('estado de reserva: sólo los cambios de la lista', () => {
    const base = { tipo: 'estado_reserva', reservaId: UUID_A, codigoReserva: 'BP-1', cargo: '' }
    expect(validarPropuesta({ ...base, estado: 'in_house' })).toMatchObject({ estado: 'in_house' })
    expect(validarPropuesta({ ...base, estado: 'pagada' })).toBeNull()
  })

  it('cancelar muestra el cargo ANTES de confirmar y es irreversible', () => {
    const p = validarPropuesta({
      tipo: 'estado_reserva',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      estado: 'cancelada',
      cargo: 'Se cobra la primera noche: USD 120,00.',
    })!
    expect(describirPropuesta(p).detalle).toContain('Se cobra la primera noche: USD 120,00.')
    expect(esIrreversible(p)).toBe(true)
  })

  it('confirmar o hacer el check-in no son irreversibles', () => {
    const p = validarPropuesta({ tipo: 'estado_reserva', reservaId: UUID_A, codigoReserva: 'BP-1', estado: 'in_house', cargo: '' })!
    expect(esIrreversible(p)).toBe(false)
  })

  it('reprogramar exige salida después de la llegada', () => {
    const base = { tipo: 'reprogramar', reservaId: UUID_A, codigoReserva: 'BP-1', politica: 'recotizar' }
    expect(validarPropuesta({ ...base, checkIn: '2026-11-10', checkOut: '2026-11-12' })).not.toBeNull()
    expect(validarPropuesta({ ...base, checkIn: '2026-11-12', checkOut: '2026-11-10' })).toBeNull()
  })

  it('nota de crédito: importe positivo y motivo de al menos 5 letras', () => {
    const base = { tipo: 'nota_credito', reservaId: UUID_A, codigoReserva: 'BP-1' }
    expect(validarPropuesta({ ...base, monto: 50, motivo: 'Noche no usada' })).toMatchObject({ monto: 50 })
    expect(validarPropuesta({ ...base, monto: 0, motivo: 'Noche no usada' })).toBeNull()
    expect(validarPropuesta({ ...base, monto: 50, motivo: 'no' })).toBeNull()
  })

  it('nueva reserva: apellido, fechas, adultos y un email válido si lo hay', () => {
    const base = {
      tipo: 'nueva_reserva',
      tipoUnidadId: UUID_A,
      tipoNombre: 'Superior',
      checkIn: '2026-11-10',
      checkOut: '2026-11-12',
      adultos: 2,
      menores: 0,
      apellido: 'García',
      nombre: 'Ana',
      totalEstimado: 814.57,
      email: '',
      docNumero: '',
    }
    expect(validarPropuesta(base)).not.toBeNull()
    expect(validarPropuesta({ ...base, email: 'no-es-un-email' })).toBeNull()
    expect(validarPropuesta({ ...base, adultos: 0 })).toBeNull()
    expect(validarPropuesta({ ...base, apellido: '' })).toBeNull()
  })

  it('los datos de contacto se completan en la tarjeta, no los trae la IA', () => {
    expect(CAMPOS_EN_TARJETA.huesped_nuevo?.map((c) => c.clave)).toEqual([
      'email',
      'telefono',
      'docNumero',
      'nacionalidad',
    ])
    expect(CAMPOS_EN_TARJETA.nueva_reserva?.map((c) => c.clave)).toEqual(['email', 'docNumero'])
  })

  it('facturar es irreversible y lo dice', () => {
    const p = validarPropuesta({ tipo: 'factura', reservaId: UUID_A, codigoReserva: 'BP-1' })!
    expect(esIrreversible(p)).toBe(true)
    expect(describirPropuesta(p).detalle.join(' ')).toMatch(/CAE/)
  })
})

describe('reusar una acción de pantalla: leer su redirect', () => {
  it('destinoDeRedireccion lee el digest de Next y nada más', () => {
    const e = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/panel/reservas/abc?error=transicion;307;',
    })
    expect(destinoDeRedireccion(e)).toBe('/panel/reservas/abc?error=transicion')
    expect(destinoDeRedireccion(new Error('otra cosa'))).toBeNull()
    expect(destinoDeRedireccion(null)).toBeNull()
  })

  it('un ?error= se traduce con el mapa de la pantalla', () => {
    expect(
      interpretarDestino('/panel/reservas/abc?error=transicion', { transicion: 'Ese cambio de estado no corresponde.' }, 'Listo.'),
    ).toEqual({ error: 'Ese cambio de estado no corresponde.', enlace: '/panel/reservas/abc' })
  })

  it('una clave desconocida da un mensaje genérico con el enlace', () => {
    expect(interpretarDestino('/panel/reservas/abc?error=rara', {}, 'Listo.').error).toMatch(/Abrí la pantalla/)
  })

  it('volver a /panel o al login es un rechazo de rol', () => {
    expect(interpretarDestino('/panel', {}, 'Listo.').error).toMatch(/rol/)
    expect(interpretarDestino('/login', {}, 'Listo.').error).toMatch(/rol/)
  })

  it('cualquier otro destino es éxito, con el enlace a la pantalla', () => {
    expect(interpretarDestino('/panel/reservas/abc', {}, 'Check-in hecho.')).toEqual({
      ok: 'Check-in hecho.',
      enlace: '/panel/reservas/abc',
    })
  })

  it('una clave heredada de Object.prototype no se cuela como mensaje', () => {
    expect(interpretarDestino('/panel/x?error=constructor', {}, 'Listo.').error).toMatch(/Abrí la pantalla/)
  })
})

describe('mensaje al huésped', () => {
  it('exige un texto de al menos 10 letras y no más de 1500', () => {
    const base = { tipo: 'mensaje_huesped', reservaId: UUID_A, codigoReserva: 'BP-1' }
    expect(validarPropuesta({ ...base, mensaje: 'Te esperamos el viernes.' })).not.toBeNull()
    expect(validarPropuesta({ ...base, mensaje: 'hola' })).toBeNull()
    expect(validarPropuesta({ ...base, mensaje: 'x'.repeat(2000) })).toBeNull()
  })

  it('el mensaje se revisa en la tarjeta antes de enviar', () => {
    expect(CAMPOS_EN_TARJETA.mensaje_huesped).toEqual([
      { clave: 'mensaje', etiqueta: 'Mensaje (podés corregirlo)', largo: true },
    ])
  })
})

describe('cerrar lo abierto: orden de mantenimiento y objeto perdido', () => {
  const ID = '11111111-1111-4111-8111-111111111111'

  it('estado de orden: sólo pendiente, en_proceso o resuelta, con id y título', () => {
    expect(validarPropuesta({ tipo: 'estado_orden', ordenId: ID, titulo: 'Ducha', estado: 'resuelta' })).toEqual({
      tipo: 'estado_orden',
      ordenId: ID,
      titulo: 'Ducha',
      estado: 'resuelta',
    })
    expect(validarPropuesta({ tipo: 'estado_orden', ordenId: ID, titulo: 'Ducha', estado: 'cerrada' })).toBeNull()
    expect(validarPropuesta({ tipo: 'estado_orden', ordenId: 'x', titulo: 'Ducha', estado: 'resuelta' })).toBeNull()
    expect(validarPropuesta({ tipo: 'estado_orden', ordenId: ID, titulo: '', estado: 'resuelta' })).toBeNull()
  })

  it('la tarjeta dice qué pasa al reabrir o resolver', () => {
    const resuelta = describirPropuesta({ tipo: 'estado_orden', ordenId: ID, titulo: 'Ducha', estado: 'resuelta' })
    expect(resuelta.titulo).toBe('Marcar la orden «Ducha» como resuelta')
    const reabierta = describirPropuesta({ tipo: 'estado_orden', ordenId: ID, titulo: 'Ducha', estado: 'pendiente' })
    expect(reabierta.detalle.join(' ')).toMatch(/reabre/)
  })

  it('objeto devuelto: id y descripción; va al área de objetos perdidos', () => {
    expect(validarPropuesta({ tipo: 'objeto_devuelto', objetoId: ID, descripcion: 'Campera azul' })).toMatchObject({
      tipo: 'objeto_devuelto',
    })
    expect(validarPropuesta({ tipo: 'objeto_devuelto', objetoId: ID, descripcion: '  ' })).toBeNull()
    expect(AREA_DE_PROPUESTA.objeto_devuelto).toBe('objetos_perdidos')
    expect(AREA_DE_PROPUESTA.estado_orden).toBe('mantenimiento')
  })
})

describe('acciones sólo de la dirección (auditoría de seguridad 2026-10-20)', () => {
  it('la nota de crédito la confirman admin y gerencia, no recepción', () => {
    expect(puedeConfirmar('admin', 'nota_credito')).toBe(true)
    expect(puedeConfirmar('gerencia', 'nota_credito')).toBe(true)
    expect(puedeConfirmar('recepcion', 'nota_credito')).toBe(false)
    expect(puedeConfirmar('housekeeping', 'nota_credito')).toBe(false)
  })

  it('el resto sigue la matriz de áreas: recepción factura y cancela', () => {
    expect(puedeConfirmar('recepcion', 'factura')).toBe(true)
    expect(puedeConfirmar('recepcion', 'estado_reserva')).toBe(true)
    expect(puedeConfirmar('housekeeping', 'factura')).toBe(false)
  })

  it('a recepción ni siquiera se le ofrece la herramienta', () => {
    const nombres = (rol: 'recepcion' | 'gerencia') => herramientasPara(rol).map((h) => h.nombre)
    expect(nombres('recepcion')).not.toContain('proponer_nota_credito')
    expect(nombres('recepcion')).toContain('proponer_factura')
    expect(nombres('gerencia')).toContain('proponer_nota_credito')
  })
})
