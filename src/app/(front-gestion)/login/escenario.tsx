import Image from 'next/image'
import type { ReactNode } from 'react'
import { Logotipo } from '../panel/_components/iconos'

/** Foto propia del hotel (`public/hotel/fotos`), la misma que usa el portal. */
const FOTO_LOBBY = '/hotel/fotos/lobby/ventanal-atardecer.jpg'

/**
 * Marco de las pantallas de ingreso del staff (ingresar, recuperar el acceso y
 * contraseña nueva).
 *
 * Antes era una tarjeta blanca centrada sobre gris: correcta, pero igual a la de
 * cualquier sistema —el docente la comparó con la de otro trabajo al probar la
 * demo—. Ahora la primera pantalla que ve el personal es el propio hotel: el
 * ventanal del lobby al atardecer, con el lago de fondo, y la marca.
 *
 * En escritorio la foto ocupa la mitad izquierda; en el teléfono queda como una
 * franja arriba, para que el formulario entre sin desplazar.
 */
export function EscenarioLogin({
  titulo,
  bajada,
  children,
}: {
  titulo: string
  bajada: string
  children: ReactNode
}) {
  return (
    <main className="grid flex-1 bg-white lg:grid-cols-[1.1fr_1fr]">
      <section className="relative isolate flex min-h-44 flex-col justify-end overflow-hidden lg:min-h-screen">
        <Image
          src={FOTO_LOBBY}
          alt="Lobby del hotel Blanca Patagonia al atardecer, con el ventanal hacia el Lago Argentino"
          fill
          priority
          sizes="(min-width: 1024px) 55vw, 100vw"
          className="-z-10 object-cover"
        />
        {/* Velo azul de la marca: asegura el contraste del texto sobre la foto. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-lago-900/95 via-lago-900/50 to-lago-900/10"
        />
        <div className="flex items-center gap-3 p-5 sm:p-8 lg:p-12">
          <Logotipo tam={44} />
          <div>
            <p className="font-display text-xl leading-tight font-semibold text-white sm:text-2xl">
              Blanca Patagonia
            </p>
            <p className="text-xs tracking-widest text-lago-100 uppercase">Gestión hotelera</p>
          </div>
        </div>
        <p className="hidden max-w-md px-12 pb-12 text-base leading-relaxed text-lago-50/90 lg:block">
          Reservas, estadías, cuentas y cobros del hotel en un solo lugar.
          <span className="mt-4 block text-xs tracking-wide text-lago-200/80 uppercase">
            El Calafate · Santa Cruz
          </span>
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-7">
            <span aria-hidden="true" className="mb-4 block h-1 w-10 rounded-full bg-lenga-500" />
            <h1 className="font-display text-3xl font-semibold tracking-tight text-stone-900">{titulo}</h1>
            <p className="mt-1.5 text-sm text-stone-500">{bajada}</p>
          </div>
          {children}
        </div>
      </section>
    </main>
  )
}
