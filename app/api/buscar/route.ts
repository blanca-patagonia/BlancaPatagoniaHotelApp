import { requerirSesion } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { buscarGlobal } from '@/lib/busqueda/servicio'
import { formatoFechaCorta, parsearPeriodo } from '@/lib/fechas'
import { ETIQUETAS_ESTADO_RESERVA } from '@/lib/domain/reservas'
import { ETIQUETAS_AMBITO } from '@/lib/domain/busqueda'

/**
 * Búsqueda global en vivo: `GET /api/buscar?q=`.
 *
 * Lo consume el combobox del encabezado (`buscador-global.tsx`) mientras se
 * escribe, con un debounce corto del lado del cliente. Usa exactamente la
 * misma consulta que `/panel/buscar` (`buscarGlobal`, en `lib/busqueda/`) —
 * los resultados en vivo y los de la página completa tienen que coincidir
 * siempre, no ser dos búsquedas que con el tiempo empiecen a divergir.
 *
 * El tope acá es más chico que en la página completa: esto es un adelanto
 * para elegir rápido, no el lugar para revisar 8 resultados por categoría.
 * "Ver todos los resultados" en el combobox manda a la página completa, que
 * sigue mostrando hasta `TOPE_BUSQUEDA`.
 *
 * Exige sesión por el mismo motivo que `/api/cotizacion`: la consulta usa el
 * cliente del usuario (respeta RLS), pero un endpoint anónimo que dispara
 * consultas a la base sigue siendo una puerta que no hace falta dejar abierta.
 */

export const dynamic = 'force-dynamic'

const TOPE_EN_VIVO = 5

export async function GET(req: Request) {
  const sesion = await requerirSesion()

  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? undefined

  const supabase = await crearClienteServidor()
  const resultado = await buscarGlobal(supabase, sesion.rol, q, TOPE_EN_VIVO)

  return Response.json(
    {
      termino: resultado.termino,
      total: resultado.total,
      secciones: resultado.secciones.map((s) => ({
        id: `seccion-${s.area}`,
        href: s.href,
        titulo: s.titulo,
        detalle: s.motivo ? `Coincide con «${s.motivo}»` : s.descripcion,
      })),
      glosario: resultado.glosario.map((t) => ({
        id: `glosario-${t.termino}`,
        href: t.href,
        titulo: t.termino,
        detalle: t.definicion,
      })),
      reservas: resultado.reservas.map((r) => {
        const p = r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo) : null
        return {
          id: `reserva-${r.id}`,
          href: `/panel/reservas/${r.id}`,
          titulo: r.codigo,
          detalle: [
            r.huesped ? `${r.huesped.apellido}, ${r.huesped.nombre}` : 'Sin huésped',
            p ? `${formatoFechaCorta(p.desde)} → ${formatoFechaCorta(p.hasta)}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          etiqueta: ETIQUETAS_ESTADO_RESERVA[r.estado],
        }
      }),
      huespedes: resultado.huespedes.map((h) => ({
        id: `huesped-${h.id}`,
        href: `/panel/huespedes/${h.id}`,
        titulo: `${h.apellido}, ${h.nombre}`,
        detalle: [h.email, h.doc_numero].filter(Boolean).join(' · ') || 'sin datos de contacto',
      })),
      agencias: resultado.agencias.map((a) => ({
        id: `agencia-${a.id}`,
        href: `/panel/agencias/${a.id}`,
        titulo: a.nombre,
        detalle: ETIQUETAS_AMBITO.agencias,
      })),
      proveedores: resultado.proveedores.map((p) => ({
        id: `proveedor-${p.id}`,
        href: `/panel/proveedores/${p.id}`,
        titulo: p.nombre,
        detalle: p.rubro || ETIQUETAS_AMBITO.proveedores,
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
