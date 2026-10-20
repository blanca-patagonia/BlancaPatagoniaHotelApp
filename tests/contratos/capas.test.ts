import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * Contrato de arquitectura: las capas de `src/` se respetan.
 *
 * La estructura de carpetas (ver `ESTRUCTURA.md`) separa el front del huésped,
 * el front del staff, los endpoints y la lógica. Una carpeta no impide nada por
 * sí sola: un import de más y la separación queda solo en el dibujo. Este test
 * lee los imports de cada archivo y falla cuando una dependencia va en la
 * dirección prohibida, así la regla se sostiene sola a medida que el sistema
 * crece.
 *
 * Reglas:
 *  1. `src/lib/` nunca importa de `src/app/` (la lógica no conoce pantallas).
 *  2. `src/lib/domain/` es puro: solo importa de sí mismo y de `lib/fechas`.
 *     Nada de base de datos, framework ni paquetes externos.
 *  3. `(back-api)` no importa de ningún grupo de front.
 *  4. Entre los dos grupos de front, solo los cruces declarados abajo, cada uno
 *     con su motivo.
 */

const RAIZ = process.cwd()
const SRC = join(RAIZ, 'src')

/**
 * Cruces permitidos entre `(front-publico)` y `(front-gestion)`.
 * Clave: `archivo que importa → archivo importado`, relativos a `src/app/`.
 */
const CRUCES_PERMITIDOS: Record<string, string> = {
  '(front-gestion)/login/loading.tsx → (front-publico)/_publico/esqueleto.tsx':
    'El login tiene la estética del sitio público: usa su mismo esqueleto de carga.',
  '(front-publico)/portal/[token]/page.tsx → (front-gestion)/panel/_components/subir-foto.tsx':
    'El portal de socios es una pantalla de trabajo y reutiliza el kit del panel.',
  '(front-publico)/portal/[token]/page.tsx → (front-gestion)/panel/_components/foto-adjunta.tsx':
    'Ídem: mismo componente de foto adjunta que ve el staff.',
  '(front-publico)/portal/[token]/page.tsx → (front-gestion)/panel/_components/boton-envio.tsx':
    'Ídem: el botón que bloquea el doble envío.',
  '(front-publico)/reservar/factura/[token]/page.tsx → (front-gestion)/panel/reservas/[id]/factura/boton-imprimir.tsx':
    'El huésped imprime su factura con el mismo botón que usa recepción.',
}

function fuentes(dir: string): string[] {
  const salida: string[] = []
  for (const entrada of readdirSync(dir)) {
    const completo = join(dir, entrada)
    if (statSync(completo).isDirectory()) salida.push(...fuentes(completo))
    else if (/\.(ts|tsx|mts)$/.test(entrada)) salida.push(completo)
  }
  return salida
}

/** Especificadores de `import … from`, `export … from` e `import()`. */
function especificadores(codigo: string): string[] {
  const patrones = [
    /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  return patrones.flatMap((p) => [...codigo.matchAll(p)].map((m) => m[1]))
}

/** Ruta absoluta (sin extensión resuelta) de un import interno, o null si es un paquete. */
function resolver(desde: string, espec: string): string | null {
  if (espec.startsWith('@/')) return join(SRC, espec.slice(2))
  if (espec.startsWith('.')) return resolve(dirname(desde), espec)
  return null
}

/** Busca el archivo real detrás de un import sin extensión. */
function archivoReal(base: string): string {
  for (const sufijo of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    try {
      if (statSync(base + sufijo).isFile()) return base + sufijo
    } catch {
      // no existe con este sufijo: se prueba el siguiente
    }
  }
  return base
}

function grupo(ruta: string): string | null {
  const m = relative(join(SRC, 'app'), ruta).match(/^\(([^)]+)\)/)
  return m ? m[1] : null
}

const ARCHIVOS = fuentes(SRC)
const IMPORTS = ARCHIVOS.flatMap((archivo) =>
  especificadores(readFileSync(archivo, 'utf8')).map((espec) => ({
    archivo,
    espec,
    destino: resolver(archivo, espec),
  })),
)

const rel = (ruta: string) => relative(RAIZ, ruta)

describe('contrato: las capas de src/ se respetan', () => {
  it('encuentra los archivos y los imports (si no, el test no estaría mirando nada)', () => {
    expect(ARCHIVOS.length).toBeGreaterThan(300)
    expect(IMPORTS.length).toBeGreaterThan(1000)
  })

  it('src/lib nunca importa de src/app', () => {
    const lib = join(SRC, 'lib')
    const app = join(SRC, 'app')
    const violaciones = IMPORTS.filter(
      (i) => i.archivo.startsWith(lib) && i.destino?.startsWith(app),
    ).map((i) => `${rel(i.archivo)} → ${i.espec}`)

    expect(violaciones, 'La lógica no puede depender de una pantalla').toEqual([])
  })

  it('src/lib/domain es puro: solo importa de sí mismo y de lib/fechas', () => {
    const dominio = join(SRC, 'lib', 'domain')
    const fechas = join(SRC, 'lib', 'fechas')
    const violaciones = IMPORTS.filter((i) => i.archivo.startsWith(dominio))
      .filter((i) => {
        // Un paquete (incluido `node:`) es siempre una violación.
        if (i.destino === null) return true
        return !i.destino.startsWith(dominio) && i.destino !== fechas
      })
      .map((i) => `${rel(i.archivo)} → ${i.espec}`)

    expect(
      violaciones,
      'Las reglas de negocio no importan base de datos, framework ni paquetes: así se testean sin nada',
    ).toEqual([])
  })

  it('(back-api) no importa de ningún grupo de front', () => {
    const violaciones = IMPORTS.filter((i) => {
      if (grupo(i.archivo) !== 'back-api' || !i.destino) return false
      return grupo(i.destino)?.startsWith('front') ?? false
    }).map((i) => `${rel(i.archivo)} → ${i.espec}`)

    expect(violaciones, 'Un endpoint no depende de una pantalla: lo compartido va a src/lib').toEqual(
      [],
    )
  })

  it('entre los dos fronts solo hay cruces declarados', () => {
    const app = join(SRC, 'app')
    const cruces = IMPORTS.filter((i) => {
      if (!i.destino) return false
      const origen = grupo(i.archivo)
      const destino = grupo(i.destino)
      return origen?.startsWith('front') && destino?.startsWith('front') && origen !== destino
    }).map((i) => `${relative(app, i.archivo)} → ${relative(app, archivoReal(i.destino!))}`)

    const sinDeclarar = cruces.filter((c) => !(c in CRUCES_PERMITIDOS))
    expect(
      sinDeclarar,
      'Cruce nuevo entre fronts: si es legítimo, declaralo en CRUCES_PERMITIDOS con su motivo; ' +
        'si lo usan los dos fronts por igual, quizás corresponde moverlo',
    ).toEqual([])
  })

  it('cada cruce declarado sigue existiendo y tiene motivo', () => {
    const app = join(SRC, 'app')
    const vigentes = new Set(
      IMPORTS.filter((i) => i.destino).map(
        (i) => `${relative(app, i.archivo)} → ${relative(app, archivoReal(i.destino!))}`,
      ),
    )
    for (const [cruce, motivo] of Object.entries(CRUCES_PERMITIDOS)) {
      expect(vigentes.has(cruce), `cruce declarado que ya no existe: ${cruce}`).toBe(true)
      expect(motivo.length, cruce).toBeGreaterThan(20)
    }
  })
})
