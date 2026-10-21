import { describe, it, expect } from 'vitest'
import { fuentesDeExtracto, ProveedorExtractoArchivo } from '@/lib/conciliacion'
import { ProveedorMercadoPagoReportes } from '@/lib/conciliacion/mercadopago-reportes'

/**
 * El puerto `ExtractoProvider` (ADR 0030).
 *
 * Lo que se fija acá es la parte que el resto del sistema mira para decidir qué
 * mostrar: **una fuente declara lo que puede y lo que no**, en vez de dejar que
 * la pantalla lo suponga.
 */

describe('el proveedor de extracto por archivo', () => {
  const p = new ProveedorExtractoArchivo()

  it('declara que NO puede consultar solo', async () => {
    /*
      Santander Argentina no publica una API de movimientos para clientes, y el
      sistema no raspa el home banking con las credenciales del hotel.

      Lo importante es que eso se **declare** y no se descubra: si la pantalla
      supusiera que se actualiza sola, el día que falte un movimiento nadie sabría
      si falló una conexión o si nadie subió el archivo.
    */
    expect(p.capacidades().puedeConsultar).toBe(false)
    expect(p.capacidades().aceptaArchivo).toBe(true)
  })

  it('«no puedo» no es lo mismo que «fallé»', async () => {
    // Misma distinción que `ResultadoEnvio.noSoportado` en canales (ADR 0021).
    // Sin ella la pantalla mostraría un error rojo permanente sobre algo que
    // funciona exactamente como tiene que funcionar.
    const r = await p.consultar()

    expect(r.ok).toBe(false)
    expect(r.noSoportado, 'sin esta bandera, «el banco no tiene API» se lee como una caída').toBe(
      true,
    )
    expect(r.movimientos).toHaveLength(0)
  })

  it('no es un simulador: no inventa movimientos', () => {
    // Los datos que entran por acá son los del extracto real del hotel. Lo que no
    // hay es conexión, y eso ya lo dice `capacidades()`.
    expect(p.esReal()).toBe(true)
  })

  it('explica en español cómo llegan los datos', () => {
    expect(p.capacidades().comoLlegan).toBeTruthy()
  })
})

describe('qué fuentes ofrece el sistema', () => {
  it('el archivo del banco está siempre', () => {
    const fuentes = fuentesDeExtracto()
    expect(fuentes.map((f) => f.origen)).toEqual(['banco'])
  })

  it('MercadoPago se suma cuando hay credencial', () => {
    /*
      No hay una variable que elija ENTRE las fuentes, y es deliberado: el hotel
      tiene una cuenta en el banco y otra en MercadoPago, y la conciliación
      necesita las dos para cerrar. Es la misma situación que `PAGO_PROVIDER`,
      que por eso es plural.
    */
    const fuentes = fuentesDeExtracto([new ProveedorMercadoPagoReportes('token-de-prueba')])

    expect(fuentes.map((f) => f.origen)).toEqual(['banco', 'mercadopago'])
    expect(fuentes[1].capacidades().puedeConsultar, 'MercadoPago sí tiene API pública').toBe(true)
  })

  it('cada fuente declara su origen, y son los que la base admite', () => {
    // Si un proveedor declarara un origen fuera del `check` de la 0077, sus
    // movimientos serían rechazados por la base al importarlos.
    const origenes = fuentesDeExtracto([
      new ProveedorMercadoPagoReportes('t'),
    ]).map((f) => f.origen)

    for (const o of origenes) expect(['banco', 'mercadopago', 'stripe']).toContain(o)
  })
})
