'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso } from '@/lib/auth/session'
import { CONDICIONES_IVA, cuitValido, type CondicionIva } from '@/lib/domain/facturacion'
import { ESTADOS_ACTIVOS } from '@/lib/domain/reservas'
import { nombreCompleto } from '@/lib/domain/huespedes'
import { cortarSiFalla } from '@/lib/acciones'

export interface EstadoHuesped {
  error?: string
  ok?: string
  /**
   * Lo que se había cargado, para reponerlo si hubo error.
   *
   * React limpia el formulario después de una Server Action. Sin esto, un CUIT
   * con un dígito verificador mal tipeado borraba los nueve campos y había que
   * escribir todo de nuevo —con alguien esperando en el mostrador—. Es el mismo
   * patrón que ya usaba `EstadoNuevaReserva`.
   */
  valores?: Partial<Record<keyof ReturnType<typeof leerCampos>, string>>
  /**
   * Id del huésped recién creado.
   *
   * No se hace `redirect()` a propósito: mandar a alguien a otra pantalla sin
   * avisar es desorientador, sobre todo para quien no usa la computadora todos
   * los días. Se le confirma qué pasó y se le ofrecen los siguientes pasos
   * —ver la ficha, cargar otro— como botones visibles. Este id es el que
   * permite armar ese enlace.
   */
  id?: string
}

const DOCS = ['DNI', 'Pasaporte', 'CUIT', 'CUIL', 'LC', 'LE']

/**
 * Guarda de acceso al módulo.
 *
 * Antes comprobaba solo que existiera sesión, sin mirar el rol: cualquier
 * usuario autenticado —housekeeping incluido— podía dar de alta y editar
 * huéspedes con sus datos de documento. Una Server Action es un endpoint HTTP
 * público: que la pantalla no muestre el enlace no impide invocarla.
 *
 * `requerirAcceso` consulta la matriz de `lib/domain/permisos.ts`, que es la
 * única fuente de verdad de quién puede qué.
 */
async function exigirAcceso() {
  return requerirAcceso('huespedes')
}

/** Campos comunes al alta y a la edición. */
function leerCampos(formData: FormData) {
  const docTipo = String(formData.get('doc_tipo') ?? 'DNI')
  return {
    apellido: String(formData.get('apellido') ?? '').trim(),
    nombre: String(formData.get('nombre') ?? '').trim(),
    doc_tipo: DOCS.includes(docTipo) ? docTipo : 'DNI',
    doc_numero: String(formData.get('doc_numero') ?? '').trim(),
    email: String(formData.get('email') ?? '').trim() || null,
    telefono: String(formData.get('telefono') ?? '').trim() || null,
    nacionalidad: String(formData.get('nacionalidad') ?? '').trim() || null,
    condicion_iva: String(formData.get('condicion_iva') ?? 'consumidor_final') as CondicionIva,
    /*
      Una de las dos condiciones de la exención de IVA del turista del exterior
      (RG 3971, ADR 0024). La otra —el origen del pago— vive en la reserva,
      porque cambia en cada estadía.

      Ojo: NO se deriva de `nacionalidad`. Un argentino puede residir afuera y un
      extranjero puede vivir acá; confundirlos es el error que la norma castiga.
    */
    residente_exterior: formData.get('residente_exterior') === '1',
    notas: String(formData.get('notas') ?? '').trim(),
  }
}

/**
 * Valida lo que comparten alta y edición.
 *
 * El CUIT se verifica de verdad porque de la condición frente al IVA depende la
 * letra del comprobante: una factura A con CUIT inválido la rechaza AFIP.
 */
function validar(c: ReturnType<typeof leerCampos>): string | null {
  if (!c.apellido) return 'Ingresá el apellido.'
  if (!c.nombre) return 'Ingresá el nombre.'
  if (!CONDICIONES_IVA.includes(c.condicion_iva)) return 'Elegí una condición frente al IVA.'
  if (c.condicion_iva === 'responsable_inscripto') {
    if (c.doc_tipo !== 'CUIT') {
      return 'Un responsable inscripto se identifica con CUIT: cambiá el tipo de documento.'
    }
    if (!cuitValido(c.doc_numero)) return 'El CUIT no es válido (revisá el dígito verificador).'
  }
  return null
}

/**
 * Convierte los campos leídos a strings, para reponerlos en el formulario.
 *
 * Los booleanos van como `'1'` / `''` y no como `'true'` / `'false'`: es el
 * valor que manda una casilla marcada, así que el formulario la repone leyendo
 * lo mismo que había enviado.
 */
function aValores(c: ReturnType<typeof leerCampos>): EstadoHuesped['valores'] {
  return Object.fromEntries(
    Object.entries(c).map(([k, v]) => [
      k,
      typeof v === 'boolean' ? (v ? '1' : '') : v == null ? '' : String(v),
    ]),
  ) as EstadoHuesped['valores']
}

export async function crearHuesped(
  _prev: EstadoHuesped,
  formData: FormData,
): Promise<EstadoHuesped> {
  await exigirAcceso()
  const campos = leerCampos(formData)
  const error = validar(campos)
  if (error) return { error, valores: aValores(campos) }

  const supabase = await crearClienteServidor()

  // Evita duplicar por email, que es como el alta desde el portal identifica al
  // huésped que vuelve.
  if (campos.email) {
    const { data: existente, error: eExistente } = await supabase
      .from('huespedes')
      .select('id')
      .eq('email', campos.email)
      .maybeSingle()
    // Sin esto, una lectura que falla salteaba el chequeo de duplicados por
    // completo y el alta seguía derecho al insert.
    if (eExistente) {
      return { error: 'No se pudo verificar si ya existe un huésped con ese email. Probá de nuevo.', valores: aValores(campos) }
    }
    if (existente) return { error: 'Ya hay un huésped con ese email.', valores: aValores(campos) }
  }

  const { data, error: e } = await supabase.from('huespedes').insert(campos).select('id').single()
  if (e) return { error: `No se pudo crear: ${e.message}`, valores: aValores(campos) }

  revalidatePath('/panel/huespedes')
  return {
    ok: `Se registró a ${nombreCompleto(campos)}.`,
    id: (data as { id: string } | null)?.id,
  }
}

export async function actualizarHuesped(
  _prev: EstadoHuesped,
  formData: FormData,
): Promise<EstadoHuesped> {
  await exigirAcceso()
  const id = String(formData.get('huesped_id') ?? '')
  if (!id) return { error: 'Falta el huésped.' }

  const campos = leerCampos(formData)
  const error = validar(campos)
  if (error) return { error, valores: aValores(campos) }

  const supabase = await crearClienteServidor()
  const { error: e } = await supabase.from('huespedes').update(campos).eq('id', id)
  if (e) return { error: `No se pudo guardar: ${e.message}`, valores: aValores(campos) }

  revalidatePath(`/panel/huespedes/${id}`)
  return { ok: 'Datos actualizados.' }
}

/**
 * Fusiona dos fichas de un mismo huésped real: la que se está mirando
 * (`conservar`) absorbe el historial de `descartar`, que desaparece.
 *
 * El caso típico es el huésped `Externo-xxxxxx` que entra por un canal sin
 * documento ni email, y vuelve directo con sus datos reales: hasta ahora
 * quedaban como dos personas separadas, cada una con su propio historial de
 * reservas y de puntos, y no había forma de unirlas.
 *
 * El trabajo pesado —reasignar reservas y acompañantes, sumar los puntos, y
 * recién al final borrar el duplicado— lo hace `fusionar_huespedes` (migración
 * 0111) en una sola transacción.
 */
export async function fusionarHuespedes(formData: FormData): Promise<void> {
  await exigirAcceso()
  const conservar = String(formData.get('conservar_id') ?? '')
  const descartar = String(formData.get('descartar_id') ?? '')
  if (!conservar || !descartar) redirect(`/panel/huespedes/${conservar}?error=fusion_datos`)

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('fusionar_huespedes', {
    p_conservar: conservar,
    p_descartar: descartar,
  })
  if (error) redirect(`/panel/huespedes/${conservar}?error=fusion`)

  const resultado = data as { ok: boolean; motivo?: string } | null
  if (!resultado?.ok) {
    redirect(`/panel/huespedes/${conservar}?error=fusion_${resultado?.motivo ?? 'desconocido'}`)
  }

  revalidatePath(`/panel/huespedes/${conservar}`)
  revalidatePath('/panel/huespedes')
  redirect(`/panel/huespedes/${conservar}?ok=fusionado`)
}

/**
 * Ejerce el derecho de supresión (Ley 25.326) sobre una ficha: sobrescribe
 * nombre, documento, contacto y notas. No borra la fila ni toca sus reservas,
 * pagos o facturas — `huespedes` tiene `on delete restrict` desde `reservas`
 * (migración 0005) y esos comprobantes son del contador, con su propia
 * retención fiscal. Es la misma baja lógica que ya usa este proyecto en vez de
 * un DELETE físico (agencias, proveedores, tarifas — migración 0061).
 *
 * Se bloquea si tiene una reserva que todavía ocupa inventario (pendiente,
 * confirmada, pagada o in_house): recepción necesita el nombre y el contacto
 * reales para atender esa estadía. Hay que esperar al check-out o cancelarla
 * primero.
 */
export async function anonimizarHuesped(formData: FormData): Promise<void> {
  await exigirAcceso()
  const id = String(formData.get('huesped_id') ?? '')
  if (!id) redirect('/panel/huespedes')

  const supabase = await crearClienteServidor()
  const { data: activa, error: eActiva } = await supabase
    .from('reservas')
    .select('id')
    .eq('huesped_id', id)
    .in('estado', ESTADOS_ACTIVOS)
    .limit(1)
    .maybeSingle()
  if (eActiva) cortarSiFalla(eActiva, `/panel/huespedes/${id}`, 'anonimizar_verificar')
  if (activa) redirect(`/panel/huespedes/${id}?error=anonimizar_activa`)

  const { error } = await supabase
    .from('huespedes')
    .update({
      nombre: 'Anonimizado',
      apellido: 'Anonimizado',
      doc_numero: '',
      email: null,
      telefono: null,
      nacionalidad: null,
      notas: '',
      acepta_avisos: false,
      acepta_promociones: false,
      anonimizado: true,
    })
    .eq('id', id)
  cortarSiFalla(error, `/panel/huespedes/${id}`, 'anonimizar')

  revalidatePath(`/panel/huespedes/${id}`)
  revalidatePath('/panel/huespedes')
  redirect(`/panel/huespedes/${id}?ok=anonimizado`)
}
