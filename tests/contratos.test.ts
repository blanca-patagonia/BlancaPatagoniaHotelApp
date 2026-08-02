import { describe, it, expect } from 'vitest'
import {
  ESTADOS_CONTRATO,
  TRANSICIONES_CONTRATO,
  transicionesPosibles,
  puedeTransicionar,
  esEstadoFinal,
  vencidoPorFecha,
  motivoNoFirmable,
  puedeFirmar,
  puedeEnviar,
  estaVigente,
  type EstadoContrato,
} from '@/lib/domain/contratos'

const HOY = '2026-08-02'

describe('máquina de estados del contrato', () => {
  it('define transiciones para todos los estados', () => {
    for (const e of ESTADOS_CONTRATO) {
      expect(TRANSICIONES_CONTRATO[e]).toBeDefined()
    }
  })

  it('el borrador solo puede enviarse', () => {
    expect(transicionesPosibles('borrador')).toEqual(['enviado'])
  })

  it('un contrato enviado puede firmarse, rechazarse o vencer', () => {
    expect(puedeTransicionar('enviado', 'firmado')).toBe(true)
    expect(puedeTransicionar('enviado', 'rechazado')).toBe(true)
    expect(puedeTransicionar('enviado', 'vencido')).toBe(true)
  })

  it('firmado y vencido son estados finales', () => {
    expect(esEstadoFinal('firmado')).toBe(true)
    expect(esEstadoFinal('vencido')).toBe(true)
    expect(esEstadoFinal('borrador')).toBe(false)
  })

  it('un contrato rechazado vuelve a borrador para corregirse', () => {
    expect(puedeTransicionar('rechazado', 'borrador')).toBe(true)
    expect(puedeTransicionar('rechazado', 'firmado')).toBe(false)
  })

  it('no se puede saltear el envío', () => {
    expect(puedeTransicionar('borrador', 'firmado')).toBe(false)
  })
})

describe('reenvío', () => {
  it('solo se envía desde borrador', () => {
    expect(puedeEnviar('borrador')).toBe(true)
  })

  it('NO se puede reenviar un contrato ya firmado', () => {
    expect(puedeEnviar('firmado')).toBe(false)
  })

  it('tampoco se reenvía uno enviado o vencido', () => {
    expect(puedeEnviar('enviado')).toBe(false)
    expect(puedeEnviar('vencido')).toBe(false)
  })
})

describe('vencimiento por calendario', () => {
  it('sin fecha de fin no vence', () => {
    expect(vencidoPorFecha(null, HOY)).toBe(false)
    expect(vencidoPorFecha(undefined, HOY)).toBe(false)
  })

  it('el último día de vigencia todavía es válido', () => {
    expect(vencidoPorFecha(HOY, HOY)).toBe(false)
  })

  it('el día siguiente al fin ya está vencido', () => {
    expect(vencidoPorFecha('2026-08-01', HOY)).toBe(true)
  })
})

describe('reglas de firma', () => {
  it('un contrato enviado y vigente se puede firmar', () => {
    expect(motivoNoFirmable({ estado: 'enviado', vigencia_hasta: '2026-12-31' }, HOY)).toBeNull()
    expect(puedeFirmar({ estado: 'enviado', vigencia_hasta: null }, HOY)).toBe(true)
  })

  it('NO se puede firmar un contrato vencido', () => {
    expect(motivoNoFirmable({ estado: 'vencido' }, HOY)).toBe('vencido')
  })

  it('NO se puede firmar uno enviado cuya vigencia ya pasó', () => {
    // Aunque nadie haya corrido todavía el proceso que lo marca como vencido.
    expect(motivoNoFirmable({ estado: 'enviado', vigencia_hasta: '2026-07-31' }, HOY)).toBe('vencido')
  })

  it('NO se puede firmar dos veces', () => {
    expect(motivoNoFirmable({ estado: 'firmado' }, HOY)).toBe('ya_firmado')
  })

  it('NO se puede firmar uno rechazado', () => {
    expect(motivoNoFirmable({ estado: 'rechazado' }, HOY)).toBe('rechazado')
  })

  it('NO se puede firmar un borrador que nunca se envió', () => {
    expect(motivoNoFirmable({ estado: 'borrador' }, HOY)).toBe('no_enviado')
  })

  it('cada estado no firmable informa un motivo', () => {
    const noFirmables: EstadoContrato[] = ['borrador', 'firmado', 'rechazado', 'vencido']
    for (const estado of noFirmables) {
      expect(motivoNoFirmable({ estado }, HOY)).not.toBeNull()
    }
  })
})

describe('vigencia de un convenio', () => {
  it('solo un contrato firmado está vigente', () => {
    expect(estaVigente({ estado: 'enviado', vigencia_hasta: '2026-12-31' }, HOY)).toBe(false)
    expect(estaVigente({ estado: 'firmado', vigencia_hasta: '2026-12-31' }, HOY)).toBe(true)
  })

  it('no está vigente antes de que empiece', () => {
    expect(estaVigente({ estado: 'firmado', vigencia_desde: '2026-09-01' }, HOY)).toBe(false)
  })

  it('no está vigente después de terminar', () => {
    expect(estaVigente({ estado: 'firmado', vigencia_hasta: '2026-07-01' }, HOY)).toBe(false)
  })

  it('un contrato firmado sin fechas se considera vigente', () => {
    expect(estaVigente({ estado: 'firmado' }, HOY)).toBe(true)
  })
})
