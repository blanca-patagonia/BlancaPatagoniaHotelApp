'use client'

import { useState, useTransition } from 'react'
import { Icono } from './iconos'
import { Mensaje, Tarjeta, botonClases } from './ui'
import { Respuesta } from '../ia/chat'
import { consultaRapida, type TipoConsultaRapida } from '../ia/rapidas'

/**
 * El asistente de IA en el tablero, en un clic: el resumen del día y lo que
 * necesita atención. Sólo lee (no prepara acciones); si de ahí sale algo para
 * hacer, se pide en el chat.
 */
export function ConsultasRapidasIA() {
  const [texto, setTexto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actual, setActual] = useState<TipoConsultaRapida | null>(null)
  const [cargando, iniciar] = useTransition()

  function pedir(tipo: TipoConsultaRapida) {
    setActual(tipo)
    setError(null)
    iniciar(async () => {
      try {
        const r = await consultaRapida(tipo)
        setTexto(r.texto ?? null)
        setError(r.error ?? null)
      } catch {
        setError('No se pudo consultar al asistente. Probá de nuevo.')
      }
    })
  }

  return (
    <Tarjeta titulo="Asistente IA" className="mb-6">
      <div className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => pedir('resumen')}
            disabled={cargando}
            className={botonClases('secundario', 'w-auto gap-1.5 disabled:cursor-wait disabled:opacity-60')}
          >
            <Icono nombre="ia" tam={16} />
            {cargando && actual === 'resumen' ? 'Armando el resumen…' : 'Resumen del día'}
          </button>
          <button
            type="button"
            onClick={() => pedir('atencion')}
            disabled={cargando}
            className={botonClases('secundario', 'w-auto gap-1.5 disabled:cursor-wait disabled:opacity-60')}
          >
            <Icono nombre="ia" tam={16} />
            {cargando && actual === 'atencion' ? 'Revisando…' : '¿Qué necesita atención hoy?'}
          </button>
        </div>
        {error && <Mensaje tono="error">{error}</Mensaje>}
        {texto && !cargando && (
          <div className="flex flex-col gap-2 rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-800">
            <Respuesta texto={texto} />
          </div>
        )}
        {!texto && !error && !cargando && (
          <p className="text-sm text-stone-500">
            La IA lee los datos de hoy (llegadas, salidas, limpieza, saldos, clima) y te los resume.
          </p>
        )}
      </div>
    </Tarjeta>
  )
}
