/*
  Esqueletos de carga.

  Next los muestra mientras el componente de servidor espera a la base. Antes
  había **uno solo** con forma de tablero —encabezado, cuatro KPIs y un bloque
  grande— y se usaba para todas las secciones. Un esqueleto que no se parece a
  lo que después aparece es peor que uno neutro: la pantalla "salta" al
  reemplazarse y da sensación de error, justo lo contrario de lo que se busca.

  Por eso hay tres formas, y cada sección usa la que le corresponde.
*/

/** Barra gris animada. `w` va en clases de Tailwind. */
function Barra({ w = 'w-full', alto = 'h-3' }: { w?: string; alto?: string }) {
  return <div className={`${alto} ${w} rounded bg-stone-200`} />
}

/** Encabezado: icono, título y descripción. Común a todas las pantallas. */
function EncabezadoFalso() {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b border-stone-200 pb-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-xl bg-stone-200" />
        <div className="space-y-2">
          <Barra w="w-44" alto="h-5" />
          <Barra w="w-64" alto="h-3" />
        </div>
      </div>
      <div className="hidden h-10 w-36 rounded-lg bg-stone-200 sm:block" />
    </div>
  )
}

/**
 * Envoltorio común. `aria-busy` y el texto para lector de pantalla van acá una
 * sola vez, para no repetirlos en cada forma.
 */
function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      {children}
    </div>
  )
}

/** Listado: barra de herramientas y filas de tabla. */
export function EsqueletoListado({ filas = 6 }: { filas?: number }) {
  return (
    <Marco>
      <EncabezadoFalso />
      <div className="mb-4 h-14 rounded-2xl border border-stone-200 bg-white" />
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-4 py-3">
          <Barra w="w-32" />
        </div>
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-stone-100 px-4 py-3.5">
            <Barra w="w-24" />
            <Barra w="w-40" />
            <div className="ml-auto h-5 w-20 rounded-full bg-stone-200" />
          </div>
        ))}
      </div>
    </Marco>
  )
}

/** Detalle a dos columnas, como el de una reserva. */
export function EsqueletoDetalle() {
  return (
    <Marco>
      <EncabezadoFalso />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-4">
          <div className="h-44 rounded-2xl border border-stone-200 bg-white" />
          <div className="h-28 rounded-2xl border border-stone-200 bg-white" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-56 rounded-2xl border border-stone-200 bg-white" />
          <div className="h-40 rounded-2xl border border-stone-200 bg-white" />
        </div>
      </div>
    </Marco>
  )
}

/** Tablero: fila de indicadores y un panel grande. */
export function EsqueletoTablero() {
  return (
    <Marco>
      <EncabezadoFalso />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-stone-200 bg-white" />
        ))}
      </div>
      <div className="mt-4 h-72 rounded-2xl border border-stone-200 bg-white" />
    </Marco>
  )
}

/** Formulario de alta o edición, en columna angosta. */
export function EsqueletoFormulario() {
  return (
    <div className="mx-auto w-full max-w-3xl animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <EncabezadoFalso />
      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-2">
              <Barra w="w-28" />
              <div className="h-10 rounded-lg bg-stone-100" />
            </div>
          ))}
        </div>
        <div className="mt-6 h-10 w-40 rounded-lg bg-stone-200" />
      </div>
    </div>
  )
}
