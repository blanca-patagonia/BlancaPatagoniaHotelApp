import type { ClaveComodidad } from '@/lib/domain/comodidades'

/*
  Íconos de línea para la grilla de comodidades de la ficha.

  Trazo fino y sin relleno, a la manera de las fichas de habitación de los
  hoteles de referencia (Aman): el ícono acompaña al texto, nunca lo reemplaza
  —abajo siempre va escrito qué es—. Son SVG propios, sin dependencia nueva.
*/
const TRAZOS: Record<ClaveComodidad | 'personas' | 'generico', string[]> = {
  vista: ['M3 18h18', 'M3 18l5-7 4 5 3-3 6 5', 'M16 7.5a1.5 1.5 0 1 0 0-.01'],
  hidromasaje: ['M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-2z', 'M6 12V6a2 2 0 0 1 4 0', 'M7 19l-1 2M17 19l1 2'],
  desayuno: ['M4 10h12v3a6 6 0 0 1-12 0v-3z', 'M16 11h1.5a2.5 2.5 0 0 1 0 5H15', 'M8 3c0 2 2 2 2 4M12 3c0 2 2 2 2 4'],
  wifi: ['M2 9a15 15 0 0 1 20 0', 'M5.5 12.5a10 10 0 0 1 13 0', 'M9 16a5 5 0 0 1 6 0', 'M12 19.5v.01'],
  hogar: ['M4 21V9l8-6 8 6v12', 'M8 21v-5a4 4 0 0 1 8 0v5', 'M12 14c-1 1-1 2 0 3 1-1 1-2 0-3z'],
  cocina: ['M4 4h16v16H4z', 'M4 9h16', 'M8 6.5h.01M12 6.5h.01', 'M9 13h6v4H9z'],
  calefaccion: ['M6 20V8M10 20V4M14 20V8M18 20V4', 'M4 20h16'],
  tv: ['M3 6h18v11H3z', 'M8 21h8', 'M12 17v4'],
  estacionamiento: ['M4 4h16v16H4z', 'M10 16V8h3a2.5 2.5 0 0 1 0 5h-3'],
  caja: ['M4 5h16v14H4z', 'M14 12a2 2 0 1 0-.01 0', 'M7 9v6'],
  personas: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3 20a6 6 0 0 1 12 0', 'M16 5.5a3 3 0 0 1 0 5.5', 'M18 20a6 6 0 0 0-3-5'],
  generico: ['M5 12l4 4 10-10'],
}

export function IconoComodidad({
  clave,
}: {
  clave: ClaveComodidad | 'personas' | null
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-9 text-tinta-suave"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TRAZOS[clave ?? 'generico'].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
