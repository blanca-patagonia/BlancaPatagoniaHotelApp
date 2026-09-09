import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { faltantes as articulosFaltantes } from '@/lib/domain/inventario'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { MONEDAS_EXTRANJERAS } from '@/lib/domain/divisas'
import { datosFiscales } from '@/lib/facturacion/emisor'
import { Encabezado, Etiqueta, Pagina, Tarjeta, botonClases } from '../_components/ui'
import { type NombreIcono } from '../_components/iconos'

interface Seccion {
  titulo: string
  descripcion: string
  href: string
  icono: NombreIcono
}

const SECCIONES: Seccion[] = [
  {
    titulo: 'Tarifario',
    descripcion: 'Precios neto y rack por tipo de unidad y temporada.',
    href: '/panel/config/tarifario',
    icono: 'reservas',
  },
  {
    titulo: 'Temporadas',
    descripcion: 'Fechas de cada temporada. Sin cobertura completa, una reserva puede salir en cero.',
    href: '/panel/config/temporadas',
    icono: 'montana',
  },
  {
    titulo: 'Inventario',
    descripcion: 'Productos y servicios que se cargan a la cuenta del huésped, con su stock.',
    href: '/panel/config/inventario',
    icono: 'objetos',
  },
  {
    titulo: 'Plantillas de correo',
    descripcion: 'Los textos que recibe el huésped en cada aviso automático.',
    href: '/panel/config/plantillas',
    icono: 'avisos',
  },
  {
    titulo: 'Cotización de divisas',
    descripcion: 'El valor del dólar y otras monedas para mostrar los importes en pesos.',
    href: '/panel/config/divisas',
    icono: 'divisas',
  },
  {
    titulo: 'Datos fiscales',
    descripcion: 'CUIT y razón social del hotel como emisor de comprobantes.',
    href: '/panel/config/datos-fiscales',
    icono: 'contratos',
  },
  {
    titulo: 'Ubicación de las unidades',
    descripcion: 'Bloque, piso y orden de recorrido, para housekeeping y la grilla de ocupación.',
    href: '/panel/config/ubicaciones',
    icono: 'ocupacion',
  },
  {
    titulo: 'Conexiones',
    descripcion: 'Vincular Mercado Pago, el correo, Booking y Expedia sin pegar claves a mano.',
    href: '/panel/config/conexiones',
    icono: 'canales',
  },
]

/**
 * Índice de configuración.
 *
 * Reemplaza la pantalla única de seis secciones apiladas (tarifario,
 * plantillas, inventario, datos fiscales, divisas y ubicaciones) por un punto
 * de partida con una tarjeta por tema. Mismo criterio que el índice de
 * Reportes: cada tema tiene su propia dirección y sus propios filtros, en vez
 * de competir por espacio en un scroll larguísimo.
 */
export default async function ConfigPage() {
  await requerirAcceso('config')
  const supabase = await crearClienteServidor()

  const [{ count: tarifasCount }, { data: productosData }, vigentes, datosF] = await Promise.all([
    supabase.from('tarifas').select('id', { count: 'exact', head: true }),
    supabase.from('productos_servicios').select('id, stock, stock_minimo, activo').eq('activo', true),
    Promise.all(MONEDAS_EXTRANJERAS.map((m) => cotizacionVigente(m))),
    datosFiscales(supabase),
  ])

  const bajos = articulosFaltantes(productosData ?? [])
  const divisaConAdvertencia = vigentes.some((v) => v?.requiereAdvertencia)

  const AVISOS: Partial<Record<string, { texto: string; tono: 'peligro' | 'alerta' }>> = {
    '/panel/config/tarifario': !tarifasCount
      ? { texto: 'sin tarifas cargadas', tono: 'peligro' }
      : undefined,
    '/panel/config/inventario':
      bajos.length > 0 ? { texto: `${bajos.length} con stock bajo`, tono: 'alerta' } : undefined,
    '/panel/config/divisas': divisaConAdvertencia
      ? { texto: 'cotización vencida', tono: 'peligro' }
      : undefined,
    '/panel/config/datos-fiscales': !datosF ? { texto: 'sin cargar', tono: 'alerta' } : undefined,
  }

  return (
    <Pagina>
      <Encabezado
        titulo="Configuración"
        descripcion="Tarifas, temporadas, inventario, plantillas, divisas y datos del hotel."
        icono="config"
      />

      <div className="gap-4 sm:columns-2 xl:columns-3">
        {SECCIONES.map((s) => {
          const aviso = AVISOS[s.href]
          return (
            <Tarjeta key={s.href} className="mb-4 break-inside-avoid">
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-stone-900">{s.titulo}</h3>
                  {aviso && <Etiqueta tono={aviso.tono}>{aviso.texto}</Etiqueta>}
                </div>
                <p className="mt-1.5 text-sm text-stone-600">{s.descripcion}</p>
                <div className="mt-4">
                  <Link
                    href={s.href}
                    className={botonClases('primario', 'w-full justify-center sm:w-auto')}
                  >
                    Abrir
                  </Link>
                </div>
              </div>
            </Tarjeta>
          )
        })}
      </div>
    </Pagina>
  )
}
