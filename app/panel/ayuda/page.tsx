import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { ETIQUETAS_ROL } from '@/lib/domain/roles'
import { PRIMEROS_PASOS, GLOSARIO, guiaPara, tituloCapitulo } from '@/lib/domain/ayuda'
import { Encabezado, Pagina, Tarjeta, botonClases } from '../_components/ui'
import { Icono } from '../_components/iconos'

/**
 * Guía de uso del sistema.
 *
 * Todo el contenido está **a la vista**: no hay acordeones ni pestañas. Quien
 * necesita el manual es justamente quien menos cómodo se siente con la
 * computadora, y obligarlo a descubrir dónde hacer clic para leer una
 * explicación es agregarle un problema al que ya tenía. El índice de la
 * izquierda lleva a cada capítulo, pero el texto está igual aunque no se use.
 *
 * Los capítulos se filtran por rol con los mismos permisos que arman el menú
 * (ver `lib/domain/ayuda.ts`).
 */
export const metadata = {
  title: 'Ayuda — Blanca Patagonia',
}

export default async function AyudaPage() {
  const sesion = await requerirAcceso('ayuda')
  const capitulos = guiaPara(sesion.rol)

  return (
    <Pagina>
      <Encabezado
        titulo="Ayuda"
        descripcion={`Guía de uso del sistema para el perfil de ${ETIQUETAS_ROL[sesion.rol].toLowerCase()}.`}
        icono="ayuda"
      />

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        {/* Índice. En pantallas chicas queda arriba, como una lista de atajos.

            El `max-h` + `overflow-y-auto` de la lista NO son decorativos: el
            índice tiene un capítulo por área visible y con el rol de admin son
            catorce. Pegado con `sticky` y sin altura acotada, lo que no entraba
            en la pantalla quedaba cortado por debajo y era IMPOSIBLE de
            alcanzar: la página ya estaba abajo de todo y la tarjeta no
            scrolleaba por su cuenta. Se acota la `<ul>` y no la tarjeta entera
            para que el rótulo «Contenido» no se vaya con el scroll.

            La cuenta: `100dvh` menos las `5rem` del `top-20`, menos el alto del
            encabezado de la tarjeta y un respiro abajo. */}
        <nav aria-label="Índice de la ayuda" className="lg:sticky lg:top-20 lg:self-start">
          <Tarjeta titulo="Contenido">
            <ul className="flex flex-col gap-0.5 overflow-y-auto p-3 text-sm lg:max-h-[calc(100dvh-9.5rem)]">
              <li>
                <a
                  href="#primeros-pasos"
                  className="flex min-h-11 items-center rounded-lg px-3 py-2 text-stone-600 transition hover:bg-lago-50 hover:text-lago-800"
                >
                  Para empezar
                </a>
              </li>
              {capitulos.map((c) => (
                <li key={c.area}>
                  <a
                    href={`#${c.area}`}
                    className="flex min-h-11 items-center rounded-lg px-3 py-2 text-stone-600 transition hover:bg-lago-50 hover:text-lago-800"
                  >
                    {tituloCapitulo(c)}
                  </a>
                </li>
              ))}
              <li>
                <a
                  href="#glosario"
                  className="flex min-h-11 items-center rounded-lg px-3 py-2 text-stone-600 transition hover:bg-lago-50 hover:text-lago-800"
                >
                  Qué significa cada palabra
                </a>
              </li>
            </ul>
          </Tarjeta>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <section id="primeros-pasos" className="scroll-mt-20">
            <Tarjeta
              titulo="Para empezar"
              descripcion="Cuatro cosas que conviene saber antes de tocar nada."
            >
              <ol className="flex flex-col gap-4 p-5">
                {PRIMEROS_PASOS.map((p, i) => (
                  <li key={p.titulo} className="flex gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-lago-100 text-sm font-semibold text-lago-800">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-stone-800">{p.titulo}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-stone-600">{p.detalle}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Tarjeta>
          </section>

          {capitulos.map((c) => (
            <section key={c.area} id={c.area} className="scroll-mt-20">
              <Tarjeta
                titulo={tituloCapitulo(c)}
                descripcion={c.resumen}
                acciones={
                  <Link href={`/panel/${c.area.replace(/_/g, '-')}`} className={botonClases('secundario')}>
                    Ir a la sección
                  </Link>
                }
              >
                <ol className="flex flex-col gap-4 p-5">
                  {c.pasos.map((p, i) => (
                    <li key={p.titulo} className="flex gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-sm font-semibold text-stone-600">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-stone-800">{p.titulo}</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-stone-600">{p.detalle}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Tarjeta>
            </section>
          ))}

          <section id="glosario" className="scroll-mt-20">
            <Tarjeta
              titulo="Qué significa cada palabra"
              descripcion="Los términos del sistema, en castellano común."
            >
              <dl className="grid gap-4 p-5 sm:grid-cols-2">
                {GLOSARIO.map((t) => (
                  <div key={t.termino}>
                    <dt className="font-medium text-stone-800">{t.termino}</dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-stone-600">
                      {t.definicion}
                    </dd>
                  </div>
                ))}
              </dl>
            </Tarjeta>
          </section>

          <Tarjeta>
            <div className="flex flex-wrap items-center gap-3 p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-lenga-50 text-lenga-700 ring-1 ring-lenga-100">
                <Icono nombre="chat" tam={18} />
              </span>
              <p className="min-w-0 flex-1 text-sm text-stone-600">
                ¿Algo no está explicado acá? Dejalo en Conversaciones y se agrega a la guía.
              </p>
              <Link href="/panel/conversaciones" className={botonClases('secundario')}>
                Abrir conversaciones
              </Link>
            </div>
          </Tarjeta>
        </div>
      </div>
    </Pagina>
  )
}
