/**
 * Base de URL para metadatos públicos (SEO, Open Graph, sitemap, robots).
 *
 * No reutiliza `urlDelSitio()` de `lib/env.ts` a propósito: esa función corta
 * el arranque en producción si falta `NEXT_PUBLIC_SITE_URL`, porque un enlace
 * de correo roto es un huésped que no puede hacer el check-in. Acá el costo de
 * faltar la variable es muy distinto — una vista previa de WhatsApp sin imagen
 * o una URL canónica de `localhost` en el `<head>` — y no amerita tirar abajo
 * el build ni el renderizado de cada página pública. Por eso cae en silencio
 * a `http://localhost:3000` en vez de lanzar.
 */
export function baseUrlSeo(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000'
}
