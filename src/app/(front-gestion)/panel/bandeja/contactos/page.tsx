import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { esDireccion } from '@/lib/domain/permisos'
import { nombreDeContacto } from '@/lib/domain/bandeja'
import { deLista } from '@/lib/domain/listas'
import { listarContactos, SEGMENTOS_CONTACTO } from '@/lib/bandeja/consultas'
import { construirQuery, paginaActual, rangoDePagina, terminoBusqueda, TAMANIO_PAGINA } from '@/lib/listados'
import { fechaHotel } from '@/lib/fechas'
import { Buscador, Chip, COL_SECUNDARIA, Encabezado, EstadoVacio, Etiqueta, FILA, Mensaje, Pagina, Paginacion, Tabla, TD, TH } from '../../_components/ui'
import { IconoCanal } from '../icono-canal'
import { SubNavBandeja } from '../subnav'

/**
 * Contactos: todas las personas que escribieron alguna vez (Chatwoot: Contacts).
 *
 * Es la vista de CRM de la bandeja. Un contacto es quien escribe —por uno o por
 * varios canales— y puede ser un HUÉSPED (tiene ficha y reservas) o un
 * INTERESADO que todavía no reservó. La diferencia es lo que le interesa a
 * ventas: a quién le escribió y nunca reservó.
 */

const ETIQUETA_SEGMENTO: Record<(typeof SEGMENTOS_CONTACTO)[number], string> = {
  todos: 'Todos',
  huespedes: 'Huéspedes',
  interesados: 'Interesados',
  bloqueados: 'Bloqueados',
}

export default async function ContactosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sesion = await requerirAcceso('bandeja')
  const sp = await searchParams
  const segmento = deLista(SEGMENTOS_CONTACTO, sp.segmento) ?? 'todos'
  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)
  const termino = terminoBusqueda(sp.q)
  const { datos, fallo } = await listarContactos({ termino, segmento, desde, hasta })
  const filtros = { segmento: segmento === 'todos' ? undefined : segmento, q: sp.q }

  return (
    <Pagina>
      <Encabezado titulo="Contactos" descripcion="Todas las personas que escribieron por algún canal, con lo que hablaron y si ya son huéspedes." icono="huespedes" />
      <SubNavBandeja direccion={esDireccion(sesion.rol)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5" aria-label="Segmento">
          {SEGMENTOS_CONTACTO.map((s) => (
            <Chip key={s} href={`/panel/bandeja/contactos${construirQuery({ q: sp.q }, { segmento: s === 'todos' ? undefined : s })}`} activo={segmento === s}>
              {ETIQUETA_SEGMENTO[s]}
            </Chip>
          ))}
        </div>
        <div className="sm:ml-auto">
          <Buscador accion="/panel/bandeja/contactos" valor={sp.q} etiqueta="Buscar contactos" placeholder="Nombre, email o teléfono" ocultos={{ segmento: filtros.segmento }} />
        </div>
      </div>

      {fallo && <Mensaje tono="error">No se pudieron leer los contactos. Lo que ves puede estar incompleto: recargá la página.</Mensaje>}

      {!fallo && datos.filas.length === 0 ? (
        <EstadoVacio icono="huespedes" titulo={termino ? 'Ningún contacto coincide' : 'Todavía no hay contactos'} descripcion="Aparecen solos cuando alguien escribe por un canal conectado." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <Tabla resumen="Contactos de la bandeja de mensajes">
            <thead>
              <tr>
                <th className={TH}>Contacto</th>
                <th className={`${TH} ${COL_SECUNDARIA}`}>Canales</th>
                <th className={TH}>Huésped</th>
                <th className={`${TH} ${COL_SECUNDARIA}`}>Conversaciones</th>
                <th className={`${TH} ${COL_SECUNDARIA}`}>Última actividad</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((c) => {
                const canales = [...new Set(c.crm_identidades.map((i) => i.crm_bandejas.canal))]
                return (
                  <tr key={c.id} className={FILA}>
                    <td className={TD}>
                      <Link href={`/panel/bandeja/contactos/${c.id}`} className="font-medium text-lago-700 hover:underline">
                        {nombreDeContacto(c)}
                      </Link>
                      <span className="block text-xs text-stone-500">{[c.email, c.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</span>
                      <span className="mt-1 flex gap-1 sm:hidden">
                        {canales.map((canal) => (
                          <IconoCanal key={canal} canal={canal} tam={20} />
                        ))}
                      </span>
                    </td>
                    <td className={`${TD} ${COL_SECUNDARIA}`}>
                      <span className="flex gap-1">
                        {canales.map((canal) => (
                          <IconoCanal key={canal} canal={canal} tam={24} />
                        ))}
                      </span>
                    </td>
                    <td className={TD}>
                      {c.bloqueado ? (
                        <Etiqueta tono="peligro">Bloqueado</Etiqueta>
                      ) : c.huesped_id ? (
                        <Link href={`/panel/huespedes/${c.huesped_id}`}>
                          <Etiqueta tono="exito">Huésped</Etiqueta>
                        </Link>
                      ) : (
                        <Etiqueta tono="neutro">Interesado</Etiqueta>
                      )}
                    </td>
                    <td className={`${TD} ${COL_SECUNDARIA} tabular`}>{c.crm_conversaciones[0]?.count ?? 0}</td>
                    <td className={`${TD} ${COL_SECUNDARIA} text-sm text-stone-600`}>{c.ultima_actividad_en ? fechaHotel(c.ultima_actividad_en) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </Tabla>
          <Paginacion base="/panel/bandeja/contactos" params={filtros} pagina={pagina} total={datos.total} tamanio={TAMANIO_PAGINA} />
        </div>
      )}
    </Pagina>
  )
}
