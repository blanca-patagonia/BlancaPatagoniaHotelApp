import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { esDireccion } from '@/lib/domain/permisos'
import { ETIQUETAS_CANAL, ETIQUETAS_ESTADO, nombreDeContacto } from '@/lib/domain/bandeja'
import { ETIQUETAS_ESTADO_RESERVA } from '@/lib/domain/reservas'
import { leerContacto } from '@/lib/bandeja/consultas'
import { fechaHoraHotel, fechaHotel } from '@/lib/fechas'
import { Encabezado, Etiqueta, Mensaje, Pagina, Tarjeta, botonClases } from '../../../_components/ui'
import { IconoCanal } from '../../icono-canal'
import { FormContacto } from '../../form-contacto'
import { SubNavBandeja } from '../../subnav'

/** Todo lo de un contacto: sus datos, por dónde escribió, sus conversaciones y, si es huésped, sus reservas. */
export default async function ContactoPage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requerirAcceso('bandeja')
  const { id } = await params
  const { datos, fallo } = await leerContacto(id)

  if (fallo && !datos.contacto) {
    return (
      <Pagina>
        <Mensaje tono="error">No se pudo leer el contacto. Recargá la página.</Mensaje>
      </Pagina>
    )
  }
  if (!datos.contacto) notFound()
  const c = datos.contacto

  return (
    <Pagina>
      <Encabezado
        titulo={nombreDeContacto(c)}
        descripcion={`Contacto desde el ${fechaHotel(c.creado_en)}${c.bloqueado ? ' · bloqueado' : ''}`}
        icono="huespedes"
        acciones={
          <Link href="/panel/bandeja/contactos" className={botonClases('secundario')}>
            Todos los contactos
          </Link>
        }
      />
      <SubNavBandeja direccion={esDireccion(sesion.rol)} />
      {fallo && <Mensaje tono="error">Parte de la información no se pudo leer. Lo que ves puede estar incompleto.</Mensaje>}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Tarjeta titulo="Datos">
            <FormContacto contacto={c} />
          </Tarjeta>
          <Tarjeta titulo="Por dónde escribió">
            <ul className="space-y-2 text-sm">
              {c.crm_identidades.map((i) => (
                <li key={`${i.crm_bandejas.canal}-${i.externo_id}`} className="flex items-center gap-2.5">
                  <IconoCanal canal={i.crm_bandejas.canal} tam={28} />
                  <span>
                    {ETIQUETAS_CANAL[i.crm_bandejas.canal]}
                    <span className="block text-xs break-all text-stone-500">{i.crm_bandejas.canal === 'web' ? 'Chat del portal' : i.externo_id}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>

        <div className="space-y-5">
          <Tarjeta titulo="Conversaciones">
            {datos.conversaciones.length === 0 ? (
              <p className="text-sm text-stone-500">Sin conversaciones.</p>
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {datos.conversaciones.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/panel/bandeja?c=${v.id}&estado=${v.estado}`} className="text-lago-700 underline">
                      #{v.numero} · {ETIQUETAS_CANAL[v.crm_bandejas.canal]}
                    </Link>
                    <span className="text-xs text-stone-500">{fechaHoraHotel(v.ultima_actividad_en)}</span>
                    <Etiqueta tono={v.estado === 'resuelta' ? 'exito' : 'lago'}>{ETIQUETAS_ESTADO[v.estado]}</Etiqueta>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta titulo="Huésped">
            {datos.huesped ? (
              <div className="space-y-2 text-sm">
                <Link href={`/panel/huespedes/${datos.huesped.id}`} className="font-medium text-lago-700 underline">
                  {`${datos.huesped.nombre ?? ''} ${datos.huesped.apellido ?? ''}`.trim() || 'Ver ficha'}
                </Link>
                {datos.reservas.length === 0 ? (
                  <p className="text-stone-500">Sin reservas.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {datos.reservas.map((r) => {
                      const e = r.estadias?.[0]
                      return (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                          <Link href={`/panel/reservas/${r.id}`} className="font-mono text-xs text-lago-700 underline">
                            {r.codigo}
                          </Link>
                          <span className="text-xs text-stone-600">{e ? `${fechaHotel(e.check_in)} → ${fechaHotel(e.check_out)}` : ''}</span>
                          <Etiqueta>{ETIQUETAS_ESTADO_RESERVA[r.estado] ?? r.estado}</Etiqueta>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-stone-600">Todavía no es huésped: no está vinculado a ninguna ficha. Se vincula desde una de sus conversaciones.</p>
            )}
          </Tarjeta>
        </div>
      </div>
    </Pagina>
  )
}
