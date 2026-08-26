import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { ETIQUETAS_ROL } from '@/lib/domain/roles'
import { puedeAcceder } from '@/lib/domain/permisos'
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

      <div className="grid gap-4 xl:grid-cols-[16rem_1fr]">
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
          className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto"
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

        {/*
          Los capítulos se reparten en DOS COLUMNAS a partir de `xl`, con
          `columns` y no con `grid`.

          El motivo es que miden cosas muy distintas —de 172 px a 543 px— y una
          grilla de dos columnas alinea por fila: cada fila queda tan alta como su
          tarjeta más alta y al lado sobra un hueco. `columns` las va apilando y
          equilibra las dos columnas solo, sin huecos.

          Por qué importaba: diez de los diecisiete capítulos tienen uno o dos pasos y
          aun así costaban 172-210 px cada uno, casi todo marco de tarjeta. En una sola
          columna la guía medía 5.739 px, más de seis pantallas.

          Adentro de una tarjeta angosta los pasos vuelven a UNA columna (`xl:grid-cols-1`
          después del `lg:grid-cols-2`): en 590 px de ancho, dos columnas dejan renglones
          de treinta caracteres.

          Medido a 1728 px: 5.739 → 4.387 px. Nada se escondió — el orden de lectura
          sigue siendo el del DOM, el índice sigue llevando a cada capítulo y Ctrl+F
          los sigue encontrando, que es como se busca en un manual.
        */}
        <div className="flex min-w-0 flex-col gap-4 lg:block lg:columns-2 lg:gap-x-4">
          <section id="primeros-pasos" className="scroll-mt-20 lg:mb-4 lg:break-inside-avoid">
            <Tarjeta
              titulo="Para empezar"
              descripcion="Cuatro cosas que conviene saber antes de tocar nada."
            >
              <ol className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-2 lg:grid-cols-1">
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
            <section key={c.area} id={c.area} className="scroll-mt-20 lg:mb-4 lg:break-inside-avoid">
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
                  Nada de acordeones, ni acá ni en ningún capítulo.

                  La guía se lee de una sola pasada a propósito (ver la cabecera del
                  archivo): quien la necesita es quien menos cómodo se siente con la
                  computadora, y esconder el texto detrás de un clic le agrega un
                  problema. Lo que se achica es el ALTO, nunca lo que está a la vista.

                  Los pasos van a dos columnas en el tramo `lg` (una sola columna de
                  capítulos, tarjeta ancha) y vuelven a una en `xl`, donde los capítulos
                  ya están repartidos en dos columnas y la tarjeta es angosta.
                */}
                <ol className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-2 lg:grid-cols-1">
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

          <section id="glosario" className="scroll-mt-20 lg:mb-4 lg:break-inside-avoid">
            <Tarjeta
              titulo="Qué significa cada palabra"
              descripcion="Los términos del sistema, en castellano común."
            >
              <dl className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-2 lg:grid-cols-1">
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

          <Tarjeta className="lg:break-inside-avoid">
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
              {/*
                El botón solo aparece si Conversaciones está encendido.

                `conversaciones` es una de las áreas de `AREAS_OCULTAS`, y estando en
                esa lista `puedeAcceder` devuelve `false` para TODOS los roles: el
                `requerirAcceso` de la pantalla rebota a `/panel`. O sea que este
                botón mandaba a un lugar del que se volvía solo, sin ningún mensaje.

                Al estar atado a `puedeAcceder`, vuelve a aparecer solo el día que se
                le saque el nombre a esa lista, sin tocar nada acá — que es
                justamente lo que promete el comentario de `permisos.ts`.
              */}
              {puedeAcceder(sesion.rol, 'conversaciones') ? (
                <>
                  <p className="min-w-0 flex-1 text-sm text-balance text-stone-600">
                    ¿Algo no está explicado acá? Dejalo en Conversaciones y se agrega a la guía.
                  </p>
                  <Link
                    href="/panel/conversaciones"
                    className={botonClases('secundario', 'w-full justify-center sm:w-auto')}
                  >
                    Abrir conversaciones
                  </Link>
                </>
              ) : (
                <p className="min-w-0 flex-1 text-sm text-balance text-stone-600">
                  ¿Algo no está explicado acá? Avisale a quien administra el sistema y se agrega a
                  la guía.
                </p>
              )}
            </div>
          </Tarjeta>
        </div>
      </div>
    </Pagina>
  )
}
