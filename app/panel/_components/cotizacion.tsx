import Link from 'next/link'
import { cotizacionVigente } from '@/lib/divisas/servicio'
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

/**
 * Widget de cotización del dólar para el panel.
 *
 * ── Por qué es un componente async aparte y no parte del dashboard ──────────
 *
 * Resolver la cotización puede implicar una llamada a una API externa con hasta
 * 3 s de espera. Si eso viviera dentro de `app/panel/page.tsx`, el dashboard
 * entero —ocupación, llegadas, salidas, avisos— quedaría esperando por un número
 * accesorio. Va envuelto en `<Suspense>` desde el llamador: el panel se pinta
 * enseguida y el recuadro de la cotización se completa cuando llega.
 *
 * ── Accesibilidad ──────────────────────────────────────────────────────────
 *
 * El estado de la cotización **nunca** se comunica sólo con color. Cada uno lleva
 * icono + texto:
 *
 *   · al día       → ✓ «En vivo · hace 5 minutos»
 *   · vencida      → ícono de alerta + «Última guardada · hace 2 horas»
 *   · muy vieja    → ícono de alerta + «verificá antes de cobrar»
 *   · sin ninguna  → texto explícito de que se opera en USD
 *
 * Es el criterio que pidió el usuario para no perder información en modo
 * daltónico, y acá pesa doble: el color es lo único que distingue «este número
 * sirve para cobrar» de «este número es de ayer».
 */

/** Tono de la tarjeta según qué tan confiable es el número. */
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

export async function WidgetCotizacion() {
  const c = await cotizacionVigente('ARS')

  // Sin ninguna cotización utilizable no se muestra un error: se dice qué implica.
  // El USD es la moneda base del sistema (ADR 0003), así que operar sin
  // conversión es una molestia, no una falla.
  if (!c) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-stone-400">
            <Icono nombre="divisas" tam={18} />
          </span>
          <div>
            <h2 className="text-sm font-medium text-stone-700">Dólar</h2>
            <p className="mt-1 text-xs text-stone-600">
              No hay cotización disponible. Los importes se muestran en USD, que es la moneda del
              sistema.
            </p>
            <Link
              href="/panel/config#divisas"
              className="mt-2 inline-block text-xs font-medium text-lago-700 hover:underline"
            >
              Cargar una a mano
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const t = tonos(c)

  return (
    <div className={`rounded-xl border p-4 ${t.caja}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-stone-700">
            <Icono nombre="divisas" tam={16} />
            Dólar oficial
          </h2>

          {/* El número grande es el de VENTA: es el que se cobra según el
              Tarifario. El de compra va al lado, más chico, para que quede claro
              cuál es cuál y nadie use el equivocado. */}
          <p className={`tabular mt-1.5 text-2xl leading-none font-semibold ${t.texto}`}>
            {formatearLocal(c.venta, 'ARS')}
          </p>
          <p className="tabular mt-1 text-xs text-stone-500">
            venta · compra {formatearLocal(c.compra, 'ARS')}
          </p>
        </div>

        <Link
          href="/panel/config#divisas"
          className="shrink-0 text-xs font-medium text-lago-700 hover:underline"
        >
          Ajustar
        </Link>
      </div>

      {/* Estado: icono + texto, nunca sólo color. */}
      <p className={`mt-3 flex items-center gap-1.5 text-xs ${t.detalle}`}>
        <Icono nombre={t.icono} tam={14} />
        <span>
          {ETIQUETAS_ORIGEN[c.origen]} · {textoAntiguedad(c.antiguedadMinutos)}
          {c.requiereAdvertencia && (
            <strong className="ml-1 font-semibold">— verificá antes de cobrar</strong>
          )}
        </span>
      </p>

      {/* De dónde sale el número, y qué NO es.
          El pedido del cliente fue «conectarlo al Banco Nación». El BNA no
          publica un servicio para consultarlo, así que se usa un tercero que
          replica ese valor. Decirlo acá —y no solo en el ADR 0020— es lo que
          permite que quien cobra pueda dudar del número cuando corresponda. */}
      <p className="mt-1 text-[11px] text-stone-500">
        Fuente: {ETIQUETAS_FUENTE[c.fuente as Fuente]}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-stone-400">
        {DESCRIPCION_FUENTE[c.fuente as Fuente]}
      </p>
    </div>
  )
}

/**
 * Recuadro de carga.
 *
 * Ocupa aproximadamente el mismo alto que el widget resuelto para que el
 * dashboard no salte cuando llega el dato.
 */
export function WidgetCotizacionCargando() {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-stone-700">
        <Icono nombre="divisas" tam={16} />
        Dólar oficial
      </h2>
      <div className="mt-2 h-7 w-32 animate-pulse rounded bg-stone-100" />
      <div className="mt-2 h-3 w-40 animate-pulse rounded bg-stone-100" />
      <p className="sr-only">Consultando la cotización…</p>
    </div>
  )
}
