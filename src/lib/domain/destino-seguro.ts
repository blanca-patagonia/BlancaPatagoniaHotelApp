/**
 * ¿A dónde se puede mandar al navegador después de un pago?
 *
 * Las pantallas de pago propias (Payway, el simulador) reciben en la URL a
 * dónde volver. Sin validar, eso es un redirect abierto, y peor: con
 * `javascript:` y un `window.location.href = volver`, código propio corriendo
 * en el origen del hotel —React bloquea `javascript:` en un `<a href>`, pero no
 * en una asignación a `location`—. Phishing con el dominio del hotel en la
 * barra, o el robo de la sesión del panel.
 *
 * Se acepta sólo:
 * · una ruta del propio sitio (`/reservar/…`), que no empiece con `//` ni `/\`
 *   (los navegadores las leen como «otro host»);
 * · una URL absoluta `http(s)` del MISMO origen que `baseSitio`.
 * Cualquier otra cosa cae al inicio.
 */
export function destinoSeguro(crudo: string | null | undefined, baseSitio: string): string {
  const valor = (crudo ?? '').trim()
  if (!valor) return '/'
  if (valor.startsWith('/') && !valor.startsWith('//') && !valor.startsWith('/\\')) return valor
  try {
    const destino = new URL(valor)
    const base = new URL(baseSitio)
    if ((destino.protocol === 'https:' || destino.protocol === 'http:') && destino.origin === base.origin) {
      return destino.toString()
    }
  } catch {
    // No es una URL: se descarta.
  }
  return '/'
}
