'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import {
  CONDICIONES_IVA,
  ETIQUETAS_CONDICION_IVA,
  type CondicionIva,
} from '@/lib/domain/facturacion'
import {
  CAMPO,
  Campo,
  ExitoConPasos,
  Mensaje,
  PieDeFormulario,
  botonClases,
} from '../_components/ui'
import { crearHuesped, actualizarHuesped, type EstadoHuesped } from './actions'

const ESTADO_INICIAL: EstadoHuesped = {}

const DOCS = ['DNI', 'Pasaporte', 'CUIT', 'CUIL', 'LC', 'LE']

export interface DatosHuesped {
  id?: string
  apellido?: string
  nombre?: string
  doc_tipo?: string
  doc_numero?: string
  email?: string | null
  telefono?: string | null
  nacionalidad?: string | null
  condicion_iva?: CondicionIva
  /** Una de las dos condiciones de la exención de IVA (RG 3971, ADR 0024). */
  residente_exterior?: boolean | null
  notas?: string
}

/**
 * Formulario de huésped, para alta y edición.
 *
 * Cada campo lleva **etiqueta visible**: antes se identificaban por el
 * `placeholder`, que desaparece al escribir. Y los datos que tienen
 * consecuencias más adelante llevan una línea de ayuda, porque el momento de
 * entenderlos es este y no cuando ya se produjo el problema: la condición
 * frente al IVA define la letra del comprobante que se emite al facturar
 * (ADR 0012), y para una factura A hace falta CUIT.
 */
export function FormularioHuesped({ huesped }: { huesped?: DatosHuesped }) {
  const esEdicion = Boolean(huesped?.id)
  const [estado, accion, pendiente] = useActionState(
    esEdicion ? actualizarHuesped : crearHuesped,
    ESTADO_INICIAL,
  )

  /*
    Al fallar, la acción devuelve lo que se había escrito. Sin esto React
    limpiaba el formulario entero: un CUIT mal tipeado obligaba a recargar los
    nueve campos, con alguien esperando en el mostrador.

    El orden importa: primero lo que la persona acaba de escribir, después lo
    que estaba guardado. Al revés, un error de validación pisaría la corrección
    con el valor viejo.
  */
  const v = estado.valores ?? {}

  return (
    <form action={accion} className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
      {esEdicion && <input type="hidden" name="huesped_id" value={huesped!.id} />}

      <Campo etiqueta="Apellido" requerido>
        <input name="apellido" required defaultValue={v.apellido ?? huesped?.apellido ?? ''} className={CAMPO} />
      </Campo>
      <Campo etiqueta="Nombre" requerido>
        <input name="nombre" required defaultValue={v.nombre ?? huesped?.nombre ?? ''} className={CAMPO} />
      </Campo>

      <Campo etiqueta="Tipo de documento">
        {/*
          El `key` NO es decorativo: sin él este `<select>` pierde lo elegido.

          Verificado en el navegador. `defaultValue` en un `<select>` marca la
          opción al MONTAR; volver a renderizar con otro valor no toca el DOM, y
          el reseteo de formulario de React 19 devuelve el control a la opción de
          origen. Los `<input>` no tienen el problema porque ahí React sí
          actualiza el atributo `value`.

          Consecuencia real, que es lo que lo vuelve grave: al fallar la
          validación del CUIT, este campo volvía de «CUIT» a «DNI» y el de
          condición frente al IVA de «Responsable Inscripto» a «Consumidor
          Final». Quien corregía solo el número y reenviaba **guardaba el huésped
          con la condición fiscal equivocada, sin ningún aviso** — y de eso
          depende la letra del comprobante (ADR 0012).

          Con el `key` atado al valor, React remonta el `<select>` y la opción
          correcta queda marcada.
        */}
        <select
          key={`doc-${v.doc_tipo ?? huesped?.doc_tipo ?? 'DNI'}`}
          name="doc_tipo"
          defaultValue={v.doc_tipo ?? huesped?.doc_tipo ?? 'DNI'}
          className={CAMPO}
        >
          {DOCS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Campo>
      <Campo etiqueta="Número de documento" ayuda="Sin puntos ni guiones.">
        <input name="doc_numero" defaultValue={v.doc_numero ?? huesped?.doc_numero ?? ''} className={CAMPO} />
      </Campo>

      <Campo etiqueta="Email" ayuda="Acá se envían la confirmación y la encuesta de la estadía.">
        <input name="email" type="email" defaultValue={v.email ?? huesped?.email ?? ''} className={CAMPO} />
      </Campo>
      <Campo etiqueta="Teléfono">
        <input
          name="telefono"
          type="tel"
          defaultValue={v.telefono ?? huesped?.telefono ?? ''}
          className={CAMPO}
        />
      </Campo>

      <Campo etiqueta="Nacionalidad">
        <input name="nacionalidad" defaultValue={v.nacionalidad ?? huesped?.nacionalidad ?? ''} className={CAMPO} />
      </Campo>

      <Campo
        etiqueta="Residencia"
        ayuda="La exención de IVA del turista del exterior (RG 3971) exige que el huésped resida afuera Y que pague desde el exterior. La nacionalidad sola no alcanza: el origen del pago se carga en cada reserva."
      >
        <label className="flex items-start gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            name="residente_exterior"
            value="1"
            defaultChecked={
              v.residente_exterior !== undefined
                ? v.residente_exterior === '1'
                : Boolean(huesped?.residente_exterior)
            }
            className="mt-0.5 h-4 w-4 rounded border-stone-300 text-lago-600"
          />
          <span>Reside en el exterior</span>
        </label>
      </Campo>

      <Campo
        etiqueta="Condición frente al IVA"
        ayuda="Define la letra de la factura. Si es responsable inscripto o monotributista, cargá el CUIT arriba."
      >
        {/* Mismo motivo que el `<select>` de arriba: sin `key` se pierde lo
            elegido al fallar la validación, y acá el dato define la letra de la
            factura. */}
        <select
          key={`iva-${v.condicion_iva ?? huesped?.condicion_iva ?? 'consumidor_final'}`}
          name="condicion_iva"
          defaultValue={v.condicion_iva ?? huesped?.condicion_iva ?? 'consumidor_final'}
          className={CAMPO}
        >
          {CONDICIONES_IVA.map((c) => (
            <option key={c} value={c}>
              {ETIQUETAS_CONDICION_IVA[c]}
            </option>
          ))}
        </select>
      </Campo>

      <Campo
        etiqueta="Notas internas"
        ayuda="Preferencias, alergias u observaciones. El huésped no las ve."
        anchoCompleto
      >
        <textarea name="notas" rows={3} defaultValue={v.notas ?? huesped?.notas ?? ''} className={CAMPO} />
      </Campo>

      {estado.error && (
        <div className="sm:col-span-2">
          <Mensaje tono="error">{estado.error}</Mensaje>
        </div>
      )}

      {estado.ok && (
        <div className="sm:col-span-2">
          <ExitoConPasos
            mensaje={estado.ok}
            pasos={
              esEdicion
                ? []
                : [
                    ...(estado.id
                      ? [{ href: `/panel/huespedes/${estado.id}`, texto: 'Ver su ficha' }]
                      : []),
                    { href: '/panel/huespedes/nuevo', texto: 'Registrar otro' },
                    { href: '/panel/huespedes', texto: 'Volver al listado' },
                  ]
            }
          />
        </div>
      )}

      <PieDeFormulario>
        <button
          type="submit"
          disabled={pendiente}
          className={botonClases('primario', 'w-full disabled:cursor-wait sm:w-auto')}
        >
          {pendiente ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Registrar huésped'}
        </button>
        <Link
          href={esEdicion ? `/panel/huespedes/${huesped!.id}` : '/panel/huespedes'}
          className={botonClases('secundario', 'w-full sm:w-auto')}
        >
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
