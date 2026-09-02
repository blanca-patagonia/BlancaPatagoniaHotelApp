/**
 * Captura de errores del servidor (Fase 2 de la auditoría, ADR 0029).
 *
 * ── Qué agrega, teniendo ya los error boundaries ────────────────────────────
 *
 * El proyecto tiene tres pantallas de error —`app/global-error.tsx`,
 * `app/error.tsx` y `app/panel/error.tsx`— y las tres muestran el `digest` que
 * Next le asigna a la excepción. Ese digest es **el único hilo** entre lo que
 * vio quien usa el sistema y el stack que quedó del lado del servidor: sin él,
 * alguien reporta «me salió un error» con un código de ocho caracteres y no hay
 * con qué cruzarlo.
 *
 * Hasta acá ese hilo se cortaba: los boundaries lo mostraban en pantalla y no lo
 * mandaban a ningún lado. `onRequestError` es el gancho que Next expone para
 * cerrar el círculo — se dispara cuando el servidor captura una excepción, con
 * el mismo digest que se le muestra al usuario.
 *
 * ⚠️ Cubre lo que **nadie manejó**. Los errores que el código sí maneja —una
 * escritura rechazada, una pasarela que dice que no— siguen yendo por
 * `lib/acciones.ts` y `lib/registro.ts`, que tienen mucho más contexto que acá.
 * Los dos caminos terminan en la misma tabla `errores`.
 */
import type { Instrumentation } from 'next'

/**
 * Se corre una vez al arrancar el servidor (gancho `register` de Next).
 *
 * El ADR 0018 promete que si en producción falta una variable obligatoria, el
 * sistema **falla al arrancar** en vez de descubrirlo en caliente. `lib/env.ts`
 * ya cubre Supabase; acá se suma lo que quedaba afuera: las credenciales de las
 * pasarelas que `PAGO_PROVIDER` habilita. Sin esto, `PAGO_PROVIDER=stripe` sin
 * `STRIPE_SECRET_KEY` levantaba igual y fallaba recién cuando alguien iba a pagar.
 */
export async function register() {
  // Solo en el runtime de Node: en `edge` no existe `process.env` completo y las
  // pasarelas ni corren ahí.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { verificarCredencialesDePasarela } = await import('@/lib/payments')
  verificarCredencialesDePasarela()
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  contexto,
) => {
  // El import va adentro: `lib/registro.ts` arrastra `server-only` y el cliente
  // admin, y este archivo también se evalúa en el runtime `edge`, donde nada de
  // eso existe. Cargándolo acá, solo se resuelve cuando de verdad hubo un error
  // en Node.
  const { registrarError } = await import('@/lib/registro')

  const mensaje = error instanceof Error ? error.message : String(error)

  // El error que llega puede no ser el original: si la excepción ocurrió
  // renderizando un Server Component, React lo procesa y lo reemplaza. El
  // `digest` sobrevive a ese reemplazo, y por eso es lo que se guarda.
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String((error as { digest: unknown }).digest)
      : null

  await registrarError(
    'excepcion_no_manejada',
    {
      detalle: mensaje,
      // El stack recortado: entero puede ocupar kilobytes por fila y las
      // primeras líneas son las que ubican el problema.
      pila: error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 12).join('\n') : null,
      metodo: request.method,
      tipo_ruta: contexto.routeType,
      router: contexto.routerKind,
    },
    {
      digest,
      // `request.path` lleva la query, que puede arrastrar datos de quien
      // navegaba. Se guarda la ruta del archivo, que identifica el problema sin
      // el dato: `/panel/reservas/[id]` en vez de `/panel/reservas/abc?dni=…`.
      ruta: contexto.routePath,
      pedido:
        (request.headers['x-vercel-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        null,
    },
  )
}
