/**
 * Catálogo público de alojamientos (lógica pura).
 *
 * Qué resuelve: quien entra a mirar todavía no eligió fechas. El buscador de
 * `/reservar` exige un período antes de mostrar nada, así que alguien que solo
 * quiere saber *qué ofrece el hotel* no tenía dónde hacerlo. En las OTAs sí
 * puede, y el objetivo del portal propio es competir con eso.
 *
 * De dónde sale el contenido: de la base. `tipos_unidad` ya guarda `descripcion`
 * y `amenities`, así que el catálogo no duplica textos en el código; si el hotel
 * corrige una descripción desde el panel, cambia también acá.
 */

import type { CategoriaUnidad } from './unidades'
import { sumarDias, formatoFechaCorta } from '@/lib/fechas'

/** Un tipo de alojamiento, tal como lo ve el público. */
export interface TipoCatalogo {
  id: string
  codigo: string
  nombre: string
  categoria: CategoriaUnidad
  capacidadMax: number
  descripcion: string
  amenities: string[]
}

/** Precio de una temporada para un tipo, con su ventana de fechas. */
export interface PrecioTemporada {
  temporada: string
  nombre: string
  orden: number
  precio: number
  /** Rangos de fecha de la temporada, ya formateados para leer. */
  rangos: string[]
}

/* ------------------------------------------------------------- filtros -- */

/** Opciones del filtro por categoría. `todas` es el estado inicial. */
export const FILTROS_CATEGORIA = ['todas', 'hosteria', 'cabana'] as const
export type FiltroCategoria = (typeof FILTROS_CATEGORIA)[number]

export const ETIQUETAS_FILTRO: Record<FiltroCategoria, string> = {
  todas: 'Todos',
  hosteria: 'Hostería',
  cabana: 'Cabañas',
}

/**
 * Normaliza el parámetro de la URL.
 *
 * Cualquier valor inesperado cae en `todas` en vez de dejar la pantalla vacía:
 * un enlace viejo o mal copiado tiene que mostrar el catálogo, no un error.
 */
export function filtroValido(crudo: string | undefined): FiltroCategoria {
  return (FILTROS_CATEGORIA as readonly string[]).includes(crudo ?? '')
    ? (crudo as FiltroCategoria)
    : 'todas'
}

export function filtrarPorCategoria(
  tipos: readonly TipoCatalogo[],
  filtro: FiltroCategoria,
): TipoCatalogo[] {
  return filtro === 'todas' ? [...tipos] : tipos.filter((t) => t.categoria === filtro)
}

/**
 * Orden de presentación: primero la hostería, después las cabañas, y dentro de
 * cada grupo de menor a mayor capacidad.
 *
 * Es el orden en que se pregunta por teléfono —«¿para cuántos?»— y hace que la
 * grilla crezca de a poco en vez de saltar entre una single y una cabaña de 7.
 */
export function ordenarCatalogo(tipos: readonly TipoCatalogo[]): TipoCatalogo[] {
  const peso: Record<CategoriaUnidad, number> = { hosteria: 0, cabana: 1 }
  return [...tipos].sort(
    (a, b) =>
      peso[a.categoria] - peso[b.categoria] ||
      a.capacidadMax - b.capacidadMax ||
      a.nombre.localeCompare(b.nombre, 'es'),
  )
}

/* ------------------------------------------------------------- precios -- */

/**
 * Precio por noche **con IVA**, que es el único que se le puede publicar a un
 * huésped.
 *
 * ⚠️ `tarifas.precio_rack` se guarda **sin IVA** (ADR 0004: el IVA se discrimina
 * y se calcula en el dominio, no se almacena sumado). Mostrar la columna cruda en
 * el catálogo publicaría un precio más bajo que el que después cobra el checkout
 * —que sí lo suma vía `calcularEstadia`—, y esa diferencia se descubre recién al
 * momento de pagar. Es la clase de detalle que genera un reclamo en el mostrador
 * y una reseña mala.
 *
 * Se redondea a dos decimales igual que el motor de precios, para que el «desde»
 * del catálogo y el total de la reserva no difieran por un centavo.
 */
export function conIva(precio: number, ivaPct: number): number {
  const pct = Number.isFinite(ivaPct) ? ivaPct : 0
  return Math.round((precio * (1 + pct / 100) + Number.EPSILON) * 100) / 100
}

/**
 * Precio más bajo de todas las temporadas cargadas, para el «desde».
 *
 * Devuelve `null` cuando no hay ninguna tarifa: la pantalla dice «consultar» en
 * lugar de mostrar «USD 0», que fue exactamente el bug de la Fase 18.
 */
export function precioDesde(precios: readonly { precio: number }[]): number | null {
  const validos = precios.map((p) => p.precio).filter((p) => Number.isFinite(p) && p > 0)
  return validos.length ? Math.min(...validos) : null
}

/** Temporadas ordenadas como las piensa el hotel: baja, media, alta. */
export function ordenarPrecios(precios: readonly PrecioTemporada[]): PrecioTemporada[] {
  return [...precios].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'))
}

/* -------------------------------------------------------------- textos -- */

/** «hasta 3 personas» / «1 persona». El singular importa: se lee, no se escanea. */
export function textoCapacidad(capacidadMax: number): string {
  return capacidadMax === 1 ? '1 persona' : `hasta ${capacidadMax} personas`
}

/**
 * Texto de un rango de temporada, para mostrarle al huésped.
 *
 * ⚠️ El rango de Postgres es `[desde, hasta)`: **el fin está excluido**. Volcarlo
 * tal cual diría que la temporada alta va «01/11 al 01/12», cuando la última
 * noche que se cobra a ese precio es el **30/11** y el 1 de diciembre ya es
 * media. No es un detalle de formato: es un precio equivocado publicado en el
 * sitio, y el reclamo llega en el mostrador.
 *
 * Se resta un día para que la fecha que se lee sea la última noche real.
 */
export function textoRango(desde: string, hasta: string): string {
  const ultimaNoche = sumarDias(hasta, -1)
  // Un rango de un solo día quedaría como «05/04 al 05/04»: se dice una vez.
  return ultimaNoche <= desde
    ? formatoFechaCorta(desde)
    : `${formatoFechaCorta(desde)} al ${formatoFechaCorta(ultimaNoche)}`
}

/* --------------------------------------------------------------- fotos -- */

/**
 * Foto de portada por código de tipo.
 *
 * ⚠️ **Las imágenes cargadas son de MUESTRA, no son del Hotel Blanca Patagonia.**
 * Salen de Pexels (licencia libre, uso comercial permitido y sin atribución
 * obligatoria) y se eligieron una por una para que el ambiente sea verosímil:
 * hostería de montaña con vista al lago, cabañas de madera con hogar a leña e
 * hidromasaje. Se descartaron las que mostraban ciudades, decoración tropical o
 * la marca de otro hotel a la vista.
 *
 * Están para que el portal se pueda mostrar y defender con el aspecto que va a
 * tener en uso —los patrones de tarjeta, galería y portada solo funcionan con
 * imagen—, no para hacerlas pasar por fotos del hotel. **Antes de cualquier
 * puesta en producción hay que reemplazarlas por las reales**, y alcanza con
 * pisar los archivos de `public/alojamientos/` conservando los nombres: no hay
 * que tocar este mapa.
 *
 * Si un código no tiene entrada, `PortadaAlojamiento` dibuja la cabecera de
 * marca —degradé y silueta— que se diseñó para que la ausencia de foto se lea
 * como una decisión y no como una imagen rota.
 *
 * Recomendado para las reales: JPG de ~1400 px de ancho, por debajo de 300 kB.
 */
export const FOTOS: Readonly<Partial<Record<string, string>>> = {
  'HOST-SINGLE': '/alojamientos/single.jpg',
  'HOST-DBL-STD': '/alojamientos/doble-standard.jpg',
  'HOST-DBL-SUP': '/alojamientos/doble-superior.jpg',
  'HOST-TRIPLE': '/alojamientos/triple.jpg',
  'HOST-SUITE': '/alojamientos/suite-principal.jpg',
  'CAB-1D-3P': '/alojamientos/cabana-1-dormitorio.jpg',
  'CAB-2D-4P': '/alojamientos/cabana-2-dormitorios-4.jpg',
  'CAB-2D-5P': '/alojamientos/cabana-2-dormitorios-5.jpg',
  'CAB-3D-6P': '/alojamientos/cabana-3-dormitorios-6.jpg',
  'CAB-3D-7P': '/alojamientos/cabana-3-dormitorios-7.jpg',
}

export function fotoDe(codigo: string): string | null {
  return FOTOS[codigo] ?? null
}
