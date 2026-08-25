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
        {/* Índice. En pantallas chicas queda arriba, como una lista de atajos. */}
        {/*
          El índice se pega, pero con techo: `max-h` + `overflow-y-auto`. Con
          quince capítulos la tarjeta puede quedar más alta que la ventana, y un
          `sticky` más alto que la pantalla deja sus últimas entradas
          permanentemente fuera de alcance — no hay forma de scrollear hasta
          ellas porque el elemento no se mueve.
        */}
        <nav
          aria-label="Índice de la ayuda"
          className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto"
        >
          <Tarjeta titulo="Contenido">
            <ul className="flex flex-col gap-0.5 p-3 text-sm">
              <li>
                <a
                  href="#primeros-pasos"
                  className="block rounded-lg px-3 py-2 text-stone-600 transition hover:bg-lago-50 hover:text-lago-800"
                >
                  Para empezar
                </a>
              </li>
              {capitulos.map((c) => (
                <li key={c.area}>
                  <a
                    href={`#${c.area}`}
                    className="block rounded-lg px-3 py-2 text-stone-600 transition hover:bg-lago-50 hover:text-lago-800"
                  >
                    {tituloCapitulo(c)}
                  </a>
                </li>
              ))}
              <li>
                <a
                  href="#glosario"
                  className="block rounded-lg px-3 py-2 text-stone-600 transition hover:bg-lago-50 hover:text-lago-800"
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
              <ol className="grid gap-x-6 gap-y-3 p-5 xl:grid-cols-2">
                {PRIMEROS_PASOS.map((p, i) => (
                  <li key={p.titulo} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-lago-100 text-xs font-semibold text-lago-800">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800">{p.titulo}</p>
                      <p className="mt-0.5 text-sm leading-snug text-pretty text-stone-600">
                        {p.detalle}
                      </p>
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
                {/*
                  Dos columnas desde `xl`, no un acordeón.

                  La guía se lee de una sola pasada a propósito (ver la cabecera
                  del archivo): quien la necesita es quien menos cómodo se siente
                  con la computadora, y esconder el texto detrás de un clic le
                  agrega un problema. Pero en una sola columna la página medía
                  7.583 px en escritorio y 12.273 px en teléfono — encontrar algo
                  era scrollear a ciegas.

                  Dos columnas parten el alto sin ocultar nada: todo el texto
                  sigue estando a la vista y el buscador del navegador (Ctrl+F)
                  lo sigue encontrando, que es como se busca en un manual.
                */}
                <ol className="grid gap-x-6 gap-y-3 p-5 xl:grid-cols-2">
                  {c.pasos.map((p, i) => (
                    <li key={p.titulo} className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold text-stone-600">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-800">{p.titulo}</p>
                        <p className="mt-0.5 text-sm leading-snug text-pretty text-stone-600">
                          {p.detalle}
                        </p>
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
              <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
                {GLOSARIO.map((t) => (
                  <div key={t.termino}>
                    <dt className="text-sm font-medium text-stone-800">{t.termino}</dt>
                    <dd className="mt-0.5 text-sm leading-snug text-pretty text-stone-600">
                      {t.definicion}
                    </dd>
                  </div>
                ))}
              </dl>
            </Tarjeta>
          </section>

          <Tarjeta>
            {/*
              Apilado en pantalla chica y en fila desde `sm`.

              Antes era `flex flex-wrap items-center` con el párrafo en `flex-1`.
              `flex-1` da base 0, así que el párrafo se deja aplastar por el botón
              —que no encoge— en vez de forzar el salto de línea: a 360 px quedaba
              con unos 80 px de ancho y el texto se salía 50 px de la tarjeta.
              `flex-wrap` no lo salvaba, porque para envolver hace falta que algo
              no entre, y el párrafo siempre «entra» encogiéndose a cero.

              Apilar es más simple que pelearse con las bases del flex, y en un
              teléfono es además la forma correcta: el botón a ancho completo se
              toca mejor.
            */}
            <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-lenga-50 text-lenga-700 ring-1 ring-lenga-100">
                <Icono nombre="chat" tam={18} />
              </span>
              <p className="min-w-0 flex-1 text-sm text-balance text-stone-600">
                ¿Algo no está explicado acá? Dejalo en Conversaciones y se agrega a la guía.
              </p>
              <Link
                href="/panel/conversaciones"
                className={botonClases('secundario', 'w-full justify-center sm:w-auto')}
              >
                Abrir conversaciones
              </Link>
            </div>
          </Tarjeta>
        </div>
      </div>
    </Pagina>
  )
}
