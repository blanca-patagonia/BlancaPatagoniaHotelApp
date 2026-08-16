'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { registrarFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'
import {
  esPuntoVenta,
  lineasCargadas,
  totalComanda,
  validarComanda,
  type LineaComanda,
} from '@/lib/domain/punto-venta'

/**
 * Cierre de una comanda del punto de venta.
 *
 * ── Por qué las líneas se cargan de una sola vez ────────────────────────────
 *
 * El camino anterior era un `<select>` por producto: cinco artículos del frigobar
 * eran cinco operaciones y cinco líneas sueltas. Acá la grilla manda todas juntas
 * y comparten un **número de comanda**, que es lo que permite reconocer el recuento
 * y anularlo completo si se cargó en la habitación equivocada.
 */

export interface EstadoComanda {
  error?: string
  ok?: string
  /** Número asignado, para poder mostrarlo y anotarlo en la habitación. */
  comanda?: number
}

/**
 * Tope de líneas por comanda.
 *
 * El catálogo del hotel tiene unos diez productos; cincuenta es holgado y protege
 * de un formulario manipulado que intente insertar miles de filas de una vez.
 */
const MAX_LINEAS = 50

export async function cerrarComanda(
  _prev: EstadoComanda,
  formData: FormData,
): Promise<EstadoComanda> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'punto_venta')) redirect('/panel')

  const reservaId = String(formData.get('reserva_id') ?? '')
  const puntoCrudo = String(formData.get('punto') ?? 'recepcion')
  const notaGeneral = String(formData.get('nota') ?? '').trim()

  if (!reservaId) return { error: 'Elegí a qué habitación se carga la comanda.' }
  if (!esPuntoVenta(puntoCrudo)) return { error: 'El punto de venta no es válido.' }

  const supabase = await crearClienteServidor()

  // ── Se leen los precios de la BASE, no del formulario ──────────────────────
  // Es la decisión de seguridad de esta acción. Si el precio viniera del
  // formulario, cualquiera podría cargarse un vino a USD 0 editando el HTML. El
  // formulario sólo aporta qué producto y cuánto; el precio lo pone el catálogo.
  const productoIds = formData
    .getAll('producto_id')
    .map(String)
    .filter(Boolean)
    .slice(0, MAX_LINEAS)

  if (productoIds.length === 0) return { error: 'Cargá al menos un producto.' }

  const { data: catalogo, error: eCatalogo } = await supabase
    .from('productos_servicios')
    .select('id, nombre, precio, stock, activo, departamento_id')
    .in('id', productoIds)

  if (eCatalogo) {
    registrarFalla(eCatalogo, 'leer el catálogo para la comanda')
    return { error: 'No se pudo leer el catálogo. Probá de nuevo.' }
  }

  const porId = new Map(
    ((catalogo ?? []) as { id: string; nombre: string; precio: number | string; stock: number | null; activo: boolean; departamento_id: string | null }[]).map(
      (p) => [p.id, p],
    ),
  )

  const lineas: LineaComanda[] = []
  for (const id of productoIds) {
    const p = porId.get(id)
    if (!p || !p.activo) continue

    const cantidad = Number(formData.get(`cantidad_${id}`))
    lineas.push({
      productoId: id,
      nombre: p.nombre,
      cantidad: Number.isFinite(cantidad) ? Math.trunc(cantidad) : 0,
      precioUnitario: Number(p.precio),
      stock: p.stock,
    })
  }

  const problemas = validarComanda(lineas)
  if (problemas.length > 0) return { error: problemas[0] }

  const aCargar = lineasCargadas(lineas)

  // ── Número de comanda ──────────────────────────────────────────────────────
  // Se pide recién acá, después de validar: si se pidiera antes, una comanda
  // rechazada consumiría un número. Los huecos son tolerables (la secuencia no es
  // numeración fiscal) pero no hay motivo para provocarlos.
  const { data: numero, error: eNumero } = await supabase.rpc('siguiente_comanda')
  if (eNumero || numero == null) {
    registrarFalla(eNumero, 'pedir el número de comanda')
    return { error: 'No se pudo asignar el número de comanda. Probá de nuevo.' }
  }
  const comanda = Number(numero)

  // ── Alta de las líneas ─────────────────────────────────────────────────────
  // Un solo `insert` con todas: PostgREST lo manda como una sentencia, así que o
  // entran todas o no entra ninguna. Es lo que evita media comanda en la cuenta.
  const { error: eInsert } = await supabase.from('consumos').insert(
    aCargar.map((l) => ({
      reserva_id: reservaId,
      producto_id: l.productoId,
      cantidad: l.cantidad,
      // Snapshot del precio, como ya hacía el alta de a uno: si mañana sube el
      // vino, esta comanda sigue diciendo lo que se cobró.
      precio_unitario: l.precioUnitario,
      // Se copia el departamento del producto, no se deriva al consultar: si mañana
      // el producto cambia de sector, la linea ya cobrada tiene que seguir
      // diciendo donde se vendio.
      departamento_id: porId.get(l.productoId)?.departamento_id ?? null,
      comanda,
      punto: puntoCrudo,
      nota: notaGeneral,
      cargado_por: sesion.userId,
    })),
  )

  if (eInsert) {
    registrarFalla(eInsert, `cerrar la comanda ${comanda}`)
    return {
      error:
        'No se pudo cargar la comanda. No se registró ninguna línea, así que se puede reintentar sin duplicar.',
    }
  }

  // ── Descuento de stock ─────────────────────────────────────────────────────
  // Va después y con `registrarFalla`: el consumo ya está en la cuenta del huésped,
  // que es el dato que importa. Si el stock no baja, el inventario queda mostrando
  // más de lo que hay —molesto y corregible— pero cortar acá dejaría a quien cargó
  // creyendo que la comanda no entró, cuando sí entró.
  for (const l of aCargar) {
    if (l.stock == null) continue
    const { error } = await supabase
      .from('productos_servicios')
      .update({ stock: Math.max(0, l.stock - l.cantidad) })
      .eq('id', l.productoId)
    registrarFalla(error, `descontar stock de ${l.nombre} en la comanda ${comanda}`)
  }

  revalidatePath('/panel/punto-venta')
  revalidatePath(`/panel/reservas/${reservaId}`)

  return {
    ok:
      `Comanda ${comanda} cargada: ${aCargar.length} línea(s) por USD ` +
      `${totalComanda(aCargar).toLocaleString('es-AR')}.`,
    comanda,
  }
}

/**
 * Anula una comanda completa.
 *
 * Es la razón por la que las líneas comparten un número: sin él, corregir un
 * recuento cargado en la habitación equivocada era borrar cinco líneas de a una
 * esperando no olvidarse ninguna.
 *
 * No se repone el stock a propósito: el consumo físico ya ocurrió (la botella no
 * volvió al frigobar), lo que se corrige es a quién se le cobra. Si además hay que
 * ajustar el inventario, se hace desde configuración, que es donde se ve el número.
 */
export async function anularComanda(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'punto_venta')) redirect('/panel')

  const comanda = Number(formData.get('comanda'))
  if (!Number.isFinite(comanda)) redirect('/panel/punto-venta?error=comanda')

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('consumos').delete().eq('comanda', comanda)

  if (error) {
    registrarFalla(error, `anular la comanda ${comanda}`)
    redirect('/panel/punto-venta?error=anular')
  }

  revalidatePath('/panel/punto-venta')
  redirect(`/panel/punto-venta?ok=anulada&comanda=${comanda}`)
}
