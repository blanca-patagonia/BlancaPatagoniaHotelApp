import { NextResponse, type NextRequest } from 'next/server'
import { actualizarSesion } from '@/lib/supabase/proxy'
import { IDIOMAS, esIdioma, idiomaDeReferencia, idiomaPreferido } from '@/lib/i18n/idiomas'

/**
 * `proxy` reemplaza a `middleware` en Next.js 16. Se ejecuta antes de renderizar
 * las rutas y acá hace dos cosas: mantener viva la sesión de Supabase y mandar
 * el portal público a su idioma.
 */

/**
 * Rutas del portal que llevan prefijo de idioma.
 *
 * ⚠️ **La lista es blanca a propósito, y es corto el motivo:** hay URLs públicas
 * que **ya se enviaron por correo** —`/reservar/confirmacion/<token>`,
 * `/firmar/<token>`, `/encuesta/<token>`, `/portal/<token>`— y moverlas bajo un
 * prefijo las rompe para todo huésped que todavía tenga ese mail en la bandeja.
 * Con una lista negra, cada ruta nueva entraría sola en el esquema de idiomas y
 * tarde o temprano una con token se colaría.
 *
 * Esas pantallas se traducirán leyendo el idioma de la reserva, no de la URL.
 */
const RUTAS_CON_IDIOMA = ['/alojamientos', '/reservar', '/reservar/checkout']

/** ¿Esta ruta tiene que vivir bajo un prefijo de idioma? */
function llevaIdioma(ruta: string): boolean {
  if (ruta === '/') return true
  // `/reservar` y `/reservar/checkout` sí, pero `/reservar/confirmacion/<token>`
  // no: la segunda es la dirección que viaja en un correo.
  //
  // ⚠️ `/reservar/checkout` faltaba en la lista cuando el portal pasó a
  // `app/[idioma]/`: el botón «Reservar» de los resultados apuntaba ahí sin
  // prefijo, el proxy no lo redirigía y la página daba 404. Era el último paso
  // antes de dejar los datos, o sea el peor lugar posible para cortar.
  if (ruta === '/alojamientos' || ruta.startsWith('/alojamientos/')) return true
  return RUTAS_CON_IDIOMA.includes(ruta)
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const primerSegmento = pathname.split('/')[1]

  // La sesión se refresca siempre: el panel la necesita y el portal público la
  // ignora sin costo. Si la ruta ya trae idioma, se reenvía a la aplicación en
  // la misma pasada.
  const respuesta = await actualizarSesion(
    request,
    esIdioma(primerSegmento) ? { 'x-idioma': primerSegmento } : undefined,
  )

  /*
    Ya trae idioma: no se redirige, pero se anuncia.

    El `lang` del `<html>` lo escribe `app/layout.tsx`, que está **por encima**
    del segmento `[idioma]` y por lo tanto no puede leerlo de `params`. La
    alternativa que documenta Next —`next/root-params`— exige que el layout
    raíz viva dentro de `app/[idioma]/`, y eso arrastraría al panel a tener
    prefijo de idioma sin necesitarlo. Pasarlo por cabecera resuelve lo mismo
    sin mover el panel.

    Se valida que sea uno de los conocidos para que `/xx/alojamientos` no
    renderice con el diccionario de origen bajo una URL inventada —eso le daría
    a un buscador infinitas direcciones con el mismo contenido—.
  */
  if (esIdioma(primerSegmento)) return respuesta

  // Sin idioma y le corresponde: se redirige al que pida el navegador.
  if (llevaIdioma(pathname)) {
    // Primero el idioma de la página de la que viene el clic: quien ya eligió
    // uno con el selector no tiene que volver a elegirlo en cada enlace.
    const idioma =
      idiomaDeReferencia(request.headers.get('referer'), request.nextUrl.origin) ??
      idiomaPreferido(request.headers.get('accept-language'))
    const destino = request.nextUrl.clone()
    destino.pathname = `/${idioma}${pathname === '/' ? '' : pathname}`
    /*
      Redirección 307 (temporal) y no 308.

      El idioma se decide por la cabecera de **cada** visitante, así que `/` no
      lleva siempre al mismo lugar. Con una permanente, el navegador de quien
      entró primero en inglés se quedaría con `/` → `/en` cacheado para siempre
      y ya no respetaría un cambio de preferencia.
    */
    return NextResponse.redirect(destino, 307)
  }

  return respuesta
}

export const config = {
  // Se ejecuta en todas las rutas excepto archivos estáticos e imágenes.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webmanifest)$).*)',
  ],
}

/** Exportado para el test: la lista blanca es la garantía de los enlaces vivos. */
export const _rutasConIdioma = { RUTAS_CON_IDIOMA, llevaIdioma, IDIOMAS }
