import type { NextRequest } from 'next/server'
import { actualizarSesion } from '@/lib/supabase/proxy'

/**
 * `proxy` reemplaza a `middleware` en Next.js 16. Se ejecuta antes de renderizar
 * las rutas y aquí lo usamos para mantener viva la sesión de Supabase.
 */
export async function proxy(request: NextRequest) {
  return await actualizarSesion(request)
}

export const config = {
  // Se ejecuta en todas las rutas excepto archivos estáticos e imágenes.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
