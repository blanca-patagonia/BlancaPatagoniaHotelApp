import { describe, it, expect } from 'vitest'
import { LIMITES, mensajeLimite, type AccionLimitada } from '@/lib/domain/limites'

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
    for (const a of ['ical', 'webhook_pago', 'login'] as AccionLimitada[]) {
      expect(LIMITES.reserva_publica.maximo).toBeLessThan(LIMITES[a].maximo)
    }
  })

  it('el feed iCal tolera a las tres OTAs sondeando todos los tipos cada hora', () => {
    // 11 tipos de unidad × 3 canales = 33 lecturas legítimas por hora. Un techo
    // por debajo de eso cortaría la sincronización, que es el daño que el feed
    // viene a evitar.
    expect(LIMITES.ical.maximo).toBeGreaterThan(33)
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
