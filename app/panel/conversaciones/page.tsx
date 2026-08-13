import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { puedeAcceder } from '@/lib/domain/permisos'
import {
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  Kpi,
  Tarjeta,
  botonClases,
  Pagina,
  Mensaje,
} from '../_components/ui'
import { Chat, type MensajeVista } from './chat'
import { marcarConsultaRespondida } from './actions'

/** Cuántos mensajes se cargan del historial al abrir un canal. */
const HISTORIAL = 50

interface Canal {
  id: string
  clave: string
  nombre: string
  descripcion: string | null
}

interface Consulta {
  id: string
  pregunta: string
  contacto: string | null
  respondida: boolean
  creado_en: string
}

/**
 * Motivos con que las acciones de esta pantalla pueden volver por `?error=`.
 * El fallback cubre cualquiera que no esté acá.
 */
const MENSAJES_ERROR: Record<string, string> = {
  mensaje: 'No se pudo enviar el mensaje. Nadie del equipo lo recibió: probá de nuevo.',
  consulta: 'No se pudo marcar la consulta como atendida.',
}

export default async function ConversacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ canal?: string; vista?: string; error?: string }>
}) {
  const sesion = await requerirAcceso('conversaciones')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  // RLS ya filtra los canales por rol: lo que vuelve es lo que puede ver.
  const { data: canalesData } = await supabase
    .from('canales')
    .select('id, clave, nombre, descripcion')
    .order('creado_en')
  const canales = (canalesData ?? []) as Canal[]

  const verConsultas = sp.vista === 'consultas'
  const canalActivo = canales.find((c) => c.id === sp.canal) ?? canales[0]

  // Las consultas del bot las atiende quien tiene contacto con el huésped.
  const puedeVerConsultas = puedeAcceder(sesion.rol, 'reservas')

  const [{ data: mensajesData }, { data: perfilesData }, { data: consultasData }] =
    await Promise.all([
      canalActivo
        ? supabase
            .from('mensajes')
            .select('id, cuerpo, autor_id, creado_en')
            .eq('canal_id', canalActivo.id)
            .order('creado_en', { ascending: false })
            .limit(HISTORIAL)
        : Promise.resolve({ data: [] }),
      supabase.from('perfiles').select('id, nombre'),
      puedeVerConsultas
        ? supabase
            .from('consultas_bot')
            .select('id, pregunta, contacto, respondida, creado_en')
            .order('respondida')
            .order('creado_en', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] }),
    ])

  // Se piden del más nuevo al más viejo (para quedarse con los últimos) y se
  // invierten para mostrarlos en orden de conversación.
  const mensajes = ((mensajesData ?? []) as MensajeVista[]).slice().reverse()
  const nombres = Object.fromEntries(
    ((perfilesData ?? []) as { id: string; nombre: string }[]).map((p) => [p.id, p.nombre]),
  )
  const consultas = (consultasData ?? []) as Consulta[]
  const sinResponder = consultas.filter((c) => !c.respondida).length

  return (
    <Pagina>
      <Encabezado
        titulo="Conversaciones"
        descripcion="Chat interno del equipo por área, en tiempo real."
        icono="chat"
        acciones={
          puedeVerConsultas ? (
            <>
              <Chip href="/panel/conversaciones" activo={!verConsultas}>
                Canales
              </Chip>
              <Chip href="/panel/conversaciones?vista=consultas" activo={verConsultas}>
                Consultas del sitio {sinResponder > 0 && `(${sinResponder})`}
              </Chip>
            </>
          ) : null
        }
      />

      {sp.error && (
        <div className="mb-4">
          <Mensaje tono="error">
            {MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}
          </Mensaje>
        </div>
      )}

      {verConsultas && puedeVerConsultas ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Kpi
              titulo="Sin responder"
              valor={String(sinResponder)}
              detalle="consultas del asistente"
              icono="alerta"
              tono={sinResponder > 0 ? 'alerta' : 'exito'}
            />
            <Kpi
              titulo="Atendidas"
              valor={String(consultas.length - sinResponder)}
              detalle="ya resueltas"
              icono="ok"
              tono="exito"
            />
            <Kpi titulo="Total" valor={String(consultas.length)} detalle="registradas" icono="chat" />
          </div>

          <Tarjeta
            titulo="Consultas que el asistente no supo responder"
            descripcion="Preguntas del portal público que quedaron pendientes de contacto."
          >
            {consultas.length === 0 ? (
              <EstadoVacio
                titulo="No hay consultas pendientes"
                descripcion="Cuando el asistente del sitio no pueda responder algo, va a aparecer acá."
                icono="chat"
              />
            ) : (
              <ul>
                {consultas.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 border-t border-stone-100 px-5 py-3 first:border-0"
                  >
                    <div className="min-w-48 flex-1">
                      <p className={c.respondida ? 'text-stone-400 line-through' : 'text-stone-800'}>
                        {c.pregunta}
                      </p>
                      <p className="text-xs text-stone-400">
                        {new Date(c.creado_en).toLocaleString('es-AR')}
                        {c.contacto && ` · ${c.contacto}`}
                      </p>
                    </div>
                    {c.respondida ? (
                      <Etiqueta tono="exito">Atendida</Etiqueta>
                    ) : (
                      <form action={marcarConsultaRespondida}>
                        <input type="hidden" name="consulta_id" value={c.id} />
                        <button className={botonClases('secundario', 'px-2.5 py-1 text-xs')}>
                          Marcar atendida
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
          <nav aria-label="Canales" className="flex flex-row gap-2 lg:flex-col">
            {canales.map((c) => {
              const activo = c.id === canalActivo?.id
              return (
                <Link
                  key={c.id}
                  href={`/panel/conversaciones?canal=${c.id}`}
                  aria-current={activo ? 'page' : undefined}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition lg:flex-none ${
                    activo
                      ? 'bg-lago-700 text-white shadow-sm'
                      : 'bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50'
                  }`}
                >
                  <span className="block"># {c.nombre}</span>
                  {c.descripcion && (
                    <span
                      className={`mt-0.5 hidden text-xs lg:block ${activo ? 'text-lago-100' : 'text-stone-400'}`}
                    >
                      {c.descripcion}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          <Tarjeta
            titulo={canalActivo ? `# ${canalActivo.nombre}` : 'Sin canales'}
            descripcion={canalActivo?.descripcion ?? undefined}
            className="overflow-hidden"
          >
            {canalActivo ? (
              <Chat
                key={canalActivo.id}
                canalId={canalActivo.id}
                usuarioId={sesion.userId}
                iniciales={mensajes}
                nombres={nombres}
              />
            ) : (
              <EstadoVacio
                titulo="No tenés canales asignados"
                descripcion="Pedile a un administrador que te sume a un canal."
                icono="chat"
              />
            )}
          </Tarjeta>
        </div>
      )}
    </Pagina>
  )
}
