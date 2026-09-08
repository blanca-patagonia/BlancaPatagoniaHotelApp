import { mesRelativo } from '@/lib/domain/metricas'
import { Icono } from '../_components/iconos'
import { BarraHerramientas, Mensaje, botonClases } from '../_components/ui'

/**
 * Piezas compartidas por los informes.
 *
 * Cada informe es una pantalla propia (así se pueden tener varias abiertas a la
 * vez, que es lo que pidió el hotel), y todas necesitan lo mismo: elegir el
 * mes, avisar si los datos vinieron incompletos y ofrecer abrirse aparte.
 */

/** Flecha de variación contra el mes anterior. */
export function Variacion({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-xs text-stone-600">sin base previa</span>
  if (valor === 0) return <span className="text-xs text-stone-600">igual que el mes anterior</span>
  const sube = valor > 0
  return (
    <span className={`text-xs font-medium ${sube ? 'text-emerald-600' : 'text-red-600'}`}>
      {sube ? '▲' : '▼'} {Math.abs(valor)}% vs. mes anterior
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
