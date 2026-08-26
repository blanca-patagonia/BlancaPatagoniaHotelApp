import { AREAS, ETIQUETAS_AREA, puedeAcceder, type Area } from './permisos'
import { RUTA_AREA } from './navegacion'
import { CAPITULOS, GLOSARIO } from './ayuda'
import type { Rol } from './roles'

/**
 * Búsqueda global del panel.
 *
 * Nace de una necesidad concreta de recepción: alguien llama preguntando por su
 * reserva y hay que encontrarlo **mientras está al teléfono**, sin adivinar si
 * está cargado como huésped, como reserva o como cuenta de agencia.
 *
 * La regla que vive acá es de qué se puede buscar según el rol. No alcanza con
 * que la pantalla no muestre un módulo: si el buscador consultara todo, alguien
 * de housekeeping podría escribir el apellido de un huésped y ver datos que su
 * menú no le ofrece. Se apoya en los **mismos permisos** que arman la
 * navegación, en lugar de mantener una segunda lista.
 *
 * La seguridad real sigue siendo de la base (RLS): esto evita pedir lo que no
 * corresponde, no es lo que impide leerlo.
 */

/** Qué tipos de cosa sabe buscar el sistema. */
export const AMBITOS = ['reservas', 'huespedes', 'agencias', 'proveedores'] as const

export type Ambito = (typeof AMBITOS)[number]

/** Área del panel a la que pertenece cada ámbito, para resolver el permiso. */
const AREA_DEL_AMBITO: Record<Ambito, Area> = {
  reservas: 'reservas',
  huespedes: 'huespedes',
  agencias: 'agencias',
  proveedores: 'proveedores',
}

export const ETIQUETAS_AMBITO: Record<Ambito, string> = {
  reservas: 'Reservas',
  huespedes: 'Huéspedes',
  agencias: 'Agencias y empresas',
  proveedores: 'Proveedores',
}

/** Ámbitos que un rol tiene permitido buscar. */
export function ambitosPara(rol: Rol): Ambito[] {
  return AMBITOS.filter((a) => puedeAcceder(rol, AREA_DEL_AMBITO[a]))
}

/** ¿Ese rol puede buscar en ese ámbito? */
export function puedeBuscar(rol: Rol, ambito: Ambito): boolean {
  return puedeAcceder(rol, AREA_DEL_AMBITO[ambito])
}

/**
 * Normaliza lo que se escribió en la caja.
 *
 * Devuelve `null` cuando no vale la pena consultar: vacío, o tan corto que
 * traería medio sistema. Dos caracteres es el mínimo para que «Ru» encuentre a
 * Ruiz sin devolver todo.
 */
export function terminoBuscado(q: string | undefined): string | null {
  const limpio = (q ?? '').trim()
  if (limpio.length < 2) return null
  // Los comodines de PostgREST se escapan: sin esto, buscar «%» lista todo.
  return limpio.replace(/[%_]/g, (c) => `\\${c}`)
}

/* ─────────────────────────── secciones del sistema ─────────────────────────── */

/**
 * Además de datos, el buscador encuentra **partes del sistema**.
 *
 * ── Por qué buscar sobre la Ayuda y no solo sobre el nombre del módulo ──────
 *
 * Buscar por nombre parece lo obvio y sirve poco: quien no encuentra algo casi
 * nunca conoce cómo se llama el módulo. Escribe lo que quiere HACER —«factura»,
 * «cobrar la seña», «mucama», «overbooking»—, y ninguna de esas palabras es el
 * título de una sección.
 *
 * La Ayuda ya tiene eso escrito: cada capítulo explica su módulo en castellano
 * llano, paso por paso. Buscar ahí adentro convierte el buscador en «¿dónde se
 * hace esto?», que es la pregunta real. Y no hay que mantener un diccionario de
 * sinónimos aparte: mejorar la Ayuda mejora el buscador solo.
 *
 * Se filtra por rol con `puedeAcceder`, igual que el menú: nadie ve el atajo a
 * una sección a la que no puede entrar.
 */

/** Quita mayúsculas y acentos: quien busca «ocupacion» tiene que encontrar «Ocupación». */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export interface SeccionEncontrada {
  area: Area
  titulo: string
  /** El resumen del capítulo de Ayuda, para que se entienda qué hay adentro. */
  descripcion: string
  href: string
  /**
   * Por qué apareció. Se muestra en pantalla: si alguien busca «factura» y le
   * aparece «Reservas», sin esta línea parece un resultado equivocado.
   */
  motivo: string
  /** Coincidió el nombre del módulo (más relevante) o su contenido. */
  porNombre: boolean
}

/**
 * Secciones del panel que coinciden con lo buscado.
 *
 * Ordena por nombre primero: si alguien escribe «reservas», el módulo Reservas
 * tiene que estar arriba de los capítulos que lo mencionan al pasar.
 */
export function seccionesQueCoinciden(rol: Rol, termino: string): SeccionEncontrada[] {
  const q = normalizar(termino)
  if (q.length < 2) return []

  const encontradas: SeccionEncontrada[] = []

  for (const area of AREAS) {
    if (!puedeAcceder(rol, area)) continue

    const titulo = ETIQUETAS_AREA[area]
    const capitulo = CAPITULOS.find((c) => c.area === area)
    const porNombre = normalizar(titulo).includes(q)

    // Qué paso del capítulo hizo la coincidencia: es lo que se le muestra.
    /*
      Se busca en el RESUMEN y en el TÍTULO de cada paso, no en el cuerpo del
      paso. Probado con el cuerpo incluido: «factura» devolvía cinco secciones,
      entre ellas Usuarios («Elegir el rol») y Respaldos («Lo que sí podés
      hacer»), porque la palabra aparecía de refilón en una explicación. Un
      resultado que no se entiende es peor que uno menos: obliga a leerlos todos
      para descartar.

      Los títulos están escritos como acciones —«Check-out y factura», «Cargar una
      factura»—, así que son justamente la parte que responde «¿dónde se hace
      esto?». El cuerpo del paso es contexto, y como texto de búsqueda es ruido.
    */
    let motivo = ''
    if (!porNombre && capitulo) {
      if (normalizar(capitulo.resumen).includes(q)) {
        motivo = capitulo.resumen
      } else {
        const paso = capitulo.pasos.find((p) => normalizar(p.titulo).includes(q))
        if (paso) motivo = paso.titulo
      }
    }

    if (!porNombre && !motivo) continue

    encontradas.push({
      area,
      titulo,
      descripcion: capitulo?.resumen ?? '',
      href: RUTA_AREA[area],
      motivo: porNombre ? '' : motivo,
      porNombre,
    })
  }

  // Primero las que coincidieron por nombre; dentro de cada grupo, el orden de
  // `AREAS`, que es el mismo del menú.
  return [...encontradas].sort((a, b) => Number(b.porNombre) - Number(a.porNombre))
}

export interface TerminoEncontrado {
  termino: string
  definicion: string
  href: string
}

/**
 * Palabras del glosario que coinciden.
 *
 * «Tarifa rack», «ADR», «RevPAR», «folio» son términos del oficio que alguien
 * nuevo lee en una pantalla y no entiende. Que el buscador los explique evita
 * el rodeo de ir a la Ayuda y buscar a mano dentro de una página larga.
 */
export function terminosQueCoinciden(termino: string): TerminoEncontrado[] {
  const q = normalizar(termino)
  if (q.length < 2) return []
  return GLOSARIO.filter(
    (t) => normalizar(t.termino).includes(q) || normalizar(t.definicion).includes(q),
  ).map((t) => ({ termino: t.termino, definicion: t.definicion, href: '/panel/ayuda#glosario' }))
}
