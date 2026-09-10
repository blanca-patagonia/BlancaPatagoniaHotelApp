import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import { importe } from '@/lib/domain/moneda'
import { registrarFalla } from '@/lib/acciones'
import {
  Encabezado,
  EstadoVacio,
  FILA,
  Mensaje,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  Pagina,
} from '../../_components/ui'
import { FilaTarifario } from '../fila-tarifario'

interface TarifaRow {
  id: string
  precio_neto: number | string
  precio_rack: number | string
  tipo: {
    codigo: string
    nombre: string
    categoria: CategoriaUnidad
    capacidad_max: number
  } | null
  temporada: { codigo: string; nombre: string; orden: number } | null
}

const ORDEN_TEMP = ['baja', 'media', 'alta']

export default async function TarifarioPage() {
  const sesion = await requerirAcceso('config')
  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const supabase = await crearClienteServidor()

  const { data, error } = await supabase
    .from('tarifas')
    .select(
      'id, precio_neto, precio_rack, tipo:tipos_unidad(codigo, nombre, categoria, capacidad_max), temporada:temporadas(codigo, nombre, orden)',
    )
  // Alto impacto: la Fase 18 ya tuvo el bug más caro del sistema («USD 0» al
  // reservar) por falta de tarifas cargadas. Una tabla vacía por fallo de
  // lectura es indistinguible de un tarifario sin cargar si no se avisa.
  registrarFalla(error, 'config:tarifario')

  const tarifas = (data ?? []) as unknown as TarifaRow[]

  // tipoCodigo -> { datos del tipo, temporadaCodigo -> tarifa }
  const porTipo = new Map<
    string,
    {
      nombre: string
      categoria: CategoriaUnidad
      cap: number
      precios: Map<string, { id: string; neto: number; rack: number }>
    }
  >()
  for (const t of tarifas) {
    if (!t.tipo || !t.temporada) continue
    const entry = porTipo.get(t.tipo.codigo) ?? {
      nombre: t.tipo.nombre,
      categoria: t.tipo.categoria,
      cap: t.tipo.capacidad_max,
      precios: new Map(),
    }
    entry.precios.set(t.temporada.codigo, {
      id: t.id,
      neto: Number(t.precio_neto),
      rack: Number(t.precio_rack),
    })
    porTipo.set(t.tipo.codigo, entry)
  }

  const filas = [...porTipo.values()].sort((a, b) =>
    a.categoria !== b.categoria
      ? a.categoria.localeCompare(b.categoria)
      : a.nombre.localeCompare(b.nombre),
  )

  return (
    <Pagina>
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Tarifario"
        descripcion="Precios en USD sin IVA · Neto = agencia · Rack = mostrador"
        icono="config"
        acciones={
          /* Tener precios no alcanza: si la fecha de la reserva no cae en
             ninguna temporada, no hay tarifa que aplicar. Esa pantalla estaba
             ausente y el sistema fallaba sin explicar por qué. */
          <Link href="/panel/config/temporadas" className={botonClases('secundario')}>
            Fechas de cada temporada
          </Link>
        }
      />

      {error && (
        <Mensaje tono="error">
          No se pudo leer el tarifario — si esta tabla aparece vacía, NO es necesariamente
          que falten tarifas cargadas. Recargá antes de asumir nada.
        </Mensaje>
      )}

      <Tarjeta className="overflow-hidden">
        {filas.length === 0 ? (
          <EstadoVacio titulo="No hay tarifas cargadas" icono="config" />
        ) : (
          <Tabla resumen="Tarifas por tipo de unidad y temporada, con precio neto y rack">
            <thead>
              <tr>
                <th className={TH}>Tipo</th>
                <th className={TH}>Cap.</th>
                <th className={TH}>Precios por temporada</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) =>
                puedeEditar ? (
                  <FilaTarifario
                    key={f.nombre}
                    nombre={f.nombre}
                    categoria={f.categoria}
                    cap={f.cap}
                    precios={Object.fromEntries(f.precios)}
                  />
                ) : (
                  <tr key={f.nombre} className={FILA}>
                    <td className={TD}>
                      <span className="font-medium text-stone-800">{f.nombre}</span>
                      <span className="ml-2 text-xs text-stone-600">
                        {ETIQUETAS_CATEGORIA[f.categoria]}
                      </span>
                    </td>
                    <td className={`${TD} tabular text-stone-600`}>{f.cap}</td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center gap-3">
                        {ORDEN_TEMP.map((t) => {
                          const p = f.precios.get(t)
                          return (
                            <div key={t} className="rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
                              <p className="text-xs font-medium text-stone-500 capitalize">Temporada {t}</p>
                              {p ? (
                                <p className="tabular text-sm text-stone-800">
                                  <span className="font-semibold text-stone-900">{importe(p.rack)}</span>
                                  <span className="text-stone-500"> rack · {importe(p.neto)} neto</span>
                                </p>
                              ) : (
                                <p className="text-sm text-stone-300">Sin tarifa</p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      {!puedeEditar && (
        <p className="mt-2 text-xs text-stone-600">
          Tu rol puede consultar el tarifario, pero no modificarlo.
        </p>
      )}
    </Pagina>
  )
}
