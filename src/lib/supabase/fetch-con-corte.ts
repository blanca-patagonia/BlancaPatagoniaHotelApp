/**
 * Un `fetch` con corte por tiempo, para los clientes de Supabase.
 *
 * Los adaptadores de terceros (pasarelas, correo, divisas, iCal) ya tenían su
 * corte; Supabase no. Si la base o el pooler se saturan, cada página del portal
 * y del panel —y el proxy, que valida la sesión en cada pedido— quedaba
 * esperando hasta el límite de la función de Vercel: se paga tiempo de cómputo
 * y quien está del otro lado ve una pantalla congelada en vez de un error.
 *
 * Si quien llama ya trae su propia señal (una consulta con `abortSignal`), se
 * respetan las dos: corta la primera que llegue.
 */
export function fetchConCorte(ms: number): typeof fetch {
  return (entrada, opciones) => {
    const corte = AbortSignal.timeout(ms)
    const senal = opciones?.signal ? AbortSignal.any([opciones.signal, corte]) : corte
    return fetch(entrada, { ...opciones, signal: senal })
  }
}
