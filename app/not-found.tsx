import Link from 'next/link'
import { Aviso, botonPublico } from './_publico/ui'

/**
 * Pantalla pública de "no encontrado".
 *
 * El caso más común no es alguien escribiendo mal una dirección: es un **enlace
 * que ya no sirve** —una confirmación de una reserva cancelada, una encuesta ya
 * respondida, un contrato firmado hace meses—. Esas personas no se equivocaron
 * en nada, así que el texto no las trata como si lo hubieran hecho, y siempre
 * ofrece un camino hacia adelante.
 */
export default function NoEncontrado() {
  return (
    <Aviso
      titulo="Este enlace ya no está disponible"
      accion={
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/" className={botonPublico('primario')}>
            Ir al inicio
          </Link>
          <Link href="/reservar" className={botonPublico('secundario')}>
            Ver disponibilidad
          </Link>
        </div>
      }
    >
      <p>
        Puede que la reserva se haya cancelado, que la encuesta ya esté respondida o que el enlace
        esté incompleto —a veces el correo lo corta en dos líneas—.
      </p>
      <p className="mt-3">
        Si lo copiaste de un email, probá pegarlo entero. Y si tenías una reserva con nosotros,
        escribinos y la buscamos por tu apellido.
      </p>
    </Aviso>
  )
}
