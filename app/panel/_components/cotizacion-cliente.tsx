'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  DESCRIPCION_FUENTE,
  ETIQUETAS_FUENTE,
  ETIQUETAS_ORIGEN,
  formatearLocal,
  textoAntiguedad,
  type CotizacionVigente,
  type Fuente,
} from '@/lib/domain/divisas'
import { Icono } from './iconos'
import { useAvisos } from './toast'

/**
 * Parte cliente del widget de cotización: es la que se refresca sola.
 *
 * ── Por qué es un componente aparte y no todo `WidgetCotizacion` ────────────
 *
 * `WidgetCotizacion` sigue siendo un Server Component async (así el dashboard
 * no espera por él, ver el comentario de `cotizacion.tsx`). Pero un Server
 * Component se resuelve una sola vez, al pedirse la página: no hay forma de
 * que "se vaya actualizando solo" sin un componente cliente que vuelva a
 * preguntar. Por pedido del usuario, ese refresco es cada 5 minutos, contra
 * `GET /api/cotizacion` (que ya existe para esto: ver su propio comentario
 * sobre por qué no castiga a la fuente externa).
 *
 * Si el refresco falla — la red, `/api/cotizacion` caído — se queda con el
 * último dato bueno en pantalla. Nunca lo borra por un fallo transitorio: un
 * widget que parpadea a «sin datos» cada tanto es peor que uno demorado.
 *
 * ── Tres tarjetas, apiladas y no en grilla ───────────────────────────────
 *
 * El pedido fue que se vea con tarjetas y chips VENTA/COMPRA, al estilo de un
 * cotizador de bolsillo — pero el widget vive en un tercio del ancho del
 * dashboard (`app/panel/page.tsx`, `lg:col-span-1` de 3). Tres tarjetas lado a
 * lado ahí no entran con texto legible, y en el teléfono ese tercio pasa a ser
 * el ancho completo. Apiladas verticalmente, cada tarjeta usa todo el ancho
 * disponible sea cual sea — nunca hay una grilla de columnas que pueda
 * desbordar.
 *
 * ── Accesibilidad ─────────────────────────────────────────────────────────
 *
 * El estado de la cotización oficial **nunca** se comunica sólo con color.
 * Lleva icono + texto:
 *
 *   · al día       → ✓ «En vivo · hace 5 minutos»
 *   · vencida      → ícono de alerta + «Última guardada · hace 2 horas»
 *   · muy vieja    → ícono de alerta + «verificá antes de cobrar»
 *   · sin ninguna  → texto explícito de que se opera en USD
 */

const INTERVALO_MS = 5 * 60 * 1000

interface Informativa {
  compra: number
  venta: number
}

export interface DatosCotizacion {
  vigente: CotizacionVigente | null
  blue: Informativa | null
  bancoNacion: Informativa | null
}

/** Tono de la tarjeta oficial según qué tan confiable es el número. */
function tonos(c: CotizacionVigente) {
  if (c.requiereAdvertencia) {
    return {
      caja: 'border-red-200 bg-red-50/60',
      texto: 'text-red-900',
      detalle: 'text-red-700',
      icono: 'alerta' as const,
    }
  }
  if (c.vencida) {
    return {
      caja: 'border-lenga-200 bg-lenga-50/60',
      texto: 'text-lenga-900',
      detalle: 'text-lenga-800',
      icono: 'alerta' as const,
    }
  }
  return {
    caja: 'border-stone-200 bg-white',
    texto: 'text-stone-900',
    detalle: 'text-stone-600',
    icono: 'ok' as const,
  }
}

/** Chips VENTA/COMPRA: VENTA destacada porque es la que se cobra (ADR 0020). */
function ChipsVentaCompra() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="rounded-md bg-lago-700 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
        VENTA
      </span>
      <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-stone-500 ring-1 ring-stone-300">
        COMPRA
      </span>
    </div>
  )
}

function PrecioVentaCompra({ venta, compra, tono }: { venta: number; compra: number; tono: string }) {
  return (
    <p className={`tabular mt-1.5 text-xl leading-none font-semibold ${tono}`}>
      {formatearLocal(venta, 'ARS')}{' '}
      <span className="text-sm font-normal text-stone-400">/ {formatearLocal(compra, 'ARS')}</span>
    </p>
  )
}

/** Tarjeta de Banco Nación o blue: solo referencia, nunca alimentan un cobro. */
function TarjetaInformativa({ titulo, datos, nota }: { titulo: string; datos: Informativa; nota: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <h3 className="text-xs font-semibold text-stone-700">{titulo}</h3>
      <div className="mt-2">
        <ChipsVentaCompra />
      </div>
      <PrecioVentaCompra venta={datos.venta} compra={datos.compra} tono="text-stone-900" />
      <p className="mt-1.5 text-[11px] text-stone-400">{nota}</p>
    </div>
  )
}

export function CotizacionCliente({ inicial }: { inicial: DatosCotizacion }) {
  const [datos, setDatos] = useState(inicial)
  const avisos = useAvisos()
  // Por ciclo de falla, no por intento: sin esto, mientras la fuente esté
  // caída el aviso reaparecería cada 5 minutos y taparía la pantalla de
  // toasts viejos en vez de avisar una vez que algo cambió.
  const fallando = useRef(false)

  useEffect(() => {
    let cancelado = false

    async function actualizar() {
      try {
        const r = await fetch('/api/cotizacion?moneda=ARS', { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (cancelado) return

        setDatos({
          vigente: j.cotizaciones?.[0] ?? null,
          blue: j.informativas?.blue ?? null,
          bancoNacion: j.informativas?.bancoNacion ?? null,
        })

        if (fallando.current) {
          fallando.current = false
          avisos.mostrar('ok', 'La cotización volvió a actualizarse.')
        }
      } catch {
        // El dato en pantalla NO se borra: se mantiene el último bueno. El
        // aviso es una capa encima, no un reemplazo de esa garantía.
        if (!fallando.current) {
          fallando.current = true
          avisos.mostrar('error', 'No se pudo actualizar la cotización. Se muestra el último valor conocido.')
        }
      }
    }

    const id = window.setInterval(actualizar, INTERVALO_MS)
    return () => {
      cancelado = true
      window.clearInterval(id)
    }
  }, [avisos])

  const { vigente: c, blue, bancoNacion } = datos

  return (
    <div className="space-y-2">
      {c ? (
        <div className={`rounded-xl border p-3 ${tonos(c).caja}`}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
              <Icono nombre="divisas" tam={14} />
              Dólar oficial
            </h3>
            <Link
              href="/panel/config/divisas"
              className="shrink-0 text-[11px] font-medium text-lago-700 hover:underline"
            >
              Ajustar
            </Link>
          </div>

          <div className="mt-2">
            <ChipsVentaCompra />
          </div>

          {/* El número de VENTA es el que se cobra según el Tarifario. */}
          <PrecioVentaCompra venta={c.venta} compra={c.compra} tono={tonos(c).texto} />

          {/* Estado: icono + texto, nunca sólo color. */}
          <p className={`mt-2 flex items-center gap-1.5 text-[11px] ${tonos(c).detalle}`}>
            <Icono nombre={tonos(c).icono} tam={12} />
            <span>
              {ETIQUETAS_ORIGEN[c.origen]} · {textoAntiguedad(c.antiguedadMinutos)}
              {c.requiereAdvertencia && (
                <strong className="ml-1 font-semibold">— verificá antes de cobrar</strong>
              )}
            </span>
          </p>

          {/* De dónde sale el número, y qué NO es (ver ADR 0020). */}
          <p className="mt-1 text-[10px] text-stone-400">
            {ETIQUETAS_FUENTE[c.fuente as Fuente]} · {DESCRIPCION_FUENTE[c.fuente as Fuente]}
          </p>
        </div>
      ) : (
        // Sin cotización utilizable no se muestra un error: se dice qué
        // implica. El USD es la moneda base del sistema (ADR 0003), así que
        // operar sin conversión es una molestia, no una falla.
        <div className="rounded-xl border border-stone-200 bg-white p-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-stone-400">
              <Icono nombre="divisas" tam={16} />
            </span>
            <div>
              <h3 className="text-xs font-semibold text-stone-700">Dólar oficial</h3>
              <p className="mt-1 text-[11px] text-stone-600">
                No hay cotización disponible. Los importes se muestran en USD, que es la moneda del
                sistema.
              </p>
              <Link
                href="/panel/config/divisas"
                className="mt-1.5 inline-block text-[11px] font-medium text-lago-700 hover:underline"
              >
                Cargar una a mano
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Solo informativas: lo que se cobra según el Tarifario es SIEMPRE el
          oficial de arriba (ADR 0020). Ninguna de las dos alimenta ningún
          cálculo, están para que quien mira el tablero tenga el dato a mano. */}
      {bancoNacion && (
        <TarjetaInformativa
          titulo="Banco Nación"
          datos={bancoNacion}
          nota="Ámbito Financiero, no oficial — solo de referencia"
        />
      )}
      {blue && <TarjetaInformativa titulo="Dólar blue" datos={blue} nota="No se cobra a este valor" />}
    </div>
  )
}
