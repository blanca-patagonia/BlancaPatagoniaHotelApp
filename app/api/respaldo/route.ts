import { obtenerSesion } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { traerTodo } from '@/lib/paginado'
import { TABLAS_RESPALDO, nombreArchivo } from '@/lib/domain/respaldos'

/**
 * Exportación completa de los datos operativos: `GET /api/respaldo`.
 *
 * ── Lo que este endpoint es, y lo que no ────────────────────────────────────
 *
 * **No es un backup de la base.** No incluye los usuarios de Supabase Auth, ni las
 * políticas RLS, ni las funciones, ni los triggers. Los backups de Postgres los
 * hace la plataforma y no se pueden disparar desde acá.
 *
 * Es una exportación de los **datos del hotel** —reservas, huéspedes, pagos,
 * facturas, tarifario— en un archivo JSON que se baja y se guarda. Responde la
 * pregunta que de verdad importa: «si esto se cae, ¿tengo mis reservas?». Y a
 * diferencia del backup de la plataforma, se puede abrir y verificar.
 *
 * ── Por qué solo admin ──────────────────────────────────────────────────────
 *
 * El archivo contiene el nombre, el email y el teléfono de **todos** los huéspedes
 * que pasaron por el hotel, más los datos de agencias y proveedores. Es la
 * concentración de datos personales más grande que el sistema puede producir en un
 * solo archivo. Recepción no necesita eso para trabajar.
 *
 * ── Por qué `traerTodo` y no un `select` pelado ─────────────────────────────
 *
 * PostgREST corta en 1000 filas (`max_rows`, `supabase/config.toml`) **sin error y
 * sin aviso**. Un respaldo truncado en silencio es peor que ninguno: parece
 * completo. `traerTodo` pagina y avisa si algo quedó afuera.
 */

export const dynamic = 'force-dynamic'

/** Tope de filas por tabla. Muy por encima de lo que el hotel puede generar. */
const MAX_FILAS = 100_000

interface TablaExportada {
  tabla: string
  filas: unknown[]
  /** `true` si se alcanzó el tope y el contenido está incompleto. */
  truncada: boolean
}

export async function GET() {
  const sesion = await obtenerSesion()
  if (!sesion) return Response.json({ error: 'Sin sesión.' }, { status: 401 })

  // El rol se verifica acá y no solo en la pantalla: una ruta es un endpoint
  // público al que se llega escribiendo la URL.
  if (sesion.rol !== 'admin') {
    return Response.json(
      { error: 'La exportación completa incluye datos personales de todos los huéspedes: solo administración.' },
      { status: 403 },
    )
  }

  const supabase = await crearClienteServidor()
  const ahora = new Date()

  const exportadas: TablaExportada[] = []
  const problemas: string[] = []

  for (const { tabla } of TABLAS_RESPALDO) {
    const { filas, truncado } = await traerTodo<Record<string, unknown>>(
      (desde, hasta) => supabase.from(tabla).select('*').range(desde, hasta) as never,
      MAX_FILAS,
    )

    if (truncado) problemas.push(`${tabla}: superó ${MAX_FILAS} filas y quedó incompleta.`)
    exportadas.push({ tabla, filas, truncada: truncado })
  }

  const totalFilas = exportadas.reduce((acc, t) => acc + t.filas.length, 0)

  const cuerpo = {
    // Metadatos primero: quien abra el archivo dentro de dos años tiene que poder
    // entender qué es sin preguntarle a nadie.
    _respaldo: {
      sistema: 'Blanca Patagonia — Sistema de Gestión Hotelera',
      generadoEn: ahora.toISOString(),
      generadoPor: sesion.email,
      version: 1,
      // La aclaración va DENTRO del archivo, no solo en la pantalla: si alguien lo
      // encuentra en un disco en tres años, tiene que saber qué no contiene.
      alcance:
        'Datos operativos del hotel. NO incluye usuarios de autenticación, políticas RLS, ' +
        'funciones ni triggers de la base: eso está en los backups de la plataforma.',
      contieneDatosPersonales: true,
      tablas: exportadas.length,
      filas: totalFilas,
      ...(problemas.length > 0 ? { problemas } : {}),
    },
    datos: Object.fromEntries(exportadas.map((t) => [t.tabla, t.filas])),
  }

  const json = JSON.stringify(cuerpo, null, 2)
  const bytes = new TextEncoder().encode(json).length
  const archivo = nombreArchivo(ahora)

  // Se registra la exportación. Con `registrarFalla` y no cortando: el archivo ya
  // está armado y negárselo al usuario porque no se pudo escribir el registro
  // sería perder lo importante para salvar la anotación.
  const { error } = await supabase.from('respaldos').insert({
    tablas: exportadas.length,
    filas: totalFilas,
    bytes,
    archivo,
    generado_por: sesion.userId,
  })
  registrarFalla(error, 'registrar la exportación de respaldo')

  return new Response(json, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${archivo}"`,
      // Un respaldo no se cachea: cada pedido tiene que traer el estado actual.
      'cache-control': 'no-store',
    },
  })
}
