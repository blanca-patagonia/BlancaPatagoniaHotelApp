import type { DatosCanales } from '../_datos'
import { fechaHotel, formatoFechaCorta } from '@/lib/fechas'
import { BotonEnvio } from '../../_components/boton-envio'
import { CAMPO, Campo, EstadoVacio, Etiqueta, Tarjeta } from '../../_components/ui'
import { cargarMensaje, marcarMensajeAtendido } from '../mensajes.actions'

/** Vista «mensajes» de la pantalla de canales. Los datos los carga `_datos.ts`. */
export function VistaMensajes({ d }: { d: DatosCanales }) {
  const { entrantes, mensajes } = d
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Tarjeta
        titulo="Peticiones del huésped"
        descripcion="Un pedido sin atender termina siendo una queja en la reseña."
        className="lg:col-span-2"
      >
        {mensajes.length === 0 ? (
          <EstadoVacio
            titulo="No hay mensajes cargados"
            descripcion="Ni el informe CSV ni el feed iCal traen los mensajes de Booking: se cargan a mano acá al lado."
            icono="chat"
          />
        ) : (
          <ul className="divide-y divide-stone-100">
            {mensajes.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className={`text-sm ${m.atendido ? 'text-stone-500' : 'text-stone-800'}`}>
                    {m.cuerpo}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {m.entrante
                      ? `${m.entrante.huesped_apellido} · llega ${formatoFechaCorta(m.entrante.check_in)} · `
                      : ''}
                    {fechaHotel(m.recibido_en)}
                  </p>
                  {m.atendido && <Etiqueta tono="exito">Atendido</Etiqueta>}
                </div>
                <form action={marcarMensajeAtendido} className="shrink-0">
                  <input type="hidden" name="mensaje_id" value={m.id} />
                  <input type="hidden" name="atendido" value={String(m.atendido)} />
                  <BotonEnvio variante={m.atendido ? 'fantasma' : 'secundario'} cargando="…">
                    {m.atendido ? 'Reabrir' : 'Marcar atendido'}
                  </BotonEnvio>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta titulo="Cargar un mensaje">
        <form action={cargarMensaje} className="flex flex-col gap-3 p-5">
          {/*
                El autor era fijo en «huésped», así que el módulo guardaba media
                conversación: no había forma de registrar qué se le contestó. El `check`
                de la base ya permitía «hotel» desde el principio; solo faltaba
                ofrecerlo.
              */}
          <Campo etiqueta="Quién lo escribió">
            <select name="autor" defaultValue="huesped" className={CAMPO}>
              <option value="huesped">El huésped (un pedido)</option>
              <option value="hotel">El hotel (la respuesta)</option>
            </select>
          </Campo>
          <Campo
            etiqueta="Qué dice"
            ayuda="Cuna, llegada tardía, habitación en planta baja… o la respuesta que se le dio."
          >
            <textarea name="cuerpo" rows={4} required className={CAMPO} />
          </Campo>
          <Campo etiqueta="Reserva del canal (opcional)">
            <select name="entrante_id" defaultValue="" className={CAMPO}>
              <option value="">Sin asociar</option>
              {entrantes.slice(0, 50).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.huesped_apellido} — {formatoFechaCorta(e.check_in)}
                </option>
              ))}
            </select>
          </Campo>
          <BotonEnvio cargando="Guardando…" extra="w-full sm:w-auto">
            Guardar petición
          </BotonEnvio>
        </form>
      </Tarjeta>
    </div>
  )
}
