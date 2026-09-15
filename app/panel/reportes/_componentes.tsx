import { mesRelativo, semanaRelativa, etiquetaSemana } from '@/lib/domain/metricas'
import { Icono } from '../_components/iconos'
import { BarraHerramientas, Mensaje, botonClases } from '../_components/ui'

/**
 * Piezas compartidas por los informes.
 *
 * Cada informe es una pantalla propia (así se pueden tener varias abiertas a la
 * vez, que es lo que pidió el hotel), y todas necesitan lo mismo: elegir el
 * mes, avisar si los datos vinieron incompletos y ofrecer abrirse aparte.
 */

/** Flecha de variación contra el período anterior (mes o semana, según el informe). */
export function Variacion({
  valor,
  etiquetaBase = 'mes anterior',
}: {
  valor: number | null
  etiquetaBase?: string
}) {
  if (valor === null) return <span className="text-xs text-stone-600">sin base previa</span>
  if (valor === 0) return <span className="text-xs text-stone-600">igual que {etiquetaBase}</span>
  const sube = valor > 0
  return (
    <span className={`text-xs font-medium ${sube ? 'text-emerald-600' : 'text-red-600'}`}>
      {sube ? '▲' : '▼'} {Math.abs(valor)}% vs. {etiquetaBase}
    </span>
  )
}

/**
 * Selector de mes, apuntando a la pantalla que lo usa.
 *
 * `base` es la ruta del informe: cada uno navega dentro de sí mismo en lugar de
 * volver al índice, que es lo que permite dejar un informe abierto en un mes y
 * otro en otro.
 */
export function SelectorDeMes({ base, mes }: { base: string; mes: string }) {
  return (
    <BarraHerramientas>
      <form method="get" action={base} className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-stone-500">Mes analizado</span>
          <input
            type="month"
            name="mes"
            defaultValue={mes}
            aria-label="Mes analizado"
            /* `py-2` y no `py-1.5`: el campo comparte una fila `items-end` con el
               botón «Ver», y con 34 px contra los 38 del botón el desnivel se
               veía. Se emparejan en 38. */
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-lago-500 focus:outline-none"
          />
        </label>
        <button className={botonClases('primario')}>Ver</button>
      </form>
      <a href={`${base}?mes=${mesRelativo(mes, -1)}`} className={botonClases('secundario')}>
        ‹ Mes anterior
      </a>
      <a href={`${base}?mes=${mesRelativo(mes, 1)}`} className={botonClases('secundario')}>
        Mes siguiente ›
      </a>
    </BarraHerramientas>
  )
}

/**
 * Selector de semana, análogo a `SelectorDeMes`. La semana se elige con un
 * día cualquiera dentro de ella (el navegador ya sabe pedir una fecha con
 * `type="date"`, no hay un `<input>` nativo de "semana" confiable entre
 * navegadores) y se normaliza al lunes en el servidor (`semanaValida`).
 */
export function SelectorDeSemana({ base, semana }: { base: string; semana: string }) {
  return (
    <BarraHerramientas>
      <form method="get" action={base} className="flex items-end gap-2">
        <input type="hidden" name="vista" value="semanal" />
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-stone-500">Semana analizada</span>
          <input
            type="date"
            name="semana"
            defaultValue={semana}
            aria-label="Un día dentro de la semana a analizar"
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-lago-500 focus:outline-none"
          />
        </label>
        <button className={botonClases('primario')}>Ver</button>
      </form>
      <a href={`${base}?vista=semanal&semana=${semanaRelativa(semana, -1)}`} className={botonClases('secundario')}>
        ‹ Semana anterior
      </a>
      <a href={`${base}?vista=semanal&semana=${semanaRelativa(semana, 1)}`} className={botonClases('secundario')}>
        Semana siguiente ›
      </a>
      <span className="text-xs text-stone-500">{etiquetaSemana(semana)}</span>
    </BarraHerramientas>
  )
}

/** Alterna entre la vista mensual y la semanal de un mismo informe. */
export function SelectorDeVista({
  base,
  vista,
}: {
  base: string
  vista: 'mensual' | 'semanal'
}) {
  return (
    <div className="mb-3 inline-flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
      <a
        href={`${base}?vista=mensual`}
        className={`rounded-md px-3 py-1.5 font-medium transition ${
          vista === 'mensual' ? 'bg-lago-600 text-white' : 'text-stone-600 hover:bg-stone-50'
        }`}
      >
        Mensual
      </a>
      <a
        href={`${base}?vista=semanal`}
        className={`rounded-md px-3 py-1.5 font-medium transition ${
          vista === 'semanal' ? 'bg-lago-600 text-white' : 'text-stone-600 hover:bg-stone-50'
        }`}
      >
        Semanal
      </a>
    </div>
  )
}

/**
 * Aviso de datos recortados.
 *
 * Antes, cuando la lectura venía cortada, la pantalla mostraba los números
 * igual y nadie podía saberlo. Un indicador incompleto presentado como completo
 * lleva a decidir mal, y estos números se usan para decidir.
 */
export function AvisoIncompleto({ incompleto }: { incompleto: boolean }) {
  if (!incompleto) return null
  return (
    <Mensaje tono="error">
      Hay más datos de los que se pudieron leer de una vez, así que estos indicadores están
      calculados sobre una parte del historial y no son confiables. Avisale a quien mantiene el
      sistema: hay que pasar estas agregaciones a la base de datos.
    </Mensaje>
  )
}

/**
 * Enlace para abrir el informe en otra pestaña.
 *
 * Es lo que el hotel pidió como «usar varios informes sin cerrar las ventanas».
 * Va como botón visible y no como un ctrl+clic: quien usa el sistema no tiene
 * por qué conocer el atajo, y una función que existe pero no se ve es una
 * función que nadie usa.
 *
 * `rel="noreferrer"` acompaña al `target="_blank"` por costumbre sana: sin él la
 * pestaña nueva recibe una referencia a esta ventana.
 */
export function AbrirAparte({ href, titulo }: { href: string; titulo: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={botonClases('secundario', 'gap-1.5')}
      title={`Abrir ${titulo} en otra pestaña`}
    >
      <Icono nombre="mas" tam={14} />
      Abrir aparte
      <span className="sr-only">— {titulo}, en una pestaña nueva</span>
    </a>
  )
}
