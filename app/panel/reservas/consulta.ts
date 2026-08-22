import 'server-only'
import type { crearClienteServidor } from '@/lib/supabase/server'
import { terminoBusqueda, patronOr } from '@/lib/listados'
import { definicionDe, type VistaReservas } from '@/lib/domain/vistas-reservas'

/**
 * Consulta compartida del listado de reservas.
 *
 * La usan tanto la pantalla como la exportación a CSV: así el archivo que baja
 * el usuario contiene exactamente las filas que está viendo, con los mismos
 * filtros aplicados.
 *
 * ⚠️ El builder de PostgREST es *thenable*. Si una función `async` lo devolviera,
 * el `await` de quien la llama ejecutaría la consulta en lugar de entregar el
 * builder para seguir encadenando. Por eso la parte asíncrona (`filtroTermino`)
 * está separada y devuelve texto plano, y `consultaReservas` es **síncrona**.
 */

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>

export interface FiltrosReservas {
  q?: string
  estado?: string
  canal?: string
  desde?: string
  hasta?: string
  grupo?: string
  /** Vista operativa (en el hotel, llegadas hoy, …). Ver `lib/domain/vistas-reservas.ts`. */
  vista?: VistaReservas
  /**
   * Cortes comerciales que WinPAX tenía en la barra de filtros. Se agregaron en
   * el paso 6, cuando aparecieron las columnas: antes no existían y por eso el
   * paso 3 los había dejado pendientes.
   */
  plan?: string
  garantia?: string
  segmento?: string
  /** Contrato que fija la tarifa. La columna existe desde el paso 6. */
  contrato?: string
  /**
   * Habitación asignada y tipo pedido. Van sobre `estadias`, no sobre `reservas`,
   * y por eso hacen falta las dos: una reserva grupal tiene varias estadías, así
   * que «la habitación 103» significa «alguna de sus estadías está en la 103».
   */
  unidad?: string
  tipoUnidad?: string
  /**
   * Día de referencia de las vistas por fecha. Se pasa explícito y no se toma de
   * `hoyISO()` acá adentro para que la consulta siga siendo determinista y
   * testeable, y para que el export CSV use el mismo día que la pantalla.
   */
  hoy?: string
}

/**
 * Columnas del listado.
 *
 * `pagos(...)` se agregó para poder mostrar el **saldo**, que es una de las
 * columnas que pedía el listado de WinPAX y la que decide si hay que llamar al
 * huésped. Se traen sólo los tres campos que `resumenPagos` necesita, no la fila
 * completa: `nota` es texto libre y no tiene por qué viajar a un listado.
 *
 * `estadias` ahora trae también `check_in`/`check_out` (columnas generadas de la
 * migración 0037) porque son las que filtran las vistas por fecha.
 */
export const SELECT_RESERVAS =
  'id, codigo, estado, total, total_neto, iva, canal, plan, garantia, segmento, creada_en, grupo_id, agencia_id, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, email, vip), estadias!inner(periodo, check_in, check_out, huespedes, adultos, menores, bebes), pagos(tipo, monto, estado)'

/** Tope de ids de huésped que se inyectan en el filtro `in` de la búsqueda. */
const MAX_HUESPEDES_BUSQUEDA = 200

/** Tope de ids de reserva que se inyectan por coincidencia de habitación. */
const MAX_RESERVAS_POR_UNIDAD = 300

/**
 * Traduce el término libre a la expresión `or` de PostgREST.
 *
 * No se pueden combinar en un mismo `or` columnas de la tabla madre con las de
 * una tabla embebida, así que primero se resuelven los huéspedes que coinciden
 * y después se filtra por `codigo` **o** por esos ids.
 *
 * ── Por qué la habitación necesita dos consultas ────────────────────────────
 *
 * El nombre de la unidad («103», «Cabaña del Lago») vive en `unidades`, a dos
 * saltos de `reservas`: hay que pasar por `estadias`. Y como el `or` no puede
 * mezclar la tabla madre con una embebida, la única forma es resolver primero qué
 * unidades coinciden, después qué reservas las ocupan, y recién entonces sumar
 * esos ids al `or`.
 *
 * Buscar «103» y que no aparezca nada era el hueco más molesto del buscador:
 * recepción identifica una reserva por la habitación mucho antes que por su código.
 *
 * Devuelve `null` cuando no hay término que aplicar.
 */
export async function filtroTermino(supabase: Cliente, q: string | undefined): Promise<string | null> {
  const termino = terminoBusqueda(q)
  if (!termino) return null

  // Las tres resoluciones van en paralelo: son independientes entre sí.
  //
  // ⚠️ La habitación y el tipo se buscan por SEPARADO y no con un `or` que mezcle
  // `nombre` de `unidades` con `tipo.nombre` embebido. Es la misma limitación que
  // explica el comentario de arriba, y la primera versión de esto la incumplía: el
  // filtro no devolvía nada y no daba error, que es exactamente el modo de falla
  // silencioso de este stack.
  const [{ data: huespedes }, { data: porNombre }, { data: tipos }] = await Promise.all([
    supabase
      .from('huespedes')
      .select('id')
      .or(
        `apellido.ilike.${patronOr(termino)},nombre.ilike.${patronOr(termino)},email.ilike.${patronOr(termino)}`,
      )
      .limit(MAX_HUESPEDES_BUSQUEDA),

    // `.ilike` con el valor como parámetro es seguro: viaja como dato, no como
    // sintaxis del filtro.
    supabase.from('unidades').select('id').ilike('nombre', `%${termino}%`),

    supabase.from('tipos_unidad').select('id').ilike('nombre', `%${termino}%`),
  ])

  const idsHuesped = (huespedes ?? []).map((h) => h.id as string)
  const idsUnidad = new Set((porNombre ?? []).map((u) => u.id as string))

  // Las unidades de los tipos que coincidieron por nombre («Cabaña», «Doble»).
  const idsTipo = (tipos ?? []).map((t) => t.id as string)
  if (idsTipo.length > 0) {
    const { data: delTipo } = await supabase
      .from('unidades')
      .select('id')
      .in('tipo_unidad_id', idsTipo)
    for (const u of delTipo ?? []) idsUnidad.add(u.id as string)
  }

  // De las unidades a las reservas que las ocupan.
  let idsReserva: string[] = []
  if (idsUnidad.size > 0) {
    const { data: estadias } = await supabase
      .from('estadias')
      .select('reserva_id')
      .in('unidad_id', [...idsUnidad])
      .limit(MAX_RESERVAS_POR_UNIDAD)

    idsReserva = [...new Set((estadias ?? []).map((e) => e.reserva_id as string))]
  }

  const condiciones = [`codigo.ilike.${patronOr(termino)}`]
  if (idsHuesped.length) condiciones.push(`huesped_id.in.(${idsHuesped.join(',')})`)
  if (idsReserva.length) condiciones.push(`id.in.(${idsReserva.join(',')})`)

  return condiciones.join(',')
}

/**
 * Arma la consulta con los filtros aplicados. Quien la llama decide después el
 * `range()` (listado paginado) o el `limit()` (exportación).
 *
 * @param orTermino resultado de `filtroTermino`, ya resuelto por el llamador.
 */
export function consultaReservas(supabase: Cliente, f: FiltrosReservas, orTermino: string | null) {
  let q = supabase
    .from('reservas')
    .select(SELECT_RESERVAS, { count: 'exact' })
    .order('creada_en', { ascending: false })

  if (f.grupo) q = q.eq('grupo_id', f.grupo)
  if (f.estado) q = q.eq('estado', f.estado)
  if (f.canal) q = q.eq('canal', f.canal)
  if (f.plan) q = q.eq('plan', f.plan)
  if (f.garantia) q = q.eq('garantia', f.garantia)
  if (f.segmento) q = q.eq('segmento', f.segmento)
  if (f.contrato) q = q.eq('contrato_id', f.contrato)

  // Habitación y tipo van sobre la tabla embebida. Funcionan porque `estadias` se
  // trae con `!inner`: con un embed normal, PostgREST devolvería todas las reservas
  // con el array vacío y el filtro no filtraría nada, en silencio.
  if (f.unidad) q = q.eq('estadias.unidad_id', f.unidad)
  if (f.tipoUnidad) q = q.eq('estadias.tipo_unidad_id', f.tipoUnidad)

  // Reservas cuya estadía se superpone con la ventana pedida.
  if (f.desde && f.hasta) q = q.filter('estadias.periodo', 'ov', `[${f.desde},${f.hasta})`)

  // ── Vista operativa ────────────────────────────────────────────────────────
  // Traduce la definición del dominio a filtros. La vista y el chip de estado
  // conviven: si se aplicaran las dos, PostgREST las combina con AND, que es lo
  // esperable. La pantalla igual las presenta como mutuamente excluyentes para no
  // dejar al usuario con un resultado vacío sin entender por qué.
  if (f.vista) {
    const d = definicionDe(f.vista)

    if (d.estados) q = q.in('estado', [...d.estados])

    // `check_in`/`check_out` son las columnas generadas de la 0037. Sin ellas
    // esto había que escribirlo con operadores de rango negados, ilegibles.
    if (d.fecha && f.hoy) {
      q = q.eq(d.fecha === 'llega' ? 'estadias.check_in' : 'estadias.check_out', f.hoy)
    }

    if (d.agrupacion === 'grupo') {
      q = q.not('grupo_id', 'is', null)
    } else if (d.agrupacion === 'particular') {
      // Particular = sin grupo Y sin agencia. Quien vino por agencia no es
      // particular aunque haya venido solo.
      q = q.is('grupo_id', null).is('agencia_id', null)
    }
  }

  if (orTermino) q = q.or(orTermino)

  return q
}
