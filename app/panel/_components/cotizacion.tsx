import { cotizacionVigente } from '@/lib/divisas/servicio'
import { obtenerDolarBlueInformativo, obtenerDolarBancoNacionInformativo } from '@/lib/divisas'
import { CotizacionCliente } from './cotizacion-cliente'
import { Icono } from './iconos'

/**
 * Widget de cotización del dólar para el panel.
 *
 * ── Por qué es un componente async aparte y no parte del dashboard ──────────
 *
 * Resolver la cotización puede implicar hasta tres llamadas a APIs externas
 * (oficial, blue, Banco Nación), cada una con hasta 3 s de espera. Si eso
 * viviera dentro de `app/panel/page.tsx`, el dashboard entero —ocupación,
 * llegadas, salidas, avisos— quedaría esperando por un número accesorio. Va
 * envuelto en `<Suspense>` desde el llamador: el panel se pinta enseguida y
 * el recuadro de la cotización se completa cuando llega.
 *
 * Esta primera carga es server-side. Después, `CotizacionCliente` toma la
 * posta y se refresca sola cada 5 minutos sin volver a pedirle nada al
 * servidor de página — ver su propio comentario.
 */
export async function WidgetCotizacion() {
  const [vigente, blue, bancoNacion] = await Promise.all([
    cotizacionVigente('ARS'),
    obtenerDolarBlueInformativo(),
    obtenerDolarBancoNacionInformativo(),
  ])

  return <CotizacionCliente inicial={{ vigente, blue, bancoNacion }} />
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
