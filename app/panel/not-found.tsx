import Link from 'next/link'
import { Encabezado, Pagina, Tarjeta, botonClases } from './_components/ui'
import { Icono } from './_components/iconos'

/**
 * Pantalla para cuando el registro no existe.
 *
 * Antes caía la genérica de Next, en inglés y sin salida: quien llegaba por un
 * enlace viejo —una reserva cancelada, un huésped borrado— quedaba varado sin
 * entender qué había pasado ni cómo volver.
 */
export default function NoEncontrado() {
  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo="No encontramos eso"
        descripcion="El enlace puede estar viejo, o el registro se borró."
        icono="buscar"
      />

      <Tarjeta>
        <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
            <Icono nombre="montana" tam={26} />
          </span>
          <p className="max-w-sm text-sm leading-relaxed text-stone-600">
            Puede que la reserva se haya cancelado, que el registro ya no exista o que el enlace
            esté mal copiado. No se perdió nada: probá buscarlo desde su sección.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Link href="/panel" className={botonClases('primario')}>
              Ir al inicio
            </Link>
            <Link href="/panel/reservas" className={botonClases('secundario')}>
              Buscar en reservas
            </Link>
            <Link href="/panel/ayuda" className={botonClases('secundario')}>
              Ver la ayuda
            </Link>
          </div>
        </div>
      </Tarjeta>
    </Pagina>
  )
}
