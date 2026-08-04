import { z } from 'zod'

/**
 * Validación de las variables de entorno.
 *
 * Sin esto, una variable faltante se manifiesta tarde y mal: el cliente de
 * Supabase se construye con `undefined!` y el error aparece como un fallo de
 * red incomprensible en medio de una pantalla. Acá se falla **al arrancar** y
 * con un mensaje que dice exactamente qué falta.
 *
 * Las `NEXT_PUBLIC_*` viajan al navegador: nunca poner secretos ahí.
 */

const esquemaPublico = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL debe ser una URL válida.'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'Falta NEXT_PUBLIC_SUPABASE_ANON_KEY (la imprime `npx supabase status`).'),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
})

const esquemaServidor = esquemaPublico.extend({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'Falta SUPABASE_SERVICE_ROLE_KEY (solo servidor; nunca exponerla al navegador).'),
})

function explicar(error: z.ZodError): string {
  const detalle = error.issues.map((i) => `  · ${i.message}`).join('\n')
  return `Variables de entorno inválidas:\n${detalle}\n\nRevisá tu .env.local (ver .env.example).`
}

/**
 * Variables disponibles en el navegador.
 *
 * Next reemplaza `process.env.NEXT_PUBLIC_*` en tiempo de compilación, así que
 * hay que nombrarlas literalmente y no recorrer `process.env`.
 */
export function envPublico() {
  const resultado = esquemaPublico.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  })
  if (!resultado.success) throw new Error(explicar(resultado.error))
  return resultado.data
}

/** Variables que solo existen en el servidor (incluye la clave privilegiada). */
export function envServidor() {
  const resultado = esquemaServidor.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
  if (!resultado.success) throw new Error(explicar(resultado.error))
  return resultado.data
}

/**
 * URL pública del sitio, para los enlaces que viajan por correo.
 *
 * En desarrollo cae a localhost; en producción conviene fijar
 * `NEXT_PUBLIC_SITE_URL` para que los enlaces de encuesta, firma y portal
 * apunten al dominio real.
 */
export function urlDelSitio(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}
