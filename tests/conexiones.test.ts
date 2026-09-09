import { describe, it, expect } from 'vitest'
import {
  PROVEEDORES,
  TIPO_CONEXION,
  ETIQUETAS_PROVEEDOR,
  ETIQUETAS_ESTADO_CONEXION,
  ESTADOS_CONEXION,
  pareceUrlDeCalendario,
  pareceContenidoDeCalendario,
  tipoAmbiguoParaICal,
} from '@/lib/domain/conexiones'

describe('catálogo de proveedores', () => {
  it('todo proveedor tiene etiqueta y tipo de conexión', () => {
    for (const p of PROVEEDORES) {
      expect(ETIQUETAS_PROVEEDOR[p]).toBeTruthy()
      expect(['oauth2', 'ical']).toContain(TIPO_CONEXION[p])
    }
  })

  it('Mercado Pago y el correo son OAuth2; Booking y Expedia son iCal', () => {
    expect(TIPO_CONEXION.mercadopago).toBe('oauth2')
    expect(TIPO_CONEXION.google_mail).toBe('oauth2')
    expect(TIPO_CONEXION.booking).toBe('ical')
    expect(TIPO_CONEXION.expedia).toBe('ical')
  })

  it('todo estado tiene etiqueta', () => {
    for (const e of ESTADOS_CONEXION) {
      expect(ETIQUETAS_ESTADO_CONEXION[e]).toBeTruthy()
    }
  })
})

describe('pareceUrlDeCalendario', () => {
  it('acepta una URL https', () => {
    expect(pareceUrlDeCalendario('https://admin.booking.com/calendar/abc123.ics')).toBe(true)
  })

  it('rechaza http sin cifrar: un link de disponibilidad es una credencial', () => {
    expect(pareceUrlDeCalendario('http://admin.booking.com/calendar/abc123.ics')).toBe(false)
  })

  it('rechaza texto que no es una URL', () => {
    expect(pareceUrlDeCalendario('esto no es un link')).toBe(false)
    expect(pareceUrlDeCalendario('')).toBe(false)
  })
})

describe('pareceContenidoDeCalendario', () => {
  it('acepta un feed real', () => {
    expect(pareceContenidoDeCalendario('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR')).toBe(true)
  })

  it('rechaza una página HTML (el link apunta a otra cosa)', () => {
    expect(pareceContenidoDeCalendario('<!doctype html><html>...')).toBe(false)
  })

  it('tolera espacio en blanco inicial', () => {
    expect(pareceContenidoDeCalendario('\n  BEGIN:VCALENDAR')).toBe(true)
  })
})

describe('tipoAmbiguoParaICal', () => {
  it('una sola unidad del tipo: la sincronización por calendario aplica', () => {
    expect(tipoAmbiguoParaICal(1)).toBe(false)
  })

  it('más de una unidad del tipo: Booking puede no ofrecer la opción', () => {
    expect(tipoAmbiguoParaICal(2)).toBe(true)
    expect(tipoAmbiguoParaICal(5)).toBe(true)
  })
})
