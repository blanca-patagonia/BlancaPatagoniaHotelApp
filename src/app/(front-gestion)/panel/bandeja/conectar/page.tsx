import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { esDireccion } from '@/lib/domain/permisos'
import { CANALES_BANDEJA, ETIQUETAS_CANAL, resumenHorario } from '@/lib/domain/bandeja'
import { listarAjustesDeBandejas } from '@/lib/bandeja/consultas'
import { estadoDeCanales, type NivelConexion } from '@/lib/bandeja/conexion'
import { Encabezado, Etiqueta, Mensaje, Pagina, botonClases, type Tono } from '../../_components/ui'
import { IconoCanal } from '../icono-canal'
import { SubNavBandeja } from '../subnav'

/**
 * Canales: el estado de cada uno y el camino para conectarlo (ADR 0044).
 *
 * Es la pantalla que Chatwoot llama «Bandejas de entrada → Agregar»: una
 * tarjeta por canal, con qué falta y un solo botón. Está pensada para quien
 * conecta el canal por primera vez y no sabe qué es un webhook.
 */

const DESCRIPCION: Record<string, string> = {
  whatsapp: 'Los WhatsApp que le escriben al número del hotel.',
  instagram: 'Los mensajes directos de la cuenta de Instagram.',
  messenger: 'Los mensajes de la página de Facebook.',
  email: 'Los correos que llegan a la casilla de consultas.',
  telegram: 'Un bot de Telegram del hotel.',
  web: 'El chat «Hablar con recepción» del portal de reservas.',
}

const ETIQUETA_NIVEL: Record<NivelConexion, { texto: string; tono: Tono }> = {
  conectado: { texto: 'Conectado', tono: 'exito' },
  a_medias: { texto: 'A medias', tono: 'alerta' },
  sin_conectar: { texto: 'Sin conectar', tono: 'neutro' },
  siempre: { texto: 'Siempre activo', tono: 'exito' },
}

export default async function CanalesPage() {
  const sesion = await requerirAcceso('bandeja')
  const direccion = esDireccion(sesion.rol)
  const estados = estadoDeCanales(CANALES_BANDEJA)
  const ajustes = await listarAjustesDeBandejas()
  const porCanal = new Map(ajustes.datos.map((a) => [a.canal, a]))

  return (
    <Pagina>
      <Encabezado
        titulo="Canales"
        descripcion="Por dónde te escriben los huéspedes. Cada canal tiene su asistente paso a paso."
        icono="chat"
      />
      <SubNavBandeja direccion={direccion} />
      {ajustes.fallo && <Mensaje tono="error">No se pudieron leer los ajustes de los canales. Lo que ves puede estar incompleto.</Mensaje>}
      {!direccion && (
        <Mensaje tono="ok">Conectar un canal lo hace la dirección. Podés ver el estado de cada uno.</Mensaje>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {estados.map((e) => {
          const a = porCanal.get(e.canal)
          const n = ETIQUETA_NIVEL[e.nivel]
          return (
            <article key={e.canal} className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <header className="flex items-start gap-3">
                <IconoCanal canal={e.canal} tam={44} />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-stone-900">{ETIQUETAS_CANAL[e.canal]}</h2>
                  <p className="text-sm text-stone-600">{DESCRIPCION[e.canal]}</p>
                </div>
              </header>

              <div className="flex flex-wrap items-center gap-2">
                <Etiqueta tono={n.tono}>{n.texto}</Etiqueta>
                {a && !a.activa && <Etiqueta tono="peligro">Apagado</Etiqueta>}
                {e.nivel !== 'siempre' && (
                  <span className="text-xs text-stone-500">
                    {e.recibe ? 'Recibe' : 'No recibe'} · {e.responde ? 'responde' : 'no responde'}
                  </span>
                )}
              </div>

              {e.diagnostico?.indicacion && e.nivel === 'a_medias' && <p className="text-xs text-red-800">{e.diagnostico.indicacion}</p>}
              {a?.fuera_horario_activo && (
                <p className="text-xs text-stone-500">Atiende {resumenHorario({ desde: a.horario_desde, hasta: a.horario_hasta, dias: a.dias_atencion })}.</p>
              )}

              <div className="mt-auto">
                <Link href={`/panel/bandeja/conectar/${e.canal}`} className={botonClases(e.nivel === 'conectado' || e.nivel === 'siempre' ? 'secundario' : 'primario', 'w-full')}>
                  {e.nivel === 'conectado' || e.nivel === 'siempre' ? 'Ver y ajustar' : direccion ? 'Conectar' : 'Ver cómo se conecta'}
                </Link>
              </div>
            </article>
          )
        })}
      </div>
    </Pagina>
  )
}
