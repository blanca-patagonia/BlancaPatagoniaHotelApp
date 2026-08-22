/*
  Iconografía propia en SVG inline.

  Se dibujan a mano en lugar de sumar una librería de iconos: son pocos, pesan
  nada, heredan el color del texto (`currentColor`) y evitan una dependencia
  más en un proyecto de tesis. Todos usan una grilla de 24×24 y trazo 1.5.
*/

export type NombreIcono =
  | 'inicio'
  | 'ocupacion'
  | 'reservas'
  | 'huespedes'
  | 'housekeeping'
  | 'mantenimiento'
  | 'objetos'
  | 'avisos'
  | 'agencias'
  | 'proveedores'
  | 'contratos'
  | 'firma'
  | 'chat'
  | 'auditoria'
  | 'reportes'
  | 'config'
  | 'usuarios'
  | 'menu'
  | 'cerrar'
  | 'buscar'
  | 'anterior'
  | 'siguiente'
  | 'descargar'
  | 'mas'
  | 'salir'
  | 'montana'
  | 'alerta'
  | 'ok'
  | 'ayuda'
  | 'divisas'
  | 'canales'

/** Trazos de cada icono (todo dentro de un viewBox 0 0 24 24). */
const TRAZOS: Record<NombreIcono, string[]> = {
  inicio: ['M3 10.5 12 3.5l9 7', 'M5.5 9.5V19a1.5 1.5 0 0 0 1.5 1.5h3.5v-6h3v6H17a1.5 1.5 0 0 0 1.5-1.5V9.5'],
  ocupacion: ['M3.5 6.5h17v14h-17z', 'M3.5 11h17', 'M8 4v4', 'M16 4v4', 'M8 15.5h3'],
  reservas: ['M7 3.5h10a1 1 0 0 1 1 1v16l-6-3.5-6 3.5v-16a1 1 0 0 1 1-1z'],
  huespedes: [
    'M9.5 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M2.5 20.5a7 7 0 0 1 14 0',
    'M16 5.5a3 3 0 0 1 0 6',
    'M17 14.5a5.5 5.5 0 0 1 4.5 6',
  ],
  housekeeping: [
    'M11 3.5l1.6 4.4 4.4 1.6-4.4 1.6L11 15.5 9.4 11.1 5 9.5l4.4-1.6z',
    'M17.5 14.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z',
  ],
  mantenimiento: [
    'M15.2 3.6a5 5 0 0 0-6 6.4l-6 6a2 2 0 1 0 2.8 2.8l6-6a5 5 0 0 0 6.4-6l-3 3-2.6-.6-.6-2.6z',
  ],
  objetos: ['M12 3.5l8 4.3v8.4L12 20.5l-8-4.3V7.8z', 'M4 7.8 12 12l8-4.2', 'M12 12v8.5'],
  avisos: [
    'M4 10v4a1 1 0 0 0 1 1h2.5l6.5 3.5v-13L7.5 9H5a1 1 0 0 0-1 1z',
    'M17.5 8.5a4 4 0 0 1 0 7',
  ],
  agencias: [
    'M3.5 7.5h17v12h-17z',
    'M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2',
    'M3.5 12.5h17',
  ],
  proveedores: [
    'M2.5 6.5h11v9h-11z',
    'M13.5 9.5h3.8l3.2 3v3h-7z',
    'M7 18.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
    'M17.5 18.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
  ],
  contratos: [
    'M6 3.5h8l4 4v13h-12z',
    'M14 3.5v4h4',
    'M8.5 12h7',
    'M8.5 15.5h4',
  ],
  auditoria: [
    'M6 3.5h9l4 4v13h-13z',
    'M15 3.5v4h4',
    'M9 11.5h6',
    'M9 15h6',
    'M9 18h3',
  ],
  firma: ['M4 17.5c3-1 4-8 6-8s1.5 6 3.5 6 2-2.5 3.5-2.5', 'M3.5 20.5h17'],
  chat: [
    'M20.5 12.5c0 3.6-3.8 6.5-8.5 6.5-1 0-2-.1-2.9-.4l-5.1 1.4 1.5-4.2c-1.2-1-1.9-2.4-1.9-3.9C3.6 8.9 7.4 6 12 6s8.5 2.9 8.5 6.5z',
  ],
  reportes: ['M3.5 20.5h17', 'M7 20.5v-7', 'M12 20.5V5.5', 'M17 20.5v-10'],
  // Nodo central con tres ramas: el hotel y los canales que le mandan reservas.
  // No se usa un globo terráqueo, que en el panel ya sugeriría «portal público».
  canales: [
    'M12 6.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5z',
    'M5 22a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 5 22z',
    'M19 22a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5z',
    'M12 6.5v5',
    'M12 11.5H5.5a.5.5 0 0 0-.5.5v5.5',
    'M12 11.5h6.5a.5.5 0 0 1 .5.5v5.5',
  ],
  // Billete con una moneda: la conversión entre divisas, no un signo «$» suelto
  // (que en este sistema significaría un importe, no un tipo de cambio).
  divisas: [
    'M2.5 7.5h13v7h-13z',
    'M9 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M18 9.5a4.5 4.5 0 1 1-4.4 5.4',
    'M18 8v1.2',
    'M18 14.3v1.2',
  ],
  config: [
    'M4 7h8',
    'M16.5 7H20',
    'M4 12h3.5',
    'M12 12h8',
    'M4 17h8',
    'M16.5 17H20',
    'M14.25 8.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
    'M9.75 13.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
    'M14.25 18.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
  ],
  usuarios: ['M12 3.5l7.5 2.8v5.4c0 4.2-3 7.6-7.5 8.8-4.5-1.2-7.5-4.6-7.5-8.8V6.3z', 'M9 12l2.2 2.2L15.5 10'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  cerrar: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  buscar: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20.5 20.5 16 16'],
  anterior: ['M14.5 6.5 9 12l5.5 5.5'],
  siguiente: ['M9.5 6.5 15 12l-5.5 5.5'],
  descargar: ['M12 4v10.5', 'M8 11l4 4 4-4', 'M5 19.5h14'],
  mas: ['M12 5.5v13', 'M5.5 12h13'],
  salir: ['M15 12H4.5', 'M8 8.5 4.5 12 8 15.5', 'M11 4.5h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-6'],
  montana: ['M2.5 19.5 9 8l3.5 6 2-3.4 7 8.9z', 'M9 8l2.2 3.9'],
  alerta: ['M12 4.5 21 19.5H3z', 'M12 10v4', 'M12 16.8v.2'],
  ok: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8.5 12.2l2.4 2.4 4.6-4.8'],
  // Signo de pregunta dentro de un círculo: la convención universal de ayuda.
  ayuda: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    'M9.6 9.6a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4',
    'M12 16.8v.2',
  ],
}

interface Props {
  nombre: NombreIcono
  /** Tamaño en píxeles (cuadrado). */
  tam?: number
  className?: string
}

/**
 * Icono decorativo. Se marca `aria-hidden` porque siempre va acompañado de
 * texto o de un `aria-label` en el control que lo contiene.
 */
export function Icono({ nombre, tam = 18, className }: Props) {
  return (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {TRAZOS[nombre].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** Logotipo del panel: cordillera estilizada dentro de un círculo. */
export function Logotipo({ tam = 32 }: { tam?: number }) {
  return (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <circle cx="20" cy="20" r="19" className="fill-lago-700" />
      <path d="M8 27.5 16.5 14l4.5 7.6 2.6-4.2L32 27.5z" className="fill-lago-100" />
      <path d="M16.5 14 20 19.6h-7z" className="fill-white" />
    </svg>
  )
}
