import Link from 'next/link'
import { esDireccion } from '@/lib/domain/permisos'
import { requerirAcceso } from '@/lib/auth/session'
import { textoAntiguedad } from '@/lib/domain/divisas'
import { fechaHoraHotel } from '@/lib/fechas'
import { construirQuery, mensajeDe } from '@/lib/listados'
import { Icono } from '../_components/iconos'
import { BotonEnvio } from '../_components/boton-envio'
import { Chip, Encabezado, Kpi, Mensaje, Pagina, Tarjeta, botonClases } from '../_components/ui'
import { ImportarCsv } from './importar-csv'
import { sincronizarCanal } from './actions'
import { horasDesde, VISTAS, ETIQUETAS_VISTA, MENSAJES_ERROR } from './_compartido'
import { cargarDatosCanales } from './_datos'
import { VistaEntrantes } from './_vistas/entrantes'
import { VistaCobros } from './_vistas/cobros'
import { VistaCostos } from './_vistas/costos'
import { VistaMensajes } from './_vistas/mensajes'
import { VistaResenas } from './_vistas/resenas'
import { VistaPublicacion } from './_vistas/publicacion'
import { VistaCalendario } from './_vistas/calendario'

/**
 * Canales de venta: el panel único de lo que llega de Booking.
 *
 * Tres vistas —reservas entrantes, mensajes y reseñas— más el estado de la
 * sincronización. Es lo que pedía el objetivo: ver en un mismo lugar las
 * llegadas, salidas y estancias del canal, los pedidos del huésped y las reseñas.
 *
 * ⚠️ **La advertencia de arriba no es decorativa.** Los dos proveedores que se
 * pueden usar sin ser partner certificado (CSV e iCal) son de solo lectura: nadie
 * le informa a Booking qué queda libre, así que Booking **puede vender una unidad
 * que el mostrador ya vendió**. Sin decirlo en pantalla, alguien va a creer que
 * está cubierto porque «el sistema sincroniza con Booking».
 */
export default async function CanalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string
    estado?: string
    error?: string
    ok?: string
    codigo?: string
    nuevas?: string
    actualizadas?: string
    rechazadas?: string
    mes?: string
  }>
}) {
  const sesion = await requerirAcceso('canales')
  const sp = await searchParams
  const datos = await cargarDatosCanales(sesion, sp)
  const {
    capacidades,
    conConflicto,
    conteo,
    fallaConflictos,
    fallaLectura,
    fallaSaldos,
    proveedor,
    sinAtender,
    sinResponder,
    ultima,
    vista,
  } = datos

  return (
    <Pagina ancho="ancho">
      <Encabezado
        titulo="Canales de venta"
        descripcion="Reservas, mensajes y reseñas que llegan de Booking."
        icono="canales"
        acciones={
          <>
            {esDireccion(sesion.rol) && (
              <Link href="/panel/canales/externos" className={botonClases('secundario')}>
                Channel managers
              </Link>
            )}
            {capacidades.traeReservas && (
              <form action={sincronizarCanal}>
                <BotonEnvio variante="secundario" cargando="Sincronizando…">
                  <Icono nombre="siguiente" tam={16} />
                  Sincronizar ahora
                </BotonEnvio>
              </form>
            )}
          </>
        }
      />

      {sp.error && (
        <Mensaje tono="error">{mensajeDe(MENSAJES_ERROR, sp.error, 'Ocurrió un error.')}</Mensaje>
      )}
      {fallaConflictos && (
        <Mensaje tono="error">
          No se pudo verificar el posible overbooking de canal — el KPI de abajo no es confiable.
          Revisá las reservas entrantes a mano antes de confirmar algo.
        </Mensaje>
      )}
      {!fallaConflictos && (fallaLectura || fallaSaldos) && (
        <Mensaje tono="error">
          No se pudo cargar toda la información de canales (mensajes, reseñas, cargos, configuración
          o el saldo de cobro de las reservas importadas) — algunos datos de esta pantalla pueden
          faltar.
        </Mensaje>
      )}
      {sp.ok === 'sincro' && (
        <Mensaje tono="ok">
          Sincronización lista: {sp.nuevas ?? 0} nueva(s), {sp.actualizadas ?? 0} actualizada(s),{' '}
          {sp.rechazadas ?? 0} rechazada(s).
        </Mensaje>
      )}
      {sp.ok === 'importada' && (
        <Mensaje tono="ok">Reserva {sp.codigo} creada a partir de la del canal.</Mensaje>
      )}
      {sp.ok === 'restriccion' && (
        <Mensaje tono="ok">Restricción guardada. Sale en la próxima publicación al canal.</Mensaje>
      )}
      {sp.ok === 'restriccion_borrada' && (
        <Mensaje tono="ok">Restricción levantada: esas fechas vuelven a la venta normal.</Mensaje>
      )}
      {sp.ok === 'importada_con_aviso' && (
        <Mensaje tono="ok">
          Reserva {sp.codigo} creada. El importe del canal no coincide con la cuenta del hotel — el
          detalle quedó anotado en la fila.
        </Mensaje>
      )}
      {sp.ok === 'ignorada' && <Mensaje tono="ok">Reserva descartada.</Mensaje>}
      {sp.ok === 'reintentar' && <Mensaje tono="ok">Quedó lista para volver a importar.</Mensaje>}
      {sp.ok === 'mensaje' && <Mensaje tono="ok">Mensaje guardado.</Mensaje>}
      {sp.ok === 'resena' && <Mensaje tono="ok">Reseña guardada.</Mensaje>}
      {sp.ok === 'respuesta' && <Mensaje tono="ok">Respuesta guardada.</Mensaje>}
      {sp.ok === 'mapeo' && (
        <Mensaje tono="ok">Guardado. Se usa para importar y para publicar.</Mensaje>
      )}
      {sp.ok === 'publicado' && (
        <Mensaje tono="ok">Disponibilidad publicada. El detalle está más abajo.</Mensaje>
      )}
      {sp.ok === 'publicado_sin_efecto' && (
        <Mensaje tono="ok">
          Se calculó la disponibilidad y quedó registrada, pero no salió a ningún lado: el proveedor
          configurado no puede publicarle al canal. El motivo está más abajo.
        </Mensaje>
      )}
      {sp.ok === 'conciliar' && (
        <Mensaje tono="ok">Estado de conciliación guardado, con tu nombre y la fecha.</Mensaje>
      )}
      {sp.ok === 'factura' && (
        <Mensaje tono="ok">
          Factura registrada: quedó la deuda con el proveedor y la línea comparable contra lo
          devengado.
        </Mensaje>
      )}

      {/* ── La advertencia que no puede faltar ────────────────────────────────
          Sin esto alguien va a creer que está cubierto porque «el sistema
          sincroniza con Booking». Va con ícono Y texto, arriba de todo. */}
      {!capacidades.publicaDisponibilidad && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-lenga-50 px-4 py-3 ring-1 ring-lenga-200">
          <span className="mt-0.5 shrink-0 text-lenga-700">
            <Icono nombre="alerta" tam={18} />
          </span>
          <div className="text-sm text-lenga-900">
            <p className="font-semibold">
              Esta sincronización es de una sola dirección: no evita el overbooking.
            </p>
            <p className="mt-1 text-lenga-800">
              Traemos las reservas de Booking, pero{' '}
              <strong>no le informamos qué queda libre</strong>. Booking puede vender una unidad que
              el mostrador ya vendió. Para sincronizar en las dos direcciones hace falta un{' '}
              <em>channel manager</em> — es una contratación del hotel, no algo que se resuelva con
              código.
            </p>
            {/*
              El matiz que suma el feed iCal de salida (ADR 0022), sin borrar nada de
              lo anterior. Que exista un calendario publicado no cambia el hecho de
              fondo: el canal lo lee cuando quiere y nadie confirma que lo aplicó.
            */}
            <p className="mt-1 text-lenga-800">
              Lo que sí se puede hacer es{' '}
              <Link
                href={`/panel/canales${construirQuery({ vista: 'calendario' })}`}
                className="font-semibold underline"
              >
                publicarle el calendario de ocupación
              </Link>{' '}
              para que cierre fechas solo en vez de cerrarlas a mano.{' '}
              <strong>Angosta la ventana, no la cierra:</strong> el canal lo lee cada varias horas y
              nadie avisa si dejó de leerlo.
            </p>
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          titulo="Sin importar"
          valor={String(conteo.get('pendiente') ?? 0)}
          detalle="esperando revisión"
          icono="reservas"
          tono="alerta"
          href={`/panel/canales${construirQuery({ estado: 'pendiente' })}`}
        />
        <Kpi
          titulo="Con problema"
          valor={String(conteo.get('error') ?? 0)}
          detalle="no se pudieron importar"
          icono="alerta"
          tono="peligro"
          href={`/panel/canales${construirQuery({ estado: 'error' })}`}
        />
        {/*
          El KPI que no existía y es el más caro del módulo.

          NO evita el overbooking —eso exige publicarle disponibilidad a Booking, o sea
          un channel manager (ADR 0021)— pero lo hace visible el mismo día en que el
          informe entra, en vez de cuando alguien aprieta «Importar» o, peor, en el
          check-in con el huésped en la puerta.
        */}
        <Kpi
          titulo="Posible overbooking"
          valor={fallaConflictos ? '—' : String(conConflicto)}
          detalle={
            fallaConflictos
              ? 'no se pudo verificar'
              : conConflicto > 0
                ? 'el canal vendió de más'
                : 'el cupo cierra'
          }
          icono="alerta"
          tono={fallaConflictos || conConflicto > 0 ? 'peligro' : undefined}
        />
        <Kpi
          titulo="Mensajes sin atender"
          valor={String(sinAtender)}
          detalle="peticiones del huésped"
          icono="chat"
          href="/panel/canales?vista=mensajes"
        />
        <Kpi
          titulo="Reseñas sin responder"
          valor={String(sinResponder)}
          detalle="publicadas en el canal"
          icono="firma"
          href="/panel/canales?vista=resenas"
        />
      </div>

      {/* Estado del proveedor: qué está configurado y qué sabe hacer. */}
      <Tarjeta titulo="Estado de la sincronización">
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="text-sm">
            <p className="text-stone-600">
              Proveedor: <strong className="text-stone-900">{proveedor.nombre}</strong>
              {!proveedor.esReal() && (
                <span className="ml-2 text-xs text-stone-500">
                  (simulado — no consulta ningún canal)
                </span>
              )}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-stone-600">
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.traeReservas ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.traeReservas
                  ? 'Trae reservas automáticamente'
                  : 'No trae reservas solo: hay que subir el informe CSV'}
              </li>
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.publicaDisponibilidad ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.publicaDisponibilidad
                  ? 'Publica disponibilidad al canal'
                  : 'No publica disponibilidad (el canal puede sobrevender)'}
              </li>
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.trae.importes ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.trae.importes
                  ? 'Informa importes y comisión'
                  : 'No informa importes: el total lo calcula el hotel'}
              </li>
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.trae.contacto ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.trae.contacto
                  ? 'Informa email y teléfono'
                  : 'No informa contacto del huésped'}
              </li>
            </ul>
          </div>

          <div className="text-sm">
            {ultima ? (
              <>
                <p className="text-stone-600">
                  Última sincronización:{' '}
                  <strong className="text-stone-900">{fechaHoraHotel(ultima.corrida_en)}</strong>
                </p>
                <p className="mt-1 text-xs text-stone-600">
                  {ultima.proveedor}
                  {ultima.origen ? ` · ${ultima.origen}` : ''} — {ultima.leidas} leída(s),{' '}
                  {ultima.nuevas} nueva(s), {ultima.actualizadas} actualizada(s),{' '}
                  {ultima.rechazadas} rechazada(s)
                </p>

                {/*
                  Aviso, NO acción.

                  La tentación es sincronizar sola al abrir la pantalla, y está mal por
                  tres razones: sería un GET que muta, se dispararía N veces con tres
                  personas mirando, y sobre todo **no correría de noche** — que es
                  justamente cuando entran las reservas que nadie ve hasta el lunes.
                  Eso lo resuelve el cron; esto solo avisa que hace rato que no corre.
                */}
                {horasDesde(ultima.corrida_en) >= 12 && (
                  <div className="mt-2 flex gap-2 rounded-lg bg-calafate-50 p-2 text-xs text-stone-700">
                    <Icono nombre="alerta" tam={14} />
                    <p>
                      {/* "Hace 6 días" en vez de "Hace más de 144 horas": mismo criterio de
                          lectura que ya usa el widget de cotización (`textoAntiguedad`,
                          `lib/domain/divisas.ts`), reusado acá porque es genérico —
                          convierte una duración en texto, no tiene nada de dólares. */}
                      {textoAntiguedad(Math.round(horasDesde(ultima.corrida_en) * 60))} que no se
                      sincroniza.{' '}
                      {capacidades.traeReservas
                        ? 'Si la sincronización automática está configurada, algo la está impidiendo; si no, conviene correrla a mano.'
                        : 'El proveedor configurado no sondea: hay que subir el informe del extranet.'}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-stone-600">
                Todavía no se sincronizó nunca. Subí el informe del extranet abajo para empezar.
              </p>
            )}
          </div>
        </div>
      </Tarjeta>

      <div className="mt-4">
        <Tarjeta
          titulo="Importar el informe del extranet"
          descripcion="El camino que no necesita aprobación de Booking ni contratar nada."
        >
          <ImportarCsv />
        </Tarjeta>
      </div>

      <div className="mt-6 mb-4 flex flex-wrap gap-1.5">
        {VISTAS.map((v) => (
          <Chip
            key={v}
            href={`/panel/canales${construirQuery({ vista: v === 'entrantes' ? undefined : v })}`}
            activo={vista === v}
          >
            {ETIQUETAS_VISTA[v]}
          </Chip>
        ))}
      </div>

      {vista === 'entrantes' && <VistaEntrantes d={datos} />}

      {vista === 'cobros' && <VistaCobros d={datos} />}

      {vista === 'costos' && <VistaCostos d={datos} />}

      {vista === 'mensajes' && <VistaMensajes d={datos} />}

      {vista === 'resenas' && <VistaResenas d={datos} />}

      {vista === 'publicacion' && <VistaPublicacion d={datos} />}

      {vista === 'calendario' && <VistaCalendario d={datos} />}
    </Pagina>
  )
}
