'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { guardarEtiqueta, guardarRespuesta, type EstadoAjuste } from './ajustes.actions'
import { CAMPO, Campo, ExitoConPasos, Mensaje, PieDeFormulario, botonClases } from '../_components/ui'
import { TONOS_ETIQUETA } from '@/lib/domain/bandeja'

const NOMBRE_TONO: Record<(typeof TONOS_ETIQUETA)[number], string> = {
  lago: 'Azul',
  calafate: 'Violeta',
  lenga: 'Ámbar',
  exito: 'Verde',
  alerta: 'Naranja',
  peligro: 'Rojo',
  neutro: 'Gris',
}

export function FormRespuesta({ inicial }: { inicial?: { id: string; atajo: string; contenido: string } }) {
  const [estado, accion, guardando] = useActionState<EstadoAjuste, FormData>(guardarRespuesta, {})
  const v = estado.valores ?? inicial ?? { atajo: '', contenido: '' }

  if (estado.ok && !inicial) {
    return (
      <ExitoConPasos
        mensaje="Respuesta guardada. Ya se puede usar escribiendo «/» y el atajo en la bandeja."
        pasos={[
          { href: '/panel/bandeja/respuestas/nueva', texto: 'Cargar otra' },
          { href: '/panel/bandeja/respuestas', texto: 'Ver todas' },
          { href: '/panel/bandeja', texto: 'Ir a la bandeja' },
        ]}
      />
    )
  }

  return (
    <form action={accion} className="grid gap-4">
      {inicial && <input type="hidden" name="id" value={inicial.id} />}
      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
      {estado.ok && inicial && <Mensaje tono="ok">Cambios guardados.</Mensaje>}
      <Campo etiqueta="Atajo" requerido ayuda="Lo que se escribe después de «/» en la bandeja. Ej.: checkin">
        <input name="atajo" required defaultValue={v.atajo} key={`a-${v.atajo}`} className={CAMPO} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Texto de la respuesta" requerido>
        <textarea name="contenido" required rows={5} defaultValue={v.contenido} key={`c-${v.contenido.length}`} className={CAMPO} />
      </Campo>
      <PieDeFormulario>
        <button type="submit" disabled={guardando} className={botonClases('primario', 'w-full sm:w-auto')}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <Link href="/panel/bandeja/respuestas" className={botonClases('fantasma', 'w-full sm:w-auto')}>
          Volver
        </Link>
      </PieDeFormulario>
    </form>
  )
}

export function FormEtiqueta({ inicial }: { inicial?: { id: string; nombre: string; color: string } }) {
  const [estado, accion, guardando] = useActionState<EstadoAjuste, FormData>(guardarEtiqueta, {})
  const v = estado.valores ?? inicial ?? { nombre: '', color: 'lago' }

  if (estado.ok && !inicial) {
    return (
      <ExitoConPasos
        mensaje="Etiqueta creada."
        pasos={[
          { href: '/panel/bandeja/etiquetas/nueva', texto: 'Crear otra' },
          { href: '/panel/bandeja/etiquetas', texto: 'Ver todas' },
          { href: '/panel/bandeja', texto: 'Ir a la bandeja' },
        ]}
      />
    )
  }

  return (
    <form action={accion} className="grid gap-4 sm:grid-cols-2">
      {inicial && <input type="hidden" name="id" value={inicial.id} />}
      {estado.error && (
        <div className="sm:col-span-2">
          <Mensaje tono="error">{estado.error}</Mensaje>
        </div>
      )}
      {estado.ok && inicial && (
        <div className="sm:col-span-2">
          <Mensaje tono="ok">Cambios guardados.</Mensaje>
        </div>
      )}
      <Campo etiqueta="Nombre" requerido>
        <input name="nombre" required maxLength={40} defaultValue={v.nombre} key={`n-${v.nombre}`} className={CAMPO} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Color">
        <select name="color" defaultValue={v.color} key={`k-${v.color}`} className={CAMPO}>
          {TONOS_ETIQUETA.map((t) => (
            <option key={t} value={t}>
              {NOMBRE_TONO[t]}
            </option>
          ))}
        </select>
      </Campo>
      <PieDeFormulario>
        <button type="submit" disabled={guardando} className={botonClases('primario', 'w-full sm:w-auto')}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <Link href="/panel/bandeja/etiquetas" className={botonClases('fantasma', 'w-full sm:w-auto')}>
          Volver
        </Link>
      </PieDeFormulario>
    </form>
  )
}
