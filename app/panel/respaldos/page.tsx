import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  DIAS_CRITICOS,
  DIAS_RECOMENDADOS,
  ETIQUETAS_ESTADO_RESPALDO,
  TABLAS_RESPALDO,
  diasDesde,
  estadoRespaldo,
  tablasConDatosPersonales,
  tamanioLegible,
} from '@/lib/domain/respaldos'
import { Icono } from '../_components/iconos'
import {
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../_components/ui'

/**
 * Respaldos.
 *
 * ── La honestidad es la función principal de esta pantalla ───────────────────
 *
 * El pedido era «backups, o al menos un botón que dispare/verifique el backup
 * automático de la base». Hay que decir algo incómodo: **la aplicación no puede
 * disparar un backup de Postgres**. Los hace la plataforma (Supabase) y no expone
 * una API para pedirlos desde acá.
 *
 * Un botón que dijera «Hacer backup» y no lo hiciera sería la peor función del
 * sistema: alguien lo apretaría, vería «listo», y se enteraría de la verdad el día
 * que necesite restaurar. Por eso esta pantalla hace tres cosas que sí son ciertas:
 *
 *  1. **Explica quién es responsable de qué**, con nombre y todo.
 *  2. **Exporta los datos operativos** a un archivo que el hotel se baja y guarda.
 *     No es un backup de la base, pero responde la pregunta que importa —«¿tengo
 *     mis reservas?»— y se puede abrir y verificar, a diferencia del backup de la
 *     plataforma.
 *  3. **Registra cuándo fue la última vez**, para que la respuesta no dependa de
 *     que alguien se acuerde.
 */

interface RespaldoRow {
  id: number
  tablas: number
  filas: number
  bytes: number | string
  archivo: string
  generado_en: string
  perfil: { nombre: string } | null
}

export default async function RespaldosPage() {
  const sesion = await requerirAcceso('respaldos')
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('respaldos')
    .select('id, tablas, filas, bytes, archivo, generado_en, perfil:perfiles(nombre)')
    .order('generado_en', { ascending: false })
    .limit(20)

  const respaldos = (data ?? []) as unknown as RespaldoRow[]
  const ultimo = respaldos[0] ?? null
  const ahora = new Date()

  const estado = estadoRespaldo(ultimo?.generado_en ?? null, ahora)
  const dias = diasDesde(ultimo?.generado_en ?? null, ahora)
  const esAdmin = sesion.rol === 'admin'

  const tonoEstado =
    estado === 'al_dia' ? 'exito' : estado === 'conviene' ? 'alerta' : 'peligro'

  return (
    <Pagina>
      <Encabezado
        titulo="Respaldos"
        descripcion="Exportación de los datos del hotel y estado de las copias."
        icono="descargar"
        acciones={
          esAdmin ? (
            /* Es un enlace y no un formulario: el endpoint devuelve un archivo, y
               una descarga se pide con un GET. `download` no hace falta —el
               `content-disposition` del servidor ya lo fuerza— pero se deja para
               que el navegador no intente mostrarlo. */
            <a
              href="/api/respaldo"
              download
              className={botonClases('primario')}
            >
              <Icono nombre="descargar" tam={16} />
              Exportar los datos ahora
            </a>
          ) : null
        }
      />

      {/* ── Lo que hay que decir antes que nada ────────────────────────────── */}
      <div className="mb-4 flex items-start gap-3 rounded-xl bg-lago-50 px-4 py-3 ring-1 ring-lago-200">
        <span className="mt-0.5 shrink-0 text-lago-700">
          <Icono nombre="ayuda" tam={18} />
        </span>
        <div className="text-sm text-lago-950">
          <p className="font-semibold">Hay dos cosas distintas, y conviene no confundirlas.</p>
          <ul className="mt-2 space-y-1.5 text-lago-900">
            <li>
              <strong>El backup de la base</strong> lo hace la plataforma donde está alojado el
              sistema (Supabase): copias automáticas diarias y, según el plan contratado,
              recuperación a un momento puntual. Incluye <em>todo</em> —usuarios, permisos,
              funciones— y se restaura desde el panel de la plataforma.{' '}
              <strong>Este sistema no lo puede disparar ni verificar</strong>: no existe una forma
              de pedirlo desde la aplicación. Si hiciera un botón que dijera «hacer backup», estaría
              mintiendo.
            </li>
            <li>
              <strong>La exportación de datos</strong> es lo que sí hace esta pantalla: un archivo
              con las reservas, los huéspedes, los pagos, las facturas y el tarifario, que se baja y
              se guarda donde el hotel quiera. No reemplaza al backup de la base, pero responde la
              pregunta que importa —«si esto se cae, ¿tengo mis reservas?»— y tiene una ventaja: se
              puede abrir y comprobar que está.
            </li>
          </ul>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Último respaldo"
          valor={dias === null ? 'Nunca' : dias === 0 ? 'Hoy' : `${dias} d`}
          detalle={ETIQUETAS_ESTADO_RESPALDO[estado]}
          icono={estado === 'al_dia' ? 'ok' : 'alerta'}
          tono={tonoEstado}
        />
        <Kpi
          titulo="Filas exportadas"
          valor={ultimo ? ultimo.filas.toLocaleString('es-AR') : '—'}
          detalle={ultimo ? `en ${ultimo.tablas} tablas` : 'sin exportaciones'}
          icono="reportes"
        />
        <Kpi
          titulo="Tamaño"
          valor={ultimo ? tamanioLegible(Number(ultimo.bytes)) : '—'}
          detalle="del último archivo"
          icono="descargar"
        />
        <Kpi
          titulo="Exportaciones"
          valor={String(respaldos.length)}
          detalle="registradas"
          icono="auditoria"
        />
      </div>

      {/* Recomendación, con el motivo. */}
      {estado !== 'al_dia' && (
        <div
          className={`mb-4 flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ${
            estado === 'conviene'
              ? 'bg-lenga-50 text-lenga-900 ring-lenga-200'
              : 'bg-red-50 text-red-900 ring-red-200'
          }`}
        >
          <span className="mt-0.5 shrink-0">
            <Icono nombre="alerta" tam={18} />
          </span>
          <p className="text-sm">
            {estado === 'nunca' ? (
              <>
                <strong className="font-semibold">Todavía no se exportó nunca.</strong> Conviene
                hacerlo hoy y después cada {DIAS_RECOMENDADOS} días: es lo que el hotel podría
                rehacer de memoria si algo se perdiera.
              </>
            ) : estado === 'conviene' ? (
              <>
                <strong className="font-semibold">Pasaron {dias} días.</strong> La recomendación es
                cada {DIAS_RECOMENDADOS}: con más hueco, reconstruir las reservas de las últimas
                semanas se vuelve difícil.
              </>
            ) : (
              <>
                <strong className="font-semibold">Pasaron {dias} días.</strong> Más de{' '}
                {DIAS_CRITICOS} días sin exportar significa que, si hubiera que recurrir a este
                archivo, faltaría un mes de operación.
              </>
            )}
          </p>
        </div>
      )}

      {!esAdmin && (
        <div className="mb-4 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
          Solo administración puede exportar: el archivo contiene el nombre, el email y el teléfono
          de todos los huéspedes que pasaron por el hotel.
        </div>
      )}

      {/* ── Qué se lleva la exportación ─────────────────────────────────────── */}
      <Tarjeta
        titulo="Qué incluye la exportación"
        descripcion={`${TABLAS_RESPALDO.length} tablas. ${tablasConDatosPersonales().length} de ellas tienen datos personales: el archivo se guarda como un documento confidencial.`}
      >
        <div className="overflow-x-auto">
          <Tabla resumen="Tablas que se exportan y por qué cada una es necesaria">
            <thead>
              <tr>
                <th className={TH}>Tabla</th>
                <th className={TH}>Por qué se incluye</th>
                <th className={TH}>Datos personales</th>
              </tr>
            </thead>
            <tbody>
              {TABLAS_RESPALDO.map((t) => (
                <tr key={t.tabla} className={FILA}>
                  <td className={TD}>
                    <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{t.tabla}</code>
                  </td>
                  <td className={`${TD} text-stone-600`}>{t.porQue}</td>
                  <td className={TD}>
                    {/* Con texto, no sólo con color: es el dato que decide cómo se
                        guarda el archivo. */}
                    {t.datosPersonales ? (
                      <Etiqueta tono="alerta">Sí — tratar con cuidado</Etiqueta>
                    ) : (
                      <span className="text-xs text-stone-500">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </div>
      </Tarjeta>

      {/* ── Historial ───────────────────────────────────────────────────────── */}
      <div className="mt-4">
        <Tarjeta titulo="Exportaciones anteriores">
          {respaldos.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no se exportó nada"
              descripcion={
                esAdmin
                  ? 'Apretá «Exportar los datos ahora» arriba. El archivo se descarga y queda registrado acá.'
                  : 'Cuando administración exporte, va a quedar registrado acá.'
              }
              icono="descargar"
            />
          ) : (
            <div className="overflow-x-auto">
              <Tabla resumen="Historial de exportaciones con fecha, autor y tamaño">
                <thead>
                  <tr>
                    <th className={TH}>Fecha</th>
                    <th className={TH}>Quién</th>
                    <th className={`${TH} text-right`}>Filas</th>
                    <th className={`${TH} text-right`}>Tamaño</th>
                    <th className={TH}>Archivo</th>
                  </tr>
                </thead>
                <tbody>
                  {respaldos.map((r) => (
                    <tr key={r.id} className={FILA}>
                      <td className={`${TD} tabular whitespace-nowrap text-stone-700`}>
                        {new Date(r.generado_en).toLocaleString('es-AR')}
                      </td>
                      <td className={`${TD} text-stone-600`}>{r.perfil?.nombre ?? '—'}</td>
                      <td className={`${TD} tabular text-right text-stone-600`}>
                        {r.filas.toLocaleString('es-AR')}
                        <span className="block text-xs text-stone-500">{r.tablas} tablas</span>
                      </td>
                      <td className={`${TD} tabular text-right text-stone-600`}>
                        {tamanioLegible(Number(r.bytes))}
                      </td>
                      <td className={`${TD} text-xs text-stone-500`}>{r.archivo}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </div>
          )}
        </Tarjeta>
      </div>

      <p className="mt-6 text-xs text-stone-500">
        La salud de la base se puede comprobar en cualquier momento en{' '}
        <Link href="/api/salud" className="font-medium text-lago-700 hover:underline">
          /api/salud
        </Link>
        , que responde 200 si Postgres contesta y 503 si no.
      </p>
    </Pagina>
  )
}
