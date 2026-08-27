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

/*
  Encabezados del service worker.

  ⚠️ `Cache-Control: no-store` no es un detalle de rendimiento: es la única vía
  para arreglar un service worker roto. Si el navegador guardara `/sw.js`,
  seguiría ejecutando la versión vieja en el dispositivo de cada persona y un
  deploy no alcanzaría para corregirlo —incluido el service worker vacío que
  sirve para desactivarlo, documentado en `public/sw.js`—.

  El `Content-Type` explícito está porque un service worker servido con otro
  tipo MIME **el navegador lo rechaza**, y el error que muestra no dice eso.
*/
const ENCABEZADOS_SERVICE_WORKER = [
  { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
  { key: 'Cache-Control', value: 'no-store, must-revalidate' },
  // Alcanza al propio archivo: acota qué puede ejecutar el service worker, y no
  // interfiere con el resto del sistema, que sigue sin CSP.
  { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/:path*', headers: ENCABEZADOS_SEGURIDAD },
      // Después del general, para que estos ganen sobre él en `/sw.js`.
      { source: '/sw.js', headers: ENCABEZADOS_SERVICE_WORKER },
    ]
  },
}

export default nextConfig
