'use client'

import { useActionState } from 'react'
import { CAMPO, Campo, Mensaje, PieDeFormulario, botonClases } from '../_components/ui'
import { LARGO_MAXIMO_NOMBRE, LARGO_MAXIMO_TELEFONO } from '@/lib/domain/cuenta'
import { guardarMisDatos, type EstadoCuenta } from './actions'

const ESTADO_INICIAL: EstadoCuenta = {}

/**
 * Los datos propios que cada uno puede corregir sin pedirle nada a nadie.
 *
 * Antes esta pantalla los mostraba de solo lectura y aclaraba que «el nombre y el
 * rol los administra un usuario con permisos sobre Usuarios». Para el rol es
 * correcto y sigue igual; para el nombre era una molestia sin motivo: un apellido
 * mal tipeado al dar de alta quedaba así hasta que alguien con permisos se
 * acordara de corregirlo, y ese nombre aparece en el rastro de auditoría, en los
 * avisos y en quién hizo cada check-in.
 *
 * El rol y el email siguen fuera del formulario, y no por olvido:
 *
 * · **El rol** es la barrera de privilegios entera. Que no esté acá es lo de
 *   menos —la garantía es de la base, que tiene el UPDATE acotado por columna
 *   (migración 0066)—, pero tampoco corresponde ofrecerlo.
 * · **El email** es la identidad con la que se inicia sesión. Cambiarlo sin un
 *   circuito de confirmación por correo deja a la persona afuera si se equivoca
 *   en una letra, y hoy el envío de correo es un simulador (ADR 0018). Se muestra
 *   pero no se edita, y la pantalla dice a quién pedírselo.
 */
export function FormularioMisDatos({
  nombre,
  telefono,
}: {
  nombre: string
  telefono: string
}) {
  const [estado, accion, pendiente] = useActionState(guardarMisDatos, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-5 sm:max-w-md">
      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
      {estado.ok && <Mensaje tono="ok">{estado.ok}</Mensaje>}

      <Campo etiqueta="Nombre y apellido" requerido>
        <input
          name="nombre"
          /*
            `defaultValue` con `key`: si la acción vuelve con un error, React
            remonta el campo y el valor tipeado sobrevive. Sin el `key`, un
            `<input defaultValue>` se recupera solo, pero acá se deja explícito
            porque es la misma trampa que costó un bug en el alta de huéspedes
            —donde el afectado era un `<select>`, que NO se recupera—.
          */
          key={nombre}
          defaultValue={nombre}
          required
          maxLength={LARGO_MAXIMO_NOMBRE}
          autoComplete="name"
          className={CAMPO}
        />
      </Campo>

      <Campo
        etiqueta="Teléfono"
        ayuda="Opcional. Es para que el resto del equipo pueda ubicarte desde el sistema."
      >
        <input
          name="telefono"
          key={telefono}
          defaultValue={telefono}
          maxLength={LARGO_MAXIMO_TELEFONO}
          autoComplete="tel"
          inputMode="tel"
          placeholder="Interno 12, o 2902 45-6789"
          className={CAMPO}
        />
      </Campo>

      <PieDeFormulario>
        <button
          type="submit"
          disabled={pendiente}
          className={botonClases('primario', 'w-full disabled:cursor-wait sm:w-auto')}
        >
          {pendiente ? 'Guardando…' : 'Guardar mis datos'}
        </button>
      </PieDeFormulario>
    </form>
  )
}
