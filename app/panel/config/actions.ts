'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { ETIQUETA_CATALOGO } from '@/lib/catalogo/publico'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso, obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'
import { esMonedaExtranjera, validarCotizacionManual } from '@/lib/domain/divisas'
import { registrarCotizacionManual } from '@/lib/divisas/servicio'
import { cuitValido, normalizarCuit } from '@/lib/domain/facturacion'

export interface EstadoTarifasFila {
  error?: string
  ok?: string
}

/**
 * Actualiza las tarifas (neto y rack) de un tipo de unidad, para las
 * temporadas que tenga cargadas — hasta tres (baja/media/alta) en un solo
 * envío.
 *
 * Solo admin/gerencia. El tarifario es la base de toda cotización, así que se
 * validan los importes antes de tocar la base: nada de precios negativos ni de
 * un neto por encima del rack (el neto es siempre el precio de agencia). Se
 * valida TODO antes de escribir nada: si una sola temporada viene mal, no se
 * guarda ninguna, así una fila nunca queda a medio actualizar.
 *
 * ── Por qué una fila entera y no una tarifa por vez ─────────────────────────
 *
 * Antes cada celda (tipo × temporada) era su propio formulario con su propio
 * botón «OK»: guardar las tres temporadas de un tipo eran tres clics y tres
 * recargas completas de la pantalla, cada una devolviendo a quien cargaba los
 * precios al principio del tarifario. Juntarlas en un solo envío por fila es
 * un clic, una sola recarga, y no se pierde el lugar en la tabla.
 */
export async function actualizarTarifasDeFila(
  _prev: EstadoTarifasFila,
  formData: FormData,
): Promise<EstadoTarifasFila> {
  await requerirAcceso('config')

  const TEMPORADAS = ['baja', 'media', 'alta'] as const
  const cambios: { id: string; neto: number; rack: number }[] = []

  for (const t of TEMPORADAS) {
    const id = String(formData.get(`tarifa_id_${t}`) ?? '')
    if (!id) continue // Este tipo no tiene tarifa cargada para esta temporada.

    const neto = Number(formData.get(`precio_neto_${t}`))
    const rack = Number(formData.get(`precio_rack_${t}`))
    if (!Number.isFinite(neto) || !Number.isFinite(rack) || neto < 0 || rack < 0) {
      return { error: 'Los importes tienen que ser números positivos.' }
    }
    if (neto > rack) {
      return { error: 'El precio neto (agencia) no puede superar al rack (mostrador).' }
    }
    cambios.push({ id, neto, rack })
  }

  const supabase = await crearClienteServidor()
  for (const c of cambios) {
    const { error } = await supabase
      .from('tarifas')
      .update({ precio_neto: c.neto, precio_rack: c.rack })
      .eq('id', c.id)
    // Ver el aviso de atomicidad en `lib/reservas/actions.ts`: si falla la
    // segunda o tercera temporada, las anteriores ya quedaron guardadas. No
    // hay función SQL transaccional para esto todavía.
    if (error) return { error: `No se pudo guardar: ${error.message}` }
  }

  // El precio rack se publica en `/alojamientos`, que lo lee cacheado: sin esto,
  // el nuevo precio tardaría hasta 5 minutos en verse en la web.
  updateTag(ETIQUETA_CATALOGO)
  revalidatePath('/panel/config/tarifario')

  return { ok: 'Tarifas guardadas.' }
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
      cortarSiFalla(error, '/panel/config/inventario', 'stock')
    }
  }
  redirect('/panel/config/inventario')
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
    redirect('/panel/config/inventario?error=producto')
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

  revalidatePath('/panel/config/inventario')
  redirect(error ? '/panel/config/inventario?error=producto' : '/panel/config/inventario?ok=producto')
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
    cortarSiFalla(error, '/panel/config/inventario', 'producto_estado')
  }
  revalidatePath('/panel/config/inventario')
  redirect('/panel/config/inventario')
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
  if (!esMonedaExtranjera(moneda)) redirect('/panel/config/divisas?error=moneda')

  const compra = formData.get('compra')
  const venta = formData.get('venta')

  // El dominio decide si el par sirve: un cero, un negativo o una venta por
  // debajo de la compra (que significaría regalar el spread) no llegan a la base.
  const problema = validarCotizacionManual(compra, venta)
  if (problema) {
    redirect(`/panel/config/divisas?error=cotizacion&detalle=${encodeURIComponent(problema)}`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await registrarCotizacionManual(supabase, {
    moneda,
    compra: Number(compra),
    venta: Number(venta),
    perfilId: sesion.userId,
  })

  if (error) redirect(`/panel/config/divisas?error=cotizacion&detalle=${encodeURIComponent(error)}`)

  revalidatePath('/panel/config/divisas')
  revalidatePath('/panel')
  redirect('/panel/config/divisas?ok=cotizacion')
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
  if (!id) redirect('/panel/config/ubicaciones?error=unidad')

  const bloque = String(formData.get('bloque') ?? '').trim().slice(0, 60)
  const piso = String(formData.get('piso') ?? '').trim().slice(0, 20)
  const ordenCrudo = Number(formData.get('orden'))
  const orden = Number.isFinite(ordenCrudo) ? Math.max(0, Math.trunc(ordenCrudo)) : 0

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('unidades').update({ bloque, piso, orden }).eq('id', id)

  cortarSiFalla(error, '/panel/config/ubicaciones', 'ubicacion')
  revalidatePath('/panel/config/ubicaciones')
  revalidatePath('/panel/ocupacion')
  redirect('/panel/config/ubicaciones?ok=ubicacion')
}

/**
 * Guarda los datos del hotel como emisor de comprobantes (migración 0082).
 *
 * ── Por qué es de admin y no de gerencia ────────────────────────────────────
 *
 * Cambiar el CUIT o la razón social afecta **todos los comprobantes que se emitan
 * desde ese momento**, y un CUIT mal cargado los hace rechazar a todos. La
 * política RLS de la tabla ya lo impone; acá se verifica también para poder
 * explicarlo en español en vez de mostrar un error de base.
 */
export async function guardarDatosFiscales(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || sesion.rol !== 'admin') redirect('/panel/config/datos-fiscales?error=fiscales_rol')

  const razonSocial = String(formData.get('razon_social') ?? '').trim().slice(0, 120)
  const cuit = normalizarCuit(String(formData.get('cuit') ?? ''))

  if (!razonSocial) redirect('/panel/config/datos-fiscales?error=fiscales_razon')
  /*
    Se valida el dígito verificador, no sólo la longitud.

    Once dígitos cualesquiera pasan el `check` de la base y hacen rechazar todos
    los comprobantes contra ARCA, con un error que no dice que el CUIT esté mal.
    `cuitValido` ya existe y se usa para el receptor; el emisor merece lo mismo.
  */
  if (!cuitValido(cuit)) redirect('/panel/config/datos-fiscales?error=fiscales_cuit')

  const condicion = String(formData.get('condicion_iva') ?? 'responsable_inscripto')
  const inicio = String(formData.get('inicio_actividades') ?? '').trim()

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('datos_fiscales').upsert(
    {
      // La fila es única y su clave es la constante `true` (ver la 0082): el
      // `upsert` sobre `id` es lo que convierte «crear» y «editar» en la misma
      // operación sin tener que preguntar antes si ya existe.
      id: true,
      razon_social: razonSocial,
      cuit,
      condicion_iva: condicion,
      domicilio: String(formData.get('domicilio') ?? '').trim().slice(0, 200),
      inicio_actividades: /^\d{4}-\d{2}-\d{2}$/.test(inicio) ? inicio : null,
      ingresos_brutos: String(formData.get('ingresos_brutos') ?? '').trim().slice(0, 60) || null,
      actualizado_por: sesion.userId,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )

  cortarSiFalla(error, '/panel/config/datos-fiscales', 'fiscales')
  revalidatePath('/panel/config/datos-fiscales')
  revalidatePath('/panel/proveedores/comprobantes')
  redirect('/panel/config/datos-fiscales?ok=fiscales')
}
