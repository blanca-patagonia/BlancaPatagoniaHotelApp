'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as EventoPuntero,
  type KeyboardEvent as EventoTeclado,
  type ReactNode,
} from 'react'
import { AREAS, areasDe, ETIQUETAS_AREA, type Area } from '@/lib/domain/permisos'
import { agruparAreas, RUTA_AREA } from '@/lib/domain/navegacion'
import {
  acotarAncho,
  leerAnchoGuardado,
  ANCHO_MAXIMO,
  ANCHO_MINIMO,
  ANCHO_POR_DEFECTO,
  CLAVE_ANCHO,
  PASO_TECLADO,
} from '@/lib/domain/lateral'
import { alternarGrupo, estaPlegado, leerPlegadosGuardado, CLAVE_PLEGADO } from '@/lib/domain/nav-plegado'
import { leerColapsadoGuardado, CLAVE_COLAPSADO, ANCHO_COLAPSADO } from '@/lib/domain/nav-colapso'
import type { Rol } from '@/lib/domain/roles'
import { Icono, Logotipo, type NombreIcono } from './iconos'
import { ConfirmarProvider } from './confirmar'
import { AvisosProvider } from './toast'
import { BuscadorGlobal } from './buscador-global'

/*
  Solo el ICONO vive acá. La ruta de cada área la da `RUTA_AREA`
  (`lib/domain/navegacion.ts`), porque la necesita también el buscador global y
  dos listas de veintidós rutas que hay que tocar juntas terminan divergiendo.
*/
const ICONO_AREA: Record<Area, NombreIcono> = {
  dashboard: 'inicio',
  ocupacion: 'ocupacion',
  servicio: 'reportes',
  reservas: 'reservas',
  punto_venta: 'objetos',
  huespedes: 'huespedes',
  housekeeping: 'housekeeping',
  mantenimiento: 'mantenimiento',
  objetos_perdidos: 'objetos',
  avisos: 'avisos',
  conversaciones: 'chat',
  agencias: 'agencias',
  proveedores: 'proveedores',
  contratos: 'contratos',
  canales: 'canales',
  conciliacion: 'conciliacion',
  auditoria: 'auditoria',
  // Se reusa `alerta` en vez de dibujar un icono nuevo: es exactamente lo que
  // significa la pantalla y ya está en la paleta.
  errores: 'alerta',
  notificaciones: 'sobre',
  reportes: 'reportes',
  ia: 'ia',
  config: 'config',
  usuarios: 'usuarios',
  respaldos: 'descargar',
  ayuda: 'ayuda',
}

const NAV: Record<Area, { href: string; icono: NombreIcono }> = Object.fromEntries(
  AREAS.map((a) => [a, { href: RUTA_AREA[a], icono: ICONO_AREA[a] }]),
) as Record<Area, { href: string; icono: NombreIcono }>

/** El área está activa si es la ruta exacta (Inicio) o un prefijo (el resto). */
function estaActivo(pathname: string, area: Area, href: string): boolean {
  return area === 'dashboard' ? pathname === href : pathname.startsWith(href)
}

/**
 * Menú lateral, agrupado por momento de uso (ver `lib/domain/navegacion.ts`).
 *
 * Antes eran 18 enlaces en una columna plana, todos con el mismo peso visual:
 * encontrar uno obligaba a leer la lista entera. Ahora cada grupo lleva un
 * encabezado, y la navegación pasa a ser dos saltos cortos en vez de un barrido.
 *
 * Los encabezados son `<p>` dentro de un `<ul>` propio por grupo, y cada grupo
 * se anuncia con `aria-labelledby`: para un lector de pantalla son cinco listas
 * con nombre, no una sola de 18 elementos.
 *
 * ── Modo colapsado (solo íconos) ─────────────────────────────────────────
 *
 * `colapsado` es exclusivo de la barra de escritorio: el cajón móvil nunca lo
 * pasa (ver `PanelShell`), porque ahí el espacio no es el problema que este
 * modo resuelve. Colapsado, los encabezados de grupo desaparecen —no hay
 * lugar para el texto— y con ellos la posibilidad de plegar un grupo
 * puntual: se fuerza `plegado = false` para que ningún grupo quede escondido
 * sin que su encabezado esté a la vista para volver a abrirlo. La etiqueta de
 * cada sección sigue disponible como `title` (tooltip nativo) y `aria-label`.
 */
function Enlaces({
  rol,
  pathname,
  alNavegar,
  colapsado = false,
}: {
  rol: Rol
  pathname: string
  alNavegar?: () => void
  colapsado?: boolean
}) {
  const grupos = agruparAreas(areasDe(rol))
  const plegados = useSyncExternalStore(
    suscribirPlegado,
    leerPlegado,
    () => SIN_PLEGADOS, // En el servidor no hay preferencia guardada que leer: todo abierto.
  )

  return (
    /* `barra-discreta` (globals.css): la barra del sistema es gris y ancha, y
       sobre el azul del menú se veía como una franja blanca de arriba abajo. No
       se oculta —sería sacar la única pista de que la lista sigue— sino que se
       atenúa al color del contenido. */
    <nav
      className="barra-discreta flex flex-1 flex-col gap-4 overflow-y-auto p-3"
      aria-label="Secciones del panel"
    >
      {grupos.map((grupo, i) => {
        const idTitulo = `nav-grupo-${i}`
        // El grupo que contiene la página activa nunca se muestra plegado: sin
        // esto, alguien podría plegar «Comercial» y quedarse navegando dentro
        // de un grupo del que no ve ni el propio encabezado.
        const contieneActivo = grupo.areas.some((area) => estaActivo(pathname, area, NAV[area].href))
        const plegado =
          !colapsado && grupo.titulo !== null && estaPlegado(plegados, grupo.titulo) && !contieneActivo
        return (
          <div key={grupo.titulo ?? 'sin-titulo'}>
            {grupo.titulo && !colapsado && (
              <button
                type="button"
                id={idTitulo}
                onClick={() => alternarPlegado(grupo.titulo as string)}
                aria-expanded={!plegado}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 pb-1.5 text-[11px] font-semibold tracking-[0.12em] text-lago-200/70 uppercase transition hover:text-lago-100"
              >
                {grupo.titulo}
                <span
                  aria-hidden="true"
                  className={`text-[9px] transition-transform ${plegado ? '-rotate-90' : ''}`}
                >
                  ▾
                </span>
              </button>
            )}
            {!plegado && (
              <ul
                className="flex flex-col gap-0.5"
                aria-labelledby={grupo.titulo && !colapsado ? idTitulo : undefined}
              >
                {grupo.areas.map((area) => {
                const { href, icono } = NAV[area]
                const activo = estaActivo(pathname, area, href)
                return (
                  <li key={area}>
                    <Link
                      href={href}
                      onClick={alNavegar}
                      aria-current={activo ? 'page' : undefined}
                      title={colapsado ? ETIQUETAS_AREA[area] : undefined}
                      aria-label={colapsado ? ETIQUETAS_AREA[area] : undefined}
                      /* `min-h-11` = 44 px. El mínimo táctil que `globals.css`
                         ya aplica bajo `pointer: coarse` alcanza a `button` y
                         `select`, pero no a un `<a>`, y el panel se usa en
                         tablet desde el mostrador. */
                      className={`group relative flex min-h-11 items-center rounded-lg py-2 text-sm font-medium transition ${
                        colapsado ? 'justify-center px-2' : 'gap-3 px-3'
                      } ${
                        activo
                          ? 'bg-white/15 text-white'
                          : 'text-lago-100/80 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {activo && (
                        <span
                          className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-lenga-400"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={activo ? 'text-lenga-300' : 'text-lago-300/70 group-hover:text-lago-200'}
                      >
                        <Icono nombre={icono} tam={18} />
                      </span>
                      {!colapsado && ETIQUETAS_AREA[area]}
                    </Link>
                  </li>
                )
              })}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function Marca({ colapsado = false }: { colapsado?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 border-b border-white/10 py-4 ${colapsado ? 'justify-center px-2' : 'px-4'}`}
    >
      <Logotipo tam={34} />
      {!colapsado && (
        <div className="min-w-0">
          <p className="font-display truncate text-base leading-tight font-semibold text-white">
            Blanca Patagonia
          </p>
          <p className="truncate text-[11px] tracking-wide text-lago-200/80 uppercase">
            Gestión hotelera
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Menú de cuenta, detrás del avatar.
 *
 * El avatar y el nombre eran texto muerto: se veían pulsables y no hacían nada,
 * y al lado había un botón «Salir» suelto. Un control que parece un botón y no
 * responde hace dudar de si la interfaz se colgó.
 *
 * Solo ofrece lo que existe de verdad —quién sos, cambiar tu contraseña, la
 * ayuda y cerrar sesión—. No se agregan «preferencias» ni «perfil» porque no hay
 * nada detrás: un menú con opciones muertas es el mismo problema, más grande.
 */
function MenuCuenta({
  nombre,
  rolEtiqueta,
  salir,
}: {
  nombre: string
  rolEtiqueta: string
  salir: ReactNode
}) {
  const [abierto, setAbierto] = useState(false)

  // Cierra al hacer clic afuera y con Escape: son las dos salidas que alguien
  // espera de un menú, y sin ellas queda abierto tapando la pantalla.
  useEffect(() => {
    if (!abierto) return
    const alTocarAfuera = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu-cuenta]')) setAbierto(false)
    }
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', alTocarAfuera)
    window.addEventListener('keydown', alPresionar)
    return () => {
      document.removeEventListener('mousedown', alTocarAfuera)
      window.removeEventListener('keydown', alPresionar)
    }
  }, [abierto])

  const muestraRol = rolEtiqueta.toLowerCase() !== nombre.trim().toLowerCase()

  return (
    <div className="relative" data-menu-cuenta>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        className="toque flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-stone-100"
      >
        <span className="hidden text-right sm:block">
          <span className="block text-sm leading-tight font-medium text-stone-800">{nombre}</span>
          {/* El rol solo se muestra si aporta algo: con el admin de
              desarrollo, nombre y rol son ambos «Administrador». */}
          {muestraRol && <span className="block text-xs text-stone-600">{rolEtiqueta}</span>}
        </span>
        <span
          className="flex size-9 items-center justify-center rounded-full bg-lago-100 text-sm font-semibold text-lago-800 ring-1 ring-lago-200"
          aria-hidden="true"
        >
          {nombre.slice(0, 1).toUpperCase()}
        </span>
        <span aria-hidden="true" className="text-xs text-stone-500">
          ▾
        </span>
      </button>

      {abierto && (
        <div
          role="menu"
          aria-label="Tu cuenta"
          className="absolute right-0 z-40 mt-1 w-60 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg"
        >
          <div className="border-b border-stone-100 px-4 py-3">
            <p className="truncate text-sm font-medium text-stone-900">{nombre}</p>
            <p className="text-xs text-stone-600">{rolEtiqueta}</p>
          </div>
          <Link
            href="/panel/cuenta"
            role="menuitem"
            onClick={() => setAbierto(false)}
            className="flex min-h-11 items-center gap-2.5 px-4 text-sm text-stone-700 transition hover:bg-stone-50"
          >
            <Icono nombre="usuarios" tam={16} />
            Cambiar mi contraseña
          </Link>
          <Link
            href="/panel/ayuda"
            role="menuitem"
            onClick={() => setAbierto(false)}
            className="flex min-h-11 items-center gap-2.5 px-4 text-sm text-stone-700 transition hover:bg-stone-50"
          >
            <Icono nombre="ayuda" tam={16} />
            Ayuda
          </Link>
          <div className="border-t border-stone-100 p-2">{salir}</div>
        </div>
      )}
    </div>
  )
}

const FONDO_LATERAL = 'bg-linear-to-b from-lago-800 via-lago-900 to-lago-950'

/* ── Ancho del menú, recordado en el navegador ────────────────────────────── */

/*
  El ancho vive fuera de React —lo guarda el navegador— así que se lee con
  `useSyncExternalStore` y no volcándolo con `setState` desde un efecto, que
  provoca un render en cascada (`react-hooks/set-state-in-effect`).

  `anchoEnMemoria` es la fuente de verdad una vez que alguien arrastró:
  `localStorage` es solo la persistencia. Sin él, en un navegador con el
  almacenamiento bloqueado el arrastre no tendría efecto visible, porque la
  lectura seguiría devolviendo el valor de siempre.
*/
let anchoEnMemoria: number | null = null
const oyentesAncho = new Set<() => void>()

function suscribirAncho(alCambiar: () => void): () => void {
  oyentesAncho.add(alCambiar)
  return () => {
    oyentesAncho.delete(alCambiar)
  }
}

/*
  React llama a esto en cada render y exige que devuelva **el mismo valor**
  mientras nada haya cambiado; si no, avisa por consola y puede entrar en un
  bucle de renders. Por eso la primera lectura se cachea en memoria: además de
  cumplir el contrato, evita ir al almacenamiento del navegador —que es síncrono
  y bloquea— en cada pintada del panel.
*/
function leerAncho(): number {
  if (anchoEnMemoria !== null) return anchoEnMemoria
  try {
    anchoEnMemoria = leerAnchoGuardado(localStorage.getItem(CLAVE_ANCHO))
  } catch {
    // Modo privado o almacenamiento bloqueado: se usa el ancho de diseño.
    anchoEnMemoria = ANCHO_POR_DEFECTO
  }
  return anchoEnMemoria
}

function guardarAncho(ancho: number): void {
  const acotado = acotarAncho(ancho)
  anchoEnMemoria = acotado
  try {
    localStorage.setItem(CLAVE_ANCHO, String(acotado))
  } catch {
    // La preferencia no sobrevive a la recarga, pero el arrastre funciona.
  }
  oyentesAncho.forEach((avisar) => avisar())
}

/* ── Grupos plegados, con el mismo patrón que el ancho ────────────────────── */

let plegadosEnMemoria: string[] | null = null
const oyentesPlegado = new Set<() => void>()

function suscribirPlegado(alCambiar: () => void): () => void {
  oyentesPlegado.add(alCambiar)
  return () => {
    oyentesPlegado.delete(alCambiar)
  }
}

function leerPlegado(): string[] {
  if (plegadosEnMemoria !== null) return plegadosEnMemoria
  try {
    plegadosEnMemoria = leerPlegadosGuardado(localStorage.getItem(CLAVE_PLEGADO))
  } catch {
    plegadosEnMemoria = []
  }
  return plegadosEnMemoria
}

const SIN_PLEGADOS: string[] = []

function alternarPlegado(titulo: string): void {
  const siguiente = alternarGrupo(leerPlegado(), titulo)
  plegadosEnMemoria = siguiente
  try {
    localStorage.setItem(CLAVE_PLEGADO, JSON.stringify(siguiente))
  } catch {
    // La preferencia no sobrevive a la recarga, pero plegar/desplegar funciona.
  }
  oyentesPlegado.forEach((avisar) => avisar())
}

/* ── Colapso a solo íconos, con el mismo patrón que el ancho y el plegado ─── */

let colapsadoEnMemoria: boolean | null = null
const oyentesColapso = new Set<() => void>()

function suscribirColapso(alCambiar: () => void): () => void {
  oyentesColapso.add(alCambiar)
  return () => {
    oyentesColapso.delete(alCambiar)
  }
}

function leerColapso(): boolean {
  if (colapsadoEnMemoria !== null) return colapsadoEnMemoria
  try {
    colapsadoEnMemoria = leerColapsadoGuardado(localStorage.getItem(CLAVE_COLAPSADO))
  } catch {
    colapsadoEnMemoria = false
  }
  return colapsadoEnMemoria
}

function guardarColapso(colapsado: boolean): void {
  colapsadoEnMemoria = colapsado
  try {
    localStorage.setItem(CLAVE_COLAPSADO, colapsado ? '1' : '0')
  } catch {
    // La preferencia no sobrevive a la recarga, pero colapsar/expandir funciona.
  }
  oyentesColapso.forEach((avisar) => avisar())
}

interface Props {
  rol: Rol
  nombre: string
  rolEtiqueta: string
  /** Formulario de cierre de sesión (viene del layout, que es de servidor). */
  salir: ReactNode
  children: ReactNode
}

/**
 * Estructura del panel: barra lateral fija en escritorio y cajón deslizable en
 * móvil. Antes la barra simplemente se ocultaba por debajo de `sm`, con lo cual
 * desde un teléfono no había manera de cambiar de sección.
 */
export function PanelShell({ rol, nombre, rolEtiqueta, salir, children }: Props) {
  const pathname = usePathname()
  const [abierto, setAbierto] = useState(false)

  const ancho = useSyncExternalStore(
    suscribirAncho,
    leerAncho,
    () => ANCHO_POR_DEFECTO, // En el servidor no hay navegador que consultar.
  )
  const colapsado = useSyncExternalStore(
    suscribirColapso,
    leerColapso,
    () => false, // En el servidor no hay preferencia guardada que leer: expandido.
  )
  const refLateral = useRef<HTMLElement>(null)

  /**
   * Arrastre de la manija.
   *
   * ⚠️ Durante el arrastre se escribe **directo en el DOM** y no en el estado de
   * React. Volcar cada `pointermove` al estado re-renderiza los veinte enlaces
   * del menú docenas de veces por segundo y el arrastre se siente pegajoso. Al
   * soltar se hace un único `guardarAncho`, que es el que sincroniza React y
   * persiste la preferencia.
   */
  function alArrastrar(evento: EventoPuntero<HTMLDivElement>) {
    // Solo el botón principal: con el secundario se abre el menú contextual y
    // el arrastre quedaría enganchado sin que nadie lo suelte.
    if (evento.button !== 0) return
    const lateral = refLateral.current
    if (!lateral) return

    evento.preventDefault()

    const inicioX = evento.clientX
    const inicioAncho = lateral.getBoundingClientRect().width
    let ultimo = acotarAncho(inicioAncho)

    const alMover = (e: PointerEvent) => {
      ultimo = acotarAncho(inicioAncho + (e.clientX - inicioX))
      lateral.style.width = `${ultimo}px`
    }

    const alSoltar = () => {
      window.removeEventListener('pointermove', alMover)
      window.removeEventListener('pointerup', alSoltar)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      guardarAncho(ultimo)
    }

    /*
      Sin esto, arrastrar sobre el menú selecciona el texto de los enlaces y el
      cursor parpadea entre la flecha y la barra de redimensión cada vez que
      pasa por encima de un elemento distinto.
    */
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', alMover)
    window.addEventListener('pointerup', alSoltar)
  }

  /** El mismo ajuste, con el teclado: un separador enfocable tiene que responder. */
  function alTeclear(evento: EventoTeclado<HTMLDivElement>) {
    const acciones: Record<string, number> = {
      ArrowLeft: ancho - PASO_TECLADO,
      ArrowRight: ancho + PASO_TECLADO,
      Home: ANCHO_MINIMO,
      End: ANCHO_MAXIMO,
    }
    const destino = acciones[evento.key]
    if (destino === undefined) return
    evento.preventDefault()
    guardarAncho(destino)
  }

  // El cajón se cierra desde el `onClick` de cada enlace (ver `alNavegar`), no
  // con un efecto sobre `pathname`: así se evita un render en cascada.

  // Con el cajón abierto se bloquea el scroll del fondo.
  useEffect(() => {
    document.body.style.overflow = abierto ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [abierto])

  // Escape cierra el cajón (accesibilidad por teclado).
  useEffect(() => {
    if (!abierto) return
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  }, [abierto])

  return (
    <AvisosProvider>
    <ConfirmarProvider>
    <div className="flex flex-1 bg-stone-50">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Saltar al contenido
      </a>

      {/*
        Barra lateral — escritorio.

        Va pegada a la ventana (`sticky top-0 h-screen`) y **eso es lo que arregla el
        bug**: antes era `static`, y como es un ítem flex de un contenedor que estira,
        la caja azul medía lo que midiera la página entera —5.739 px en Ayuda—. Se veía
        la franja de color de arriba abajo, pero los enlaces vivían en los primeros
        400 px y se iban con el scroll: en Ayuda, a media página, el menú estaba 1.296 px
        más arriba y no había forma de navegar sin volver al principio. Pasaba en todo
        el panel, y en las pantallas largas —Ayuda, reservas, ocupación— siempre.

        El scroll de la lista NO se pone acá: el `<nav>` de `Enlaces` ya es
        `flex-1 overflow-y-auto`. Poner un segundo `overflow` en el aside dejaría dos
        contenedores de scroll anidados peleándose por la rueda. Repartido así, la marca
        y el pie quedan siempre a la vista y solo scrollea la lista, que es lo que
        conviene cuando la ventana es baja.
      */}
      <aside
        ref={refLateral}
        style={{ width: colapsado ? ANCHO_COLAPSADO : ancho }}
        className={`relative hidden shrink-0 flex-col lg:sticky lg:top-0 lg:flex lg:h-screen ${FONDO_LATERAL}`}
      >
        <Marca colapsado={colapsado} />
        <Enlaces rol={rol} pathname={pathname} colapsado={colapsado} />

        {/*
          Pie: ubicación (solo expandido, no entra en 68 px) + botón para
          colapsar/expandir. `aria-pressed` es lo que corresponde a un control
          de dos estados persistente, no un botón de acción puntual.
        */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-3">
          {!colapsado && (
            <p className="truncate px-1 text-[11px] text-lago-200/70">El Calafate · Santa Cruz</p>
          )}
          <button
            type="button"
            onClick={() => guardarColapso(!colapsado)}
            aria-pressed={colapsado}
            title={colapsado ? 'Expandir el menú' : 'Colapsar el menú a solo íconos'}
            aria-label={colapsado ? 'Expandir el menú' : 'Colapsar el menú a solo íconos'}
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-lago-200/70 transition hover:bg-white/10 hover:text-white ${
              colapsado ? 'mx-auto' : ''
            }`}
          >
            <Icono nombre={colapsado ? 'siguiente' : 'anterior'} tam={16} />
          </button>
        </div>

        {/*
          Manija para cambiar el ancho del menú. No tiene sentido colapsado —
          el ancho de íconos es fijo— así que desaparece junto con el resto de
          lo que no entra en 68 px.

          Es un `separator` enfocable, que es el rol que la norma ARIA da a un
          divisor ajustable: con eso un lector de pantalla lo anuncia y dice en
          qué valor está. Responde a las flechas además del arrastre, porque un
          control que solo funciona con el mouse deja afuera a quien navega con
          teclado.

          El doble clic devuelve el ancho original. Es la salida para quien lo
          arrastró sin querer y no sabe cómo volver — y está dicha en el `title`,
          no escondida.
        */}
        {!colapsado && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar el ancho del menú"
            aria-valuenow={ancho}
            aria-valuemin={ANCHO_MINIMO}
            aria-valuemax={ANCHO_MAXIMO}
            tabIndex={0}
            onPointerDown={alArrastrar}
            onKeyDown={alTeclear}
            onDoubleClick={() => guardarAncho(ANCHO_POR_DEFECTO)}
            title="Arrastrá para cambiar el ancho del menú. Doble clic para volver al original."
            className="group absolute inset-y-0 -right-1 z-20 flex w-2 cursor-col-resize touch-none items-center justify-center"
          >
            {/* La línea es fina y translúcida hasta que se la busca: el borde
                del menú no tiene que competir con la navegación. */}
            <span
              aria-hidden="true"
              className="h-full w-px bg-white/10 transition group-hover:w-0.5 group-hover:bg-lenga-400 group-focus-visible:w-0.5 group-focus-visible:bg-lenga-400"
            />
          </div>
        )}
      </aside>

      {/* Cajón — móvil */}
      {abierto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
            onClick={() => setAbierto(false)}
            aria-label="Cerrar el menú"
          />
          <div
            className={`absolute inset-y-0 left-0 flex w-64 flex-col shadow-2xl ${FONDO_LATERAL}`}
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
          >
            <div className="flex items-center justify-between border-b border-white/10 pr-2">
              <div className="min-w-0 flex-1">
                <Marca />
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded-lg p-2 text-lago-100 transition hover:bg-white/10"
                aria-label="Cerrar el menú"
              >
                <Icono nombre="cerrar" tam={20} />
              </button>
            </div>
            <Enlaces rol={rol} pathname={pathname} alNavegar={() => setAbierto(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-stone-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="rounded-lg p-2 text-stone-600 transition hover:bg-stone-100 lg:hidden"
            aria-label="Abrir el menú"
            aria-expanded={abierto}
          >
            <Icono nombre="menu" tam={20} />
          </button>
          <span className="font-display text-base font-semibold text-lago-800 lg:hidden">
            Blanca Patagonia
          </span>

          {/*
            Espaciador izquierdo. Junto con su gemelo de la derecha es lo que
            CENTRA de verdad el buscador: `mx-auto` no alcanza sobre un ítem flex
            que crece, y con el menú de cuenta a un lado y nada al otro el campo
            quedaba corrido 168 px a la izquierda (medido). Dos espaciadores con
            el mismo `flex-1` reparten el sobrante en partes iguales, así que el
            centro del campo cae en el centro de la barra pase lo que pase con el
            largo del nombre de quien inició sesión.
          */}
          <div className="hidden flex-1 lg:block" aria-hidden="true" />

          {/*
            Buscador global, centrado en la barra.

            Está en el medio y no arrinconado a la derecha porque hace dos cosas y
            las dos son de las más usadas: encontrar a alguien mientras está al
            teléfono, y encontrar EN QUÉ PARTE DEL SISTEMA se hace algo. Lo segundo
            lo necesita sobre todo quien recién empieza, que es justamente a quien
            menos le sirve un campo escondido en una esquina.

            El centrado es `mx-auto` sobre un ancho máximo, no una grilla de tres
            columnas: así el campo queda centrado respecto del contenido y no se
            corre cuando el nombre de quien inició sesión es más largo o más corto.
          */}
          {/*
            `min-w-0` (dentro de `BuscadorGlobal`): sin él, este ítem de flex
            no se achica más allá del ancho natural de su contenido (la
            trampa documentada en CLAUDE.md) y en una ventana muy angosta
            empuja al menú de cuenta fuera de la pantalla en vez de ceder
            espacio.
          */}
          <BuscadorGlobal />

          <div className="ml-auto flex min-w-0 flex-1 justify-end lg:ml-0">
            <MenuCuenta nombre={nombre} rolEtiqueta={rolEtiqueta} salir={salir} />
          </div>
        </header>

        <main id="contenido" className="min-w-0 flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
    </ConfirmarProvider>
    </AvisosProvider>
  )
}
