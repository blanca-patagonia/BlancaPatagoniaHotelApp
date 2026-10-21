import type { CanalBandeja } from '@/lib/domain/bandeja'
import { ETIQUETAS_CANAL } from '@/lib/domain/bandeja'

/**
 * Ícono de cada canal: glifo simple sobre un cuadrado de color.
 *
 * Son dibujos propios y no los logos de las marcas: alcanza para reconocer el
 * canal de un vistazo, y no hay que mantener ni licenciar los originales.
 * El color solo no identifica —hay personas que no lo distinguen—: el glifo
 * es distinto en cada canal y el nombre va en el `title` y en el texto
 * alternativo.
 */

const FONDO: Record<CanalBandeja, string> = {
  whatsapp: 'bg-emerald-600',
  instagram: 'bg-calafate-600',
  messenger: 'bg-lago-600',
  email: 'bg-stone-600',
  telegram: 'bg-lago-500',
  web: 'bg-lenga-600',
}

const GLIFO: Record<CanalBandeja, string[]> = {
  whatsapp: [
    'M3.5 20.5l1.4-4.3A8.5 8.5 0 1 1 8.3 19.6L3.5 20.5z',
    'M9.3 8.8c.2 2 2.7 4.5 4.7 4.7l1.3-1.3-1.9-1-1 .7c-.7-.3-1.5-1.1-1.8-1.8l.7-1-1-1.9-1 1.6z',
  ],
  instagram: ['M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4z', 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M17 7v.01'],
  messenger: [
    'M12 3.5c-4.7 0-8.5 3.5-8.5 7.9 0 2.4 1.1 4.5 3 5.9V21l2.9-1.6c.8.2 1.7.3 2.6.3 4.7 0 8.5-3.5 8.5-7.9S16.700 3.500 12 3.500z',
    'M7.5 13.5l3-3.2 2 2 3-3.2',
  ],
  email: ['M3.5 6.5h17v11h-17z', 'M3.5 7l8.500 6 8.500-6'],
  telegram: ['M21 3.500L3 10.700l5.600 2.100L19 5.800l-8.400 8.700.4 5.200 2.800-2.800 4.100 3L21 3.500z'],
  web: ['M12 3.500a8.500 8.500 0 1 0 0 17 8.500 8.500 0 0 0 0-17z', 'M3.500 12h17', 'M12 3.500c2.300 2.500 3.500 5.300 3.500 8.500s-1.200 6-3.500 8.500c-2.300-2.500-3.500-5.300-3.500-8.500s1.200-6 3.500-8.500z'],
}

export function IconoCanal({ canal, tam = 36 }: { canal: CanalBandeja; tam?: number }) {
  const glifo = Math.round(tam * 0.58)
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl text-white ${FONDO[canal]}`}
      style={{ width: tam, height: tam }}
      title={ETIQUETAS_CANAL[canal]}
    >
      <svg width={glifo} height={glifo} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {GLIFO[canal].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      <span className="sr-only">{ETIQUETAS_CANAL[canal]}</span>
    </span>
  )
}
