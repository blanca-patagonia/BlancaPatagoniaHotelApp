import { describe, it, expect, afterEach, vi } from 'vitest'
import { seleccionarProveedor } from '@/lib/integraciones/seleccion'

/**
 * La selección de proveedor es la guarda que impide que un simulador quede
 * activo en producción por descuido. Lo que se prueba acá no es un detalle de
 * implementación: es que un despliegue mal configurado FALLE en vez de emitir
 * un CAE inventado o dar por enviado un correo que nunca salió.
 */

const real = { nombre: 'real', esReal: () => true }
const simulado = { nombre: 'simulado', esReal: () => false }
const PROVEEDORES = { real, simulado }

function elegir(valor?: string) {
  return seleccionarProveedor({
    variable: 'X_PROVIDER',
    proveedores: PROVEEDORES,
    simulado: 'simulado',
    valor,
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('seleccionarProveedor fuera de producción', () => {
  it('cae al simulador cuando no hay nada configurado', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(elegir()).toBe(simulado)
  })

  it('cae al simulador cuando el nombre no existe, sin romper el desarrollo', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(elegir('inexistente')).toBe(simulado)
  })

  it('respeta el proveedor real si está configurado', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(elegir('real')).toBe(real)
  })
})

describe('seleccionarProveedor en producción', () => {
  it('falla si falta la variable, en vez de usar el simulador en silencio', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => elegir()).toThrow(/Falta X_PROVIDER/)
  })

  it('el mensaje del fallo dice qué variable definir y con qué valores', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => elegir()).toThrow(/real, simulado/)
  })

  it('falla ante un error de tipeo en vez de degradar al simulador', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => elegir('reall')).toThrow(/no corresponde a ningún proveedor conocido/)
  })

  it('usa el proveedor real cuando está bien configurado', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(elegir('real')).toBe(real)
  })

  it('permite el simulador solo si se lo declara explícitamente', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(elegir('simulado')).toBe(simulado)
  })

  it('ignora los espacios alrededor del valor', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(elegir('  real  ')).toBe(real)
  })

  it('trata una variable vacía como ausente', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => elegir('   ')).toThrow(/Falta X_PROVIDER/)
  })
})
