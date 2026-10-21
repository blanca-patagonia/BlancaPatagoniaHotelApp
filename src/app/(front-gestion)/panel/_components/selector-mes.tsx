'use client'

import { useEffect, useRef, useState } from 'react'
import { Icono } from './iconos'

/**
 * Selector de mes en español, reemplazo de `<input type="month">`.
 *
 * ── Por qué no alcanza con `<html lang="es">` ────────────────────────────────
 *
 * El texto de un `<input type="month">` nativo ("September 2026", el
 * calendario emergente, los nombres de los meses) lo pone el NAVEGADOR según
 * su propio idioma de interfaz, no el `lang` de la página — es una
 * limitación real de los navegadores actuales, no un descuido del código. En
 * una pantalla 100% en español, con instrucciones en español alrededor, ese
 * inglés suelto (visto en vivo: "September 2026" en Reportes y en Costos y
 * comisión) confunde.
 *
 * ── Cómo sigue funcionando dentro de un `<form>` ─────────────────────────────
 *
 * Este componente NO cambia cómo se envía el mes: sigue viajando como
 * `name=valor` en formato `YYYY-MM`, igual que mandaba el input nativo, vía
 * un `<input type="hidden">`. Así funciona sin tocar nada tanto en los
 * formularios que navegan por GET al elegir "Ver" (`SelectorDeMes`, «Mes a
 * conciliar») como en el que viaja dentro de una Server Action («Mes que
 * factura», con `required`).
 */

const NOMBRES_MES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

const NOMBRES_MES_CORTO = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
]

/** `YYYY-MM` válido, o `null`. No usa `Date` para no arrastrar zona horaria. */
function parsear(valor: string | undefined | null): { anio: number; mes: number } | null {
  if (!valor || !/^\d{4}-\d{2}$/.test(valor)) return null
  const [anio, mes] = valor.split('-').map(Number)
  if (mes < 1 || mes > 12) return null
  return { anio, mes }
}

export function SelectorMes({
  name,
  defaultValue,
  id,
  ariaLabel,
  required,
  className,
}: {
  name: string
  defaultValue?: string
  id?: string
  ariaLabel?: string
  required?: boolean
  className?: string
}) {
  const inicial = parsear(defaultValue)
  const [valor, setValor] = useState<{ anio: number; mes: number } | null>(inicial)
  const [abierto, setAbierto] = useState(false)
  // El año que se ve en el panel puede no ser el elegido todavía (por
  // ejemplo, sin valor inicial se abre en el año actual del navegador —una
  // preferencia de qué mostrar primero, no un cálculo de negocio).
  const [anioVisible, setAnioVisible] = useState(() => inicial?.anio ?? new Date().getFullYear())

  const refContenedor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    function alTocarAfuera(e: MouseEvent) {
      if (!refContenedor.current?.contains(e.target as Node)) setAbierto(false)
    }
    function alPresionar(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', alTocarAfuera)
    window.addEventListener('keydown', alPresionar)
    return () => {
      document.removeEventListener('mousedown', alTocarAfuera)
      window.removeEventListener('keydown', alPresionar)
    }
  }, [abierto])

  const valorFormulario = valor ? `${valor.anio}-${String(valor.mes).padStart(2, '0')}` : ''
  const etiqueta = valor ? `${NOMBRES_MES[valor.mes - 1]} de ${valor.anio}` : 'Elegir mes…'

  return (
    <div ref={refContenedor} className="relative">
      <input type="hidden" name={name} value={valorFormulario} required={required} />
      <button
        type="button"
        id={id}
        aria-label={ariaLabel ?? 'Elegir mes'}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        onClick={() => {
          setAnioVisible(valor?.anio ?? new Date().getFullYear())
          setAbierto((v) => !v)
        }}
        /* El layout (`flex`, alineación) queda fijo siempre —lo necesita el
           ícono al lado del texto—; `className` sólo agrega o reemplaza
           color/borde/tamaño, igual que `extra` en `botonClases`. */
        className={`flex items-center justify-between gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-left text-sm text-stone-800 outline-none transition focus:border-lago-600 ${className ?? ''}`}
      >
        <span className={valor ? '' : 'text-stone-500'}>{etiqueta}</span>
        <Icono nombre="ocupacion" tam={14} className="shrink-0" />
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-label="Elegir mes"
          className="absolute top-full left-0 z-40 mt-1 w-56 rounded-xl border border-stone-200 bg-white p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setAnioVisible((a) => a - 1)}
              aria-label="Año anterior"
              className="flex size-7 items-center justify-center rounded-md text-stone-600 hover:bg-stone-100"
            >
              <Icono nombre="anterior" tam={16} />
            </button>
            <span className="tabular text-sm font-semibold text-stone-800">{anioVisible}</span>
            <button
              type="button"
              onClick={() => setAnioVisible((a) => a + 1)}
              aria-label="Año siguiente"
              className="flex size-7 items-center justify-center rounded-md text-stone-600 hover:bg-stone-100"
            >
              <Icono nombre="siguiente" tam={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {NOMBRES_MES_CORTO.map((nombreCorto, i) => {
              const m = i + 1
              const seleccionado = valor?.anio === anioVisible && valor.mes === m
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={seleccionado}
                  onClick={() => {
                    setValor({ anio: anioVisible, mes: m })
                    setAbierto(false)
                  }}
                  className={`toque rounded-md px-2 py-1.5 text-sm transition ${
                    seleccionado
                      ? 'bg-lago-700 font-medium text-white'
                      : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {nombreCorto}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
