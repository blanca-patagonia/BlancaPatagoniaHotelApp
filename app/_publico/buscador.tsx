'use client'

import { useState } from 'react'
import { CAMPO_PUBLICO, botonPublico } from './ui'

/*
  Buscador de estadía — barra prominente y persistente.

  Patrón de Booking que se aplica: el buscador no es una pantalla, es un
  elemento que acompaña. Está en la portada, arriba de los resultados y arriba
  del catálogo, siempre con los mismos tres campos y en el mismo orden. Quien
  llega sabiendo las fechas no tiene que navegar a ningún lado para empezar, y
  quien está mirando opciones puede corregir el período sin volver atrás.

  Antes cada pantalla resolvía esto por su cuenta: `/reservar` tenía el
  formulario y `/alojamientos` y la portada no tenían ninguno, así que cambiar
  de fechas mientras se miraba el catálogo obligaba a volver.

  ── Sobre "colapsable en móvil" ──────────────────────────────────────────────
  El proyecto tiene una regla fijada por el usuario: *nada oculto, pensado para
  gente que no usa mucho la computadora* (Fase 15). Un buscador que en el
  teléfono se reduce a una lupa la incumple: hay que descubrir que ese ícono
  abre algo.

  La resolución: en móvil se colapsa, pero lo que queda visible **no es un
  ícono, es la búsqueda actual escrita en palabras** —«3 sep — 6 sep · 2
  huéspedes»— dentro de un botón que dice qué hace. Se ve qué se está buscando
  sin abrir nada, y el que quiere cambiarlo tiene un objetivo de toque grande y
  rotulado. En escritorio no se colapsa nunca.
*/

interface Props {
  /** Fecha de llegada en ISO, o cadena vacía si todavía no se buscó. */
  checkIn: string
  checkOut: string
  huespedes: number
  /** Hoy en ISO: bloquea elegir fechas pasadas desde el propio calendario. */
  hoy: string
  /**
   * Salida propuesta cuando nadie eligió todavía.
   *
   * Llega calculada desde el servidor y no se resuelve acá con `new Date()`:
   * la aritmética de fechas del proyecto vive en `lib/fechas.ts` y trabaja
   * sobre `YYYY-MM-DD`, justamente para no depender de la zona horaria del
   * navegador (el hotel está en UTC−3 y el sistema razona en UTC).
   */
  salidaPorDefecto: string
  /**
   * `hero` para la portada —grande, es la acción principal de la pantalla—;
   * `barra` para las pantallas de resultados y catálogo, donde acompaña.
   */
  variante?: 'hero' | 'barra'
  /** Se preserva al reenviar el formulario desde la ficha de un alojamiento. */
  tipo?: string
}

/** «3 sep — 6 sep · 2 huéspedes», o una invitación si todavía no se eligió. */
function resumen(checkIn: string, checkOut: string, huespedes: number): string {
  const personas = `${huespedes} ${huespedes === 1 ? 'huésped' : 'huéspedes'}`
  if (!checkIn || !checkOut) return `Elegí las fechas · ${personas}`

  // Se arma sin `new Date()` para no correr el día por zona horaria: las fechas
  // viajan como `YYYY-MM-DD` y acá solo se leen sus partes (ver lib/fechas.ts).
  const corta = (iso: string) => {
    const [, mes, dia] = iso.split('-')
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    return `${Number(dia)} ${MESES[Number(mes) - 1] ?? ''}`.trim()
  }
  return `${corta(checkIn)} — ${corta(checkOut)} · ${personas}`
}

export function BuscadorEstadia({
  checkIn,
  checkOut,
  huespedes,
  hoy,
  salidaPorDefecto,
  variante = 'barra',
  tipo,
}: Props) {
  const [abierto, setAbierto] = useState(false)
  const esHero = variante === 'hero'

  const campos = (
    <>
      {/* Etiqueta visible en los tres campos: el `placeholder` desaparece al
          escribir y deja al huésped sin saber qué está cargando (Fase 15). */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-stone-700">Llegada</span>
        <input
          type="date"
          name="check_in"
          defaultValue={checkIn || hoy}
          min={hoy}
          className={CAMPO_PUBLICO}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-stone-700">Salida</span>
        <input
          type="date"
          name="check_out"
          defaultValue={checkOut || salidaPorDefecto}
          min={hoy}
          className={CAMPO_PUBLICO}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-stone-700">Huéspedes</span>
        <input
          type="number"
          name="huespedes"
          min={1}
          max={7}
          defaultValue={huespedes}
          className={CAMPO_PUBLICO}
        />
      </label>
    </>
  )

  /* `method="get"` y no una acción de servidor: la búsqueda queda en la URL y
     por lo tanto se puede compartir, marcar y recorrer con el botón «atrás».
     Además funciona sin JavaScript. */
  const formulario = (
    <form
      method="get"
      action="/reservar"
      className={
        esHero
          ? 'grid gap-x-4 gap-y-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end'
          : 'grid gap-x-3 gap-y-4 sm:grid-cols-[1fr_1fr_7rem_auto] sm:items-end'
      }
    >
      {tipo && <input type="hidden" name="tipo" value={tipo} />}
      {campos}
      <button type="submit" className={botonPublico('primario', 'w-full sm:w-auto')}>
        Buscar
      </button>
    </form>
  )

  if (esHero) {
    return (
      <div className="w-full rounded-2xl border border-stone-200 bg-white p-5 shadow-lg sm:p-6">
        {formulario}
      </div>
    )
  }

  return (
    /* `sticky` y no `fixed`: no tapa contenido al final de la página ni pelea
       con el teclado del teléfono cuando se enfoca un campo. */
    <div className="sticky top-0 z-30 -mx-5 mb-6 border-b border-stone-200 bg-white/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      {/* Móvil: resumen legible + botón rotulado. Nunca un ícono solo. */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls="buscador-campos"
        className="toque flex w-full items-center justify-between gap-3 rounded-xl border border-stone-300 px-4 py-2.5 text-left transition hover:border-stone-400 sm:hidden"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-stone-800">
            {resumen(checkIn, checkOut, huespedes)}
          </span>
          <span className="block text-sm text-stone-500">
            {abierto ? 'Tocá para cerrar' : 'Tocá para cambiar la búsqueda'}
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-stone-400">
          {abierto ? '▲' : '▼'}
        </span>
      </button>

      <div id="buscador-campos" className={`${abierto ? 'mt-3 block' : 'hidden'} sm:mt-0 sm:block`}>
        {formulario}
      </div>
    </div>
  )
}
