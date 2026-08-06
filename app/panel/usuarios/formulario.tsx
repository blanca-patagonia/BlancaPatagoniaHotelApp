'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { crearUsuario, type EstadoUsuario } from './actions'
import { ROLES, ETIQUETAS_ROL } from '@/lib/domain/roles'
import {
  CAMPO,
  Campo,
  ExitoConPasos,
  Mensaje,
  PieDeFormulario,
  botonClases,
} from '../_components/ui'

const ESTADO_INICIAL: EstadoUsuario = {}

/**
 * Alta de un usuario del panel.
 *
 * El rol define qué secciones ve: se explica al lado del selector, porque es la
 * decisión que más cuesta deshacer sin querer —dejar a alguien viendo la
 * facturación o, al revés, sin poder trabajar—.
 */
export function FormularioUsuario() {
  const [estado, accion, pendiente] = useActionState(crearUsuario, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
      <Campo etiqueta="Nombre y apellido" requerido>
        <input name="nombre" required className={CAMPO} />
      </Campo>

      <Campo etiqueta="Email" requerido ayuda="Con este email va a iniciar sesión.">
        <input name="email" type="email" required className={CAMPO} />
      </Campo>

      <Campo
        etiqueta="Contraseña inicial"
        requerido
        ayuda="Mínimo 8 caracteres. Pedile que la cambie cuando entre por primera vez."
      >
        <input name="password" type="password" required minLength={8} className={CAMPO} />
      </Campo>

      <Campo etiqueta="Rol" ayuda="Define qué secciones del panel puede ver y usar.">
        <select name="rol" defaultValue="recepcion" className={CAMPO}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ETIQUETAS_ROL[r]}
            </option>
          ))}
        </select>
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
            pasos={[
              { href: '/panel/usuarios/nuevo', texto: 'Dar de alta otro' },
              { href: '/panel/usuarios', texto: 'Volver al listado' },
            ]}
          />
        </div>
      )}

      <PieDeFormulario>
        <button
          type="submit"
          disabled={pendiente}
          className={botonClases('primario', 'w-full disabled:cursor-wait sm:w-auto')}
        >
          {pendiente ? 'Creando…' : 'Crear usuario'}
        </button>
        <Link href="/panel/usuarios" className={botonClases('secundario', 'w-full sm:w-auto')}>
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
