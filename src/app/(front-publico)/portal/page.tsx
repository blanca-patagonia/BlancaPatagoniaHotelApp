import { redirect } from 'next/navigation'

/**
 * `/portal` sin token no es una pantalla: cada socio entra por
 * `/portal/<token>`, el enlace que le mandó el hotel. Sin esta página, visitar
 * la ruta pelada —por ejemplo porque alguien borró el resto de la URL a mano—
 * daba un 404 desnudo. Un 404 es correcto para un token que no existe; acá el
 * token directamente no está, así que lo que corresponde es volver a un lugar
 * con sentido.
 */
export default function PortalSinTokenPage() {
  redirect('/')
}
