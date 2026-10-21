import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * El exportador CSV del panel (`/panel/exportar/<recurso>`), con la base simulada.
 *
 * Cubre los cuatro defectos que tuvo:
 *  · los filtros de la pantalla llegaban en la URL y se ignoraban;
 *  · los importes salían con punto decimal, que Excel en es-AR no suma;
 *  · un fallo de la base entregaba un CSV vacío, idéntico a «no hay datos»;
 *  · no había forma de bajar las facturas emitidas (libro de ventas).
 */

interface Llamada {
  tabla: string
  metodos: { nombre: string; args: unknown[] }[]
}

let llamadas: Llamada[] = []
/** Filas que devuelve cada tabla, o el error con el que falla. */
let respuestas: Record<string, { data?: unknown[]; error?: { message: string } }> = {}

/** Un builder de supabase-js que anota cada llamada y resuelve con `respuestas`. */
function builder(tabla: string) {
  const llamada: Llamada = { tabla, metodos: [] }
  llamadas.push(llamada)
  const proxy: Record<string, unknown> = {}
  for (const nombre of ['select', 'or', 'ilike', 'eq', 'is', 'order', 'gte', 'lt', 'in']) {
    proxy[nombre] = (...args: unknown[]) => {
      llamada.metodos.push({ nombre, args })
      return proxy
    }
  }
  proxy.range = (desde: number) => {
    llamada.metodos.push({ nombre: 'range', args: [desde] })
    const r = respuestas[tabla] ?? { data: [] }
    // Segundo tramo vacío: `traerTodo` confirma así que terminó.
    return Promise.resolve(
      r.error ? { data: null, error: r.error } : { data: desde === 0 ? r.data : [], error: null },
    )
  }
  return proxy
}

vi.mock('@/lib/supabase/server', () => ({
  crearClienteServidor: async () => ({ from: (tabla: string) => builder(tabla) }),
}))
vi.mock('@/lib/auth/session', () => ({
  obtenerSesion: async () => ({ userId: 'u1', email: 'a@b.c', nombre: 'Admin', rol: 'admin' }),
}))
const registrarError = vi.fn()
vi.mock('@/lib/registro', () => ({
  registrarError: (...a: unknown[]) => registrarError(...a),
  registrarAviso: vi.fn(),
  registrarErrorSync: vi.fn(),
  registrarInfo: vi.fn(),
}))

const { GET } = await import('@/app/(front-gestion)/panel/exportar/[recurso]/route')

async function exportar(recurso: string, query = '') {
  const res = await GET(new Request(`http://localhost/panel/exportar/${recurso}${query}`), {
    params: Promise.resolve({ recurso }),
  })
  return { res, texto: (await res.text()).replace(/^﻿/, '') }
}

/** Las llamadas a un método sobre la primera consulta a esa tabla. */
function metodos(tabla: string, nombre: string) {
  const llamada = llamadas.find((l) => l.tabla === tabla)
  return (llamada?.metodos ?? []).filter((m) => m.nombre === nombre).map((m) => m.args)
}

beforeEach(() => {
  llamadas = []
  respuestas = {}
  registrarError.mockClear()
})

describe('exportar: los filtros de la pantalla viajan al archivo', () => {
  it('huéspedes: la búsqueda se aplica (antes bajaba el padrón entero)', async () => {
    await exportar('huespedes', '?q=Pérez')
    const [[condicion]] = metodos('huespedes', 'or')
    expect(condicion).toContain('apellido.ilike."%Pérez%"')
    expect(condicion).toContain('doc_numero.ilike')
  })

  it('gastos: categoría y búsqueda, con el patrón SIN comillas literales', async () => {
    await exportar('gastos', '?categoria=servicios&q=luz')
    expect(metodos('gastos_operativos', 'eq')).toEqual([['categoria', 'servicios']])
    expect(metodos('gastos_operativos', 'ilike')).toEqual([['descripcion', '%luz%']])
  })

  it('gastos: una categoría inventada no filtra por algo que no existe', async () => {
    await exportar('gastos', '?categoria=cualquiera')
    expect(metodos('gastos_operativos', 'eq')).toEqual([])
  })

  it('comprobantes: la vista «sin imputar»', async () => {
    await exportar('comprobantes', '?vista=sin_imputar')
    expect(metodos('comprobantes_recibidos', 'is')).toEqual([['movimiento_id', null]])
  })

  it('el orden siempre termina en id, para que los tramos de mil no se pisen', async () => {
    await exportar('huespedes')
    const ordenes = metodos('huespedes', 'order').map((a) => a[0])
    expect(ordenes.at(-1)).toBe('id')
  })
})

describe('exportar: formato para Excel en es-AR', () => {
  it('los importes salen con coma decimal', async () => {
    respuestas.gastos_operativos = {
      data: [{ fecha: '2026-09-01', categoria: 'servicios', descripcion: 'Luz', monto: '1234.5', moneda: 'ARS' }],
    }
    const { res, texto } = await exportar('gastos')
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(texto.split('\r\n')[1]).toMatch(/^2026-09-01;Servicios[^;]*;Luz;1234,50;ARS$/)
  })
})

describe('exportar: un fallo de la base no se disfraza de archivo vacío', () => {
  it('responde 500 con un mensaje en español y deja registro', async () => {
    respuestas.huespedes = { error: { message: 'connection reset' } }
    const { res, texto } = await exportar('huespedes')
    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Disposition')).toBeNull()
    expect(texto).toContain('No se pudo generar el archivo')
    expect(registrarError).toHaveBeenCalledWith(
      'exportacion_fallida',
      expect.objectContaining({ recurso: 'huespedes', detalle: 'connection reset' }),
    )
  })
})

describe('exportar: libro de ventas', () => {
  it('filtra el mes en la zona del hotel y resta las notas de crédito', async () => {
    const reserva = { codigo: 'BP-1', huesped: { nombre: 'Ana', apellido: 'Pérez' } }
    const fiscales = {
      tipo_comprobante: 'B',
      punto_venta: 3,
      exento: 0,
      alicuota_iva: 21,
      moneda: 'USD',
      cae: null,
      cae_vto: null,
    }
    respuestas.facturas = {
      data: [
        {
          ...fiscales,
          numero: 'FAC-1',
          numero_fiscal: '00003-00000001',
          emitida_en: '2026-09-05T12:00:00Z',
          neto: 100,
          iva: 21,
          total: 121,
          cuit_receptor: null,
          condicion_iva_receptor: 'consumidor_final',
          motivo_exencion: null,
          reserva,
        },
      ],
    }
    respuestas.notas_credito = {
      data: [
        {
          ...fiscales,
          numero: 'NC-1',
          numero_fiscal: '00003-00000001',
          emitida_en: '2026-09-06T12:00:00Z',
          neto: 50,
          iva: 10.5,
          total: 60.5,
          motivo: 'Noche no usada',
          factura: {
            numero: 'FAC-1',
            numero_fiscal: '00003-00000001',
            cuit_receptor: null,
            condicion_iva_receptor: 'consumidor_final',
            reserva,
          },
        },
      ],
    }

    const { res, texto } = await exportar('facturas', '?mes=2026-09')
    expect(res.headers.get('Content-Disposition')).toContain('libro-ventas-2026-09.csv')
    expect(metodos('facturas', 'gte')).toEqual([['emitida_en', '2026-09-01T00:00:00-03:00']])
    expect(metodos('facturas', 'lt')).toEqual([['emitida_en', '2026-10-01T00:00:00-03:00']])

    const [encabezado, factura, nota] = texto.split('\r\n')
    expect(encabezado).toContain('Neto gravado;Exento;Alícuota IVA %;IVA;Total')
    expect(factura).toContain(';100,00;0,00;21,00;21,00;121,00;')
    expect(nota).toContain('Nota de crédito')
    expect(nota).toContain(';-50,00;0,00;21,00;-10,50;-60,50;')
  })
})
