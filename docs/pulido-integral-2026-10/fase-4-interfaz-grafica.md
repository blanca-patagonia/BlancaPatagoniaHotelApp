# Fase 4 — Interfaz gráfica (2026-10-07)

> El navegador automatizado perdió acceso a `localhost` a mitad de la Fase 3
> (ver esa entrada de bitácora) y seguía sin recuperarse al llegar acá —
> probado de nuevo con el dev server recién levantado, mismo error. Esta
> fase se hizo por completo con grep dirigido sobre los criterios del
> brief, sin Lighthouse ni verificación visual en navegador.

## 1. Consistencia de componentes compartidos

- **`Pagina`**: 69 de las 70 pantallas del panel la usan. La única
  excepción, `app/panel/reservas/[id]/factura/page.tsx`, es a propósito:
  es un comprobante imprimible con `print:hidden`/`print:border-0` en toda
  su estructura, y envolverlo en el layout de pantalla rompería el PDF.
  **100 % de cumplimiento real.**
- **Paleta**: cero usos de `sky` o `amber` (los colores explícitamente
  prohibidos por el ADR 0026) en `app/`.
- **`Mensaje`** ya usa `role="alert"` para errores y `role="status"` para
  éxito — las dos son regiones ARIA-live implícitas, sin que nadie tuviera
  que acordarse de agregar `aria-live` a mano.
- **Toasts y esqueletos** ya tienen `aria-live="polite"` (`toast.tsx`,
  `esqueletos.tsx`) y los esqueletos además `aria-busy="true"`.

## 2. Estados de carga — se corrige un hallazgo falso de la Fase 0

La Fase 0 había anotado "13 rutas sin `loading.tsx`" como pendiente de
revisar. **No es una falta**: `loading.tsx` cascada en Next.js exactamente
igual que `error.tsx` (ya aclarado en esa misma fase), y las 13 quedan
cubiertas por el `loading.tsx` de un ancestro:

- 9 por `app/panel/loading.tsx`, que el propio archivo declara "cubre el
  resto" (el esqueleto del tablero).
- 2 por `app/reservar/loading.tsx`.
- 1 por `app/panel/canales/loading.tsx`.
- 1 (`app/panel/reservas/[id]/factura`) no necesita uno propio: es la misma
  pantalla sin `Pagina` del punto 1, de carga casi instantánea.

Ninguna pantalla queda en blanco durante la navegación. Corregido en
`fase-0-linea-de-base.md`.

## 3. Regresiones de los dos bugs de formato ya cerrados antes

- **Moneda**: cero usos nuevos de `.toLocaleString()` sobre un importe.
  Los 9 usos encontrados son todos cantidades (reservas, noches, puntos,
  filas de respaldo) — la excepción legítima que el propio `CLAUDE.md`
  declara. El único `.toFixed(2)` fuera de `lib/domain/moneda.ts` es el
  `defaultValue` de un `<input type="number">` editable
  (`app/panel/canales/page.tsx:1392`), donde `formatearUSD` rompería el
  parseo del campo — correcto tal como está.
- **Fechas**: cero usos de `new Date(iso).toLocaleDateString()` crudo fuera
  de las propias implementaciones de `lib/fechas.ts` (que sí pasan
  `timeZone: ZONA_HOTEL`). Ninguna pantalla nueva reintrodujo el bug de
  `hoyISO()`/Fase 18.
- **`overflow-hidden` sobre una tabla**: un solo candidato
  (`app/panel/ocupacion/page.tsx:601`), revisado y descartado: es la
  `Tarjeta` del estado vacío de la grilla (sin unidades a la vista), no
  envuelve ninguna tabla con datos.

## 4. Lo que NO se pudo verificar sin navegador

- **Responsive real** en 375/768/1280 px: no hay forma de medirlo con
  código estático. El grep de clases (`sm:`, `COL_SECUNDARIA`) sugiere
  disciplina, pero no reemplaza mirar la pantalla.
- **Contraste AA real** sobre `lago`: los tokens de color son consistentes,
  pero el contraste efectivo (texto sobre fondo) necesita medirse, no
  inferirse del nombre de la clase.
- **Lighthouse**: no disponible sin navegador real.
- **Orden de tabulación** en los formularios de reserva: necesita
  interacción real con teclado.

## 5. Los cinco archivos más grandes — no se tocaron, a propósito

`app/panel/canales/page.tsx` (2448 líneas), `reservas/actions.ts` (1901),
`reservas/[id]/page.tsx` (1646), `canales/actions.ts` (1134),
`ocupacion/page.tsx` (1004). El propio brief pone el criterio de
terminado: **"se parten SOLO si el corte no cambia comportamiento y los
tests existentes pasan sin editar una línea"**. Sin un solo test de
componente en todo el repo (`docs/analisis-pendientes-2026-09-09.md` §1,
sigue siendo cierto), partir cualquiera de estas pantallas no tiene con
qué verificarse sin editar código de producción a ciegas — exactamente lo
que el criterio quiere evitar. Se deja sin tocar, documentado, no
olvidado.

## Resumen

Cero hallazgos nuevos de código. Dos hallazgos falsos de la Fase 0
corregidos (`error.tsx`, ya corregido entonces; `loading.tsx`, corregido
acá). La interfaz ya tenía, antes de esta pasada, un nivel de consistencia
muy alto en todo lo que se puede verificar sin abrir un navegador — lo que
confirma lo que ya decía `CLAUDE.md` sobre las auditorías QA/UX previas.
