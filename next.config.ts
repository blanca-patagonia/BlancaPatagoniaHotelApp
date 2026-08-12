import type { NextConfig } from 'next'

/*
  Encabezados de seguridad.

  El equivalente a Helmet en un backend Express. Acá no hay servidor propio
  donde enchufar un middleware, así que se declaran en la configuración y Next
  los agrega a toda respuesta.

  Cada uno está por un motivo concreto; los que se descartaron también se
  explican, porque un encabezado puesto de más rompe cosas y nadie se acuerda
  después de por qué estaba.
*/
const ENCABEZADOS_SEGURIDAD = [
  {
    // Impide que el navegador adivine el tipo de un archivo. Sin esto, algo
    // subido como texto puede terminar ejecutándose como script.
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // Nadie puede embeber el sistema en un iframe. Evita el clickjacking: una
    // página ajena que superpone su propio botón sobre "Cancelar reserva".
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // Al salir del sistema no se filtra la ruta que se estaba mirando. Sin
    // esto, un enlace externo desde el detalle de una reserva revelaría su id
    // en el `Referer` del sitio de destino.
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // El sistema no usa cámara, micrófono ni ubicación. Declararlo vacío evita
    // que un script inyectado pueda pedirlos en nombre del sitio.
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    // Obliga a HTTPS durante un año. Solo tiene efecto sobre HTTPS, así que en
    // desarrollo (http://localhost) el navegador lo ignora.
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
]

/*
  NO se agrega Content-Security-Policy todavía.

  Next inyecta estilos y scripts en línea, y una CSP mal calibrada rompe la
  aplicación de formas difíciles de diagnosticar —la página carga a medias y la
  consola muestra un bloqueo genérico—. Hacerla bien exige `nonce` por petición
  y probar cada pantalla. Queda anotado como trabajo pendiente en
  `docs/SEGURIDAD.md`: es mejor no tenerla que tenerla mal y desactivarla al
  primer problema.
*/

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: ENCABEZADOS_SEGURIDAD }]
  },
}

export default nextConfig
