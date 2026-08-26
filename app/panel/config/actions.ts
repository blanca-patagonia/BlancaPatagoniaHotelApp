'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso, obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'
import { esMonedaExtranjera, validarCotizacionManual } from '@/lib/domain/divisas'
import { registrarCotizacionManual } from '@/lib/divisas/servicio'

/**
 * Actualiza el precio neto y rack de una tarifa (tipo de unidad × temporada).
 *
 * Solo admin/gerencia. El tarifario es la base de toda cotización, así que se
 * validan los importes antes de tocar la base: nada de precios negativos ni de
 * un neto por encima del rack (el neto es siempre el precio de agencia).
 */
export async function actualizarTarifa(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const id = String(formData.get('tarifa_id') ?? '')
  const neto = Number(formData.get('precio_neto'))
  const rack = Number(formData.get('precio_rack'))

  if (!id || !Number.isFinite(neto) || !Number.isFinite(rack) || neto < 0 || rack < 0) {
    redirect('/panel/config?error=importes')
  }
  if (neto > rack) redirect('/panel/config?error=neto_mayor')

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('tarifas')
    .update({ precio_neto: neto, precio_rack: rack })
    .eq('id', id)

  redirect(error ? '/panel/config?error=guardar' : '/panel/config?ok=tarifa')
}

/** Repone stock de un producto (suma unidades). Solo admin/gerencia. */
export async function reponerStock(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const id = String(formData.get('producto_id') ?? '')
  const cantidad = Number(formData.get('cantidad') ?? 0)
  if (id && Number.isFinite(cantidad) && cantidad > 0) {
    const supabase = await crearClienteServidor()
    const { data: p } = await supabase
      .from('productos_servicios')
      .select('stock')
      .eq('id', id)
      .single()
    if (p && p.stock != null) {
      const { error } = await supabase
        .from('productos_servicios')
        .update({ stock: (p.stock as number) + cantidad })
        .eq('id', id)
      // Un reposición que no se guarda deja el stock mostrando menos de lo que
      // hay, y el próximo consumo lo descuenta de un número equivocado.
      cortarSiFalla(error, '/panel/config', 'stock')
    }
  }
  redirect('/panel/config')
}

/**
 * Da de alta un producto o servicio del catálogo de consumos.
 *
 * Sin esto el catálogo quedaba congelado en lo que trajo el seed: el hotel no
 * podía sumar una bebida nueva al frigobar.
 */
export async function crearProducto(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const nombre = String(formData.get('nombre') ?? '').trim()
  const categoria = String(formData.get('categoria') ?? 'otro')
  const precio = Number(formData.get('precio'))
  const stock = Number(formData.get('stock'))
  const stockMinimo = Number(formData.get('stock_minimo'))
  const controlaStock = String(formData.get('controla_stock') ?? '') === '1'

  if (!nombre || !Number.isFinite(precio) || precio < 0) {
    redirect('/panel/config?error=producto')
  }

  // El código es único: se deriva del nombre y se completa si ya existe.
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)

  const supabase = await crearClienteServidor()
  const { data: existentes } = await supabase
    .from('productos_servicios')
    .select('codigo')
    .like('codigo', `${base}%`)
  const codigo = existentes?.length ? `${base}-${existentes.length + 1}` : base

  const { error } = await supabase.from('productos_servicios').insert({
    codigo,
    nombre,
    categoria,
    precio,
    // Solo lleva stock lo que es físico: un servicio (late check-out) no.
    stock: controlaStock && Number.isFinite(stock) ? stock : null,
    stock_minimo: controlaStock && Number.isFinite(stockMinimo) ? stockMinimo : null,
  })

  revalidatePath('/panel/config')
  redirect(error ? '/panel/config?error=producto' : '/panel/config?ok=producto')
}

/** Activa o desactiva un producto sin borrarlo (conserva el historial de consumos). */
export async function alternarProducto(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const id = String(formData.get('producto_id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('productos_servicios')
      .update({ activo: !activo })
      .eq('id', id)
    cortarSiFalla(error, '/panel/config', 'producto_estado')
  }
  revalidatePath('/panel/config')
  redirect('/panel/config')
}

/**
 * Carga a mano la cotización de una divisa.
 *
 * Es el respaldo del que habla el ADR 0020: cuando la fuente externa no responde
 * o viene dando cualquier cosa, alguien mira el pizarrón del banco y lo escribe
 * acá. Por eso el valor cargado **le gana** a uno automático más viejo
 * (`resolverVigente` elige por frescura, no por fuente): es una corrección
 * deliberada de una persona, no un dato de segunda.
 *
 * Solo admin/gerencia, y no por prolijidad: fijar la cotización es fijar a qué
 * precio cobra el hotel ese día. Un valor mal tipeado en el mostrador se traduce
 * en cobrarle de menos a todo el que pague en pesos hasta que alguien lo note.
 *
 * A diferencia del resto de este archivo, la comprobación de rol usa
 * `puedeAcceder(rol, 'config')` en lugar del literal `['admin','gerencia']`.
 * `AGENTS.md` pide migrar esos literales al tocarlos; el área `config` ya está
 * restringida a esos dos roles en `lib/domain/permisos.ts`, así que el resultado
 * es el mismo y deja de haber dos fuentes de verdad.
 */
export async function cargarCotizacion(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const moneda = String(formData.get('moneda') ?? '')
  if (!esMonedaExtranjera(moneda)) redirect('/panel/config?error=moneda#divisas')

  const compra = formData.get('compra')
  const venta = formData.get('venta')

  // El dominio decide si el par sirve: un cero, un negativo o una venta por
  // debajo de la compra (que significaría regalar el spread) no llegan a la base.
  const problema = validarCotizacionManual(compra, venta)
  if (problema) {
    redirect(`/panel/config?error=cotizacion&detalle=${encodeURIComponent(problema)}#divisas`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await registrarCotizacionManual(supabase, {
    moneda,
    compra: Number(compra),
    venta: Number(venta),
    perfilId: sesion.userId,
  })

  if (error) redirect(`/panel/config?error=cotizacion&detalle=${encodeURIComponent(error)}#divisas`)

  revalidatePath('/panel/config')
  revalidatePath('/panel')
  redirect('/panel/config?ok=cotizacion#divisas')
}

/**
 * Guarda la ubicación física de una unidad: bloque, piso y orden de recorrido.
 *
 * Sin una pantalla para cargarlos, las columnas de la migración 0042 quedarían
 * vacías para siempre y los filtros de la grilla no servirían para nada.
 *
 * `orden` es el que define el recorrido de limpieza dentro del piso. Existe porque
 * el alfabético pone «10» antes que «9», así que ordenar por nombre manda a la
 * mucama a caminar el pasillo en zigzag.
 */
export async function guardarUbicacionUnidad(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const id = String(formData.get('unidad_id') ?? '')
  if (!id) redirect('/panel/config?error=unidad#ubicaciones')

  const bloque = String(formData.get('bloque') ?? '').trim().slice(0, 60)
  const piso = String(formData.get('piso') ?? '').trim().slice(0, 20)
  const ordenCrudo = Number(formData.get('orden'))
  const orden = Number.isFinite(ordenCrudo) ? Math.max(0, Math.trunc(ordenCrudo)) : 0

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('unidades').update({ bloque, piso, orden }).eq('id', id)

  cortarSiFalla(error, '/panel/config', 'ubicacion')
  revalidatePath('/panel/config')
  revalidatePath('/panel/ocupacion')
  redirect('/panel/config?ok=ubicacion#ubicaciones')
}
