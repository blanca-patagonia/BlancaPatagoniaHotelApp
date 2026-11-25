import { describe, it, expect } from 'vitest'
import { LIMITES, claveDeIp, mensajeLimite, type AccionLimitada } from '@/lib/domain/limites'

/**
 * El límite de tasa es un control de seguridad y era el único módulo del dominio
 * sin tests. Lo que se fija acá no son los números —el hotel puede querer
 * ajustarlos— sino las **propiedades que no pueden romperse** al ajustarlos.
 */

const ACCIONES = Object.keys(LIMITES) as AccionLimitada[]

describe('configuración de los límites', () => {
  it('todo límite es aplicable: máximo y ventana positivos', () => {
    // Un `maximo: 0` bloquearía la acción para todo el mundo, y un `minutos: 0`
    // haría que la ventana no exista. Las dos formas de romperlo son silenciosas.
    for (const a of ACCIONES) {
      expect(LIMITES[a].maximo, `maximo de ${a}`).toBeGreaterThan(0)
      expect(LIMITES[a].minutos, `minutos de ${a}`).toBeGreaterThan(0)
      expect(Number.isInteger(LIMITES[a].maximo), `maximo de ${a} entero`).toBe(true)
    }
  })

  it('todo límite explica qué protege', () => {
    // El módulo se fija a sí mismo la regla: «un límite sin justificación se
    // termina ajustando a ojo cuando alguien se queja, y ahí deja de proteger».
    for (const a of ACCIONES) {
      expect(LIMITES[a].motivo.trim().length, `motivo de ${a}`).toBeGreaterThan(20)
    }
  })

  it('recuperar contraseña es más estricto que el login', () => {
    // Decisión documentada: teclear mal la contraseña diez veces es normal;
    // pedir el enlace de recuperación tres veces en una hora ya es raro, y sin
    // ese techo el formulario sirve para enumerar cuentas del staff.
    expect(LIMITES.recuperar_password.maximo).toBeLessThan(LIMITES.login.maximo)
  })

  it('la reserva pública es el límite más ajustado de las entradas de escritura', () => {
    // Cada reserva pendiente bloquea una unidad por 5 días y el hotel tiene 15:
    // es la acción donde un script hace daño real más rápido.
    for (const a of ['webhook_pago', 'login'] as AccionLimitada[]) {
      expect(LIMITES.reserva_publica.maximo).toBeLessThan(LIMITES[a].maximo)
    }
  })
})

describe('mensaje al visitante', () => {
  it('no revela el máximo de intentos', () => {
    // Decir «te quedan 2 de 5» le da a quien sondea el número exacto contra el
    // que calibrar. El módulo declara esta propiedad; acá queda fijada.
    for (const a of ACCIONES) {
      expect(mensajeLimite(a), `mensaje de ${a}`).not.toContain(String(LIMITES[a].maximo))
    }
  })

  it('el del login no menciona la ventana, para no dar el reloj del ataque', () => {
    expect(mensajeLimite('login')).not.toContain(String(LIMITES.login.minutos))
    expect(mensajeLimite('login')).toMatch(/unos minutos/i)
  })

  it('los demás sí dicen cuándo volver, y ofrecen una salida humana', () => {
    // Quien reserva de verdad y choca con el límite no puede quedar sin camino:
    // el teléfono del hotel es esa salida.
    const m = mensajeLimite('reserva_publica')
    expect(m).toContain(String(LIMITES.reserva_publica.minutos))
    expect(m).toMatch(/escribinos|teléfono/i)
  })

  it('ninguna acción se queda sin mensaje', () => {
    for (const a of ACCIONES) {
      expect(mensajeLimite(a).trim().length, `mensaje de ${a}`).toBeGreaterThan(20)
    }
  })
})

describe('claveDeIp · una IPv6 se cuenta por su /64', () => {
  it('una IPv4 se cuenta entera', () => {
    expect(claveDeIp('200.45.10.7')).toBe('200.45.10.7')
  })

  it('dos direcciones del mismo /64 dan la misma clave (no se evade rotando)', () => {
    expect(claveDeIp('2001:db8:aaaa:bbbb:1:2:3:4')).toBe(claveDeIp('2001:db8:aaaa:bbbb:ffff:eeee:dddd:cccc'))
    expect(claveDeIp('2001:db8:aaaa:bbbb:1:2:3:4')).toBe('2001:db8:aaaa:bbbb::')
  })

  it('un /64 distinto da otra clave', () => {
    expect(claveDeIp('2001:db8:aaaa:bbbc::1')).not.toBe(claveDeIp('2001:db8:aaaa:bbbb::1'))
  })

  it('expande la forma abreviada con ::', () => {
    expect(claveDeIp('2001:db8::1')).toBe('2001:db8:0:0::')
    expect(claveDeIp('::1')).toBe('0:0:0:0::')
  })

  it('una IPv4 mapeada vuelve a ser la IPv4', () => {
    expect(claveDeIp('::ffff:200.45.10.7')).toBe('200.45.10.7')
  })

  it('lo que no parece una IP se devuelve tal cual', () => {
    expect(claveDeIp('no-es-una-ip')).toBe('no-es-una-ip')
  })
})
