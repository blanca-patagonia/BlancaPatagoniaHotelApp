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

export interface EstadoPorcentajeTarifario {
  error?: string
  ok?: string
}

/**
 * Sube o baja TODAS las tarifas cargadas (o las de una sola temporada) un
 * mismo porcentaje, de una vez.
 *
 * Es como se ajusta el tarifario en un hotel real, según lo que pidió el
 * dueño: al cambio de temporada no se entra tarifa por tarifa, se aplica un
 * porcentaje parejo y después se corrige a mano lo puntual. El mismo
 * porcentaje sube (o baja) el precio neto Y el rack juntos, así la relación
 * entre los dos —el neto de agencia nunca puede superar al rack de
 * mostrador— se mantiene sola: multiplicar dos números por el mismo factor
 * positivo no puede invertir el orden que ya tenían.
 *
 * Se calculan y validan TODOS los precios nuevos antes de escribir el
 * primero: si el porcentaje dejara algún precio negativo, no se guarda nada.
 * Una vez que empieza a escribir seguimos con la misma limitación que
 * `actualizarTarifasDeFila` de este mismo archivo: no hay función SQL
 * transaccional, así que si falla a mitad de camino, las tarifas anteriores
 * en el lote ya quedaron con el precio nuevo.
 */
export async function aplicarPorcentajeTarifario(
  _prev: EstadoPorcentajeTarifario,
  formData: FormData,
): Promise<EstadoPorcentajeTarifario> {
  await requerirAcceso('config')

  const pct = Number(formData.get('porcentaje'))
  if (!Number.isFinite(pct) || pct === 0) return { error: 'Ingresá un porcentaje distinto de cero.' }
  if (pct < -90 || pct > 500) {
    return { error: 'Ese porcentaje parece un error de tipeo (tiene que estar entre -90 y 500). Revisalo.' }
  }

  const temporadaFiltro = String(formData.get('temporada') ?? '') // '' = todas

  const supabase = await crearClienteServidor()
  const { data, error: eLectura } = await supabase
    .from('tarifas')
    .select('id, precio_neto, precio_rack, temporada:temporadas(codigo)')

  if (eLectura) return { error: 'No se pudo leer el tarifario. Probá de nuevo.' }

  interface FilaTarifa {
    id: string
    precio_neto: number | string
    precio_rack: number | string
    temporada: { codigo: string } | null
  }
  const todas = (data ?? []) as unknown as FilaTarifa[]
  const alcanzadas = temporadaFiltro
    ? todas.filter((t) => t.temporada?.codigo === temporadaFiltro)
    : todas

  if (alcanzadas.length === 0) return { error: 'No hay tarifas cargadas para ese filtro.' }

  const factor = 1 + pct / 100
  const cambios = alcanzadas.map((t) => ({
    id: t.id,
    neto: Math.round(Number(t.precio_neto) * factor * 100) / 100,
    rack: Math.round(Number(t.precio_rack) * factor * 100) / 100,
  }))

  if (cambios.some((c) => c.neto < 0 || c.rack < 0)) {
    return { error: 'Ese porcentaje dejaría algún precio negativo. No se guardó nada.' }
  }

  for (const c of cambios) {
    const { error } = await supabase
      .from('tarifas')
      .update({ precio_neto: c.neto, precio_rack: c.rack })
      .eq('id', c.id)
    if (error) {
      return {
        error: `Se aplicó parte del cambio y falló el resto (${error.message}). Revisá el tarifario antes de repetir.`,
      }
    }
  }

  updateTag(ETIQUETA_CATALOGO)
  revalidatePath('/panel/config/tarifario')

  const signo = pct > 0 ? '+' : ''
  return { ok: `Se aplicó ${signo}${pct}% a ${cambios.length} tarifa(s).` }
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

export interface EstadoProducto {
  error?: string
  ok?: string
}

/**
 * Edita nombre, categoría y precio de un producto ya cargado.
 *
 * Antes solo se podía dar de alta uno nuevo: un precio mal cargado o un typo
 * en el nombre («Cocacola» en vez de «Coca-Cola») quedaba así para siempre, o
 * había que desactivarlo y crear otro —perdiendo el historial de consumos
 * que ya lo referencian, porque `consumos.producto_id` sigue apuntando al
 * viejo—. El `codigo` no se toca: es la clave estable que usan los consumos
 * ya cargados y el punto de venta.
 */
export async function editarProducto(
  _prev: EstadoProducto,
  formData: FormData,
): Promise<EstadoProducto> {
  await requerirAcceso('config')

  const id = String(formData.get('id') ?? '')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const categoria = String(formData.get('categoria') ?? '')
  const precio = Number(formData.get('precio'))

  if (!id) return { error: 'Falta el producto a editar.' }
  if (!nombre) return { error: 'Ingresá un nombre.' }
  if (!Number.isFinite(precio) || precio < 0) return { error: 'El precio tiene que ser un número positivo.' }

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('productos_servicios')
    .update({ nombre, categoria, precio })
    .eq('id', id)
  if (error) return { error: `No se pudo guardar: ${error.message}` }

  revalidatePath('/panel/config/inventario')
  return { ok: 'Producto actualizado.' }
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
 * Borra un producto o servicio del catálogo, de verdad.
 *
 * Es seguro por diseño de la base, no por una comprobación de acá:
 * `consumos.producto_id` tiene `on delete restrict` (migración 0010), así que
 * si alguna vez se vendió, Postgres rechaza el borrado antes de tocar nada —
 * el consumo ya cargado no puede quedar apuntando a un producto que no
 * existe. Ese rechazo (código `23503`) no es un fallo real: es la base
 * protegiendo el historial, y se traduce a un mensaje que manda a
 * "Desactivar" en vez del genérico de escritura fallida.
 */
export async function eliminarProducto(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const id = String(formData.get('producto_id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.from('productos_servicios').delete().eq('id', id)
    cortarSiFalla(
      error,
      '/panel/config/inventario',
      error?.code === '23503' ? 'producto_con_historial' : 'producto_eliminar',
    )
  }
  revalidatePath('/panel/config/inventario')
  redirect('/panel/config/inventario?ok=producto_eliminado')
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
