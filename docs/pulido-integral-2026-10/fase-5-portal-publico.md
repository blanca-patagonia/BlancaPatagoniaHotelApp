# Fase 5 — Portal público del huésped (2026-10-07)

> Mismo problema de navegador que las Fases 3 y 4: `localhost` sigue sin
> cargar en el navegador automatizado. Verificación por lectura de código
> dirigida a los tres riesgos concretos que señala el brief: dato de otro
> huésped por URL, precio neto expuesto, fotos de tipos que no existen.

## 1. Ningún dato de otro huésped alcanzable por URL

Las seis rutas públicas por token (`encuesta/[token]`, `portal/[token]`,
`firmar/[token]`, `reservar/confirmacion/[token]`, `reservar/pagar/[token]`,
`reservar/factura/[token]`) resuelven **siempre** su fila principal con
`.eq('token', token)` primero, y todo lo que consultan después sale del
`id` de ESA fila (`reserva_id`, `agencia_id`/`proveedor_id` del socio) —
nunca de un parámetro separado que alguien pudiera cambiar en la URL. El
único patrón adicional es `portal/[token]` (`.eq('activo', true)`), que es
la revocación de enlaces del ADR correspondiente, no un hueco.

No se encontró ningún `select` que traiga una lista de reservas, contratos
o encuestas ajenos a la fila resuelta por el token.

## 2. Ningún precio neto expuesto

- `lib/catalogo/publico.ts` — `tarifasPublicas()` selecciona **solo**
  `precio_rack` (comentario propio: "el neto es de agencia y `anon` no...").
- Las tres cotizaciones del portal (`app/reservar/page.tsx`,
  `app/reservar/actions.ts`, `app/reservar/checkout/page.tsx`) llaman a
  `cotizarEstadia` con `tarifaTipo: 'rack'` **hardcodeado** — ninguna lee el
  tipo de tarifa de un parámetro que un huésped pudiera manipular.
- Los dos catálogos (`/alojamientos` y `/alojamientos/[codigo]`) también
  seleccionan solo `precio_rack` y pasan el resultado por `conIva()` antes
  de mostrarlo — consistente con la regla de `CLAUDE.md`.
- `reservar/confirmacion/[token]` y `reservar/factura/[token]` muestran
  `reservas.total` (ya con IVA, fijado al reservar) y `facturas.neto`
  —el neto **del comprobante fiscal**, que es un concepto distinto del
  neto de agencia y es obligatorio mostrarlo en cualquier factura—. Ninguna
  columna de `tarifas.precio_neto` aparece en ningún `select` de estas rutas.

## 3. Fotos del catálogo

Ya cubierto en el repaso de `lib/domain/catalogo.ts`: `FOTOS` no tiene
entradas para `CAB-UPSALA` ni `CAB-MORENO` (los dos tipos reales sin
tarifa cargada todavía, a la espera de que el hotel confirme precio — ver
Fase 0/`tests/acciones/reservas.test.ts`), y `PortadaAlojamiento` ya tiene
un diseño de respaldo **terminado**, no un ícono de imagen rota, para
cuando `fotoDe()` devuelve `null`. Nada que corregir.

## Lo que no se pudo verificar sin navegador

El recorrido real como huésped (buscar sin login, abrir el asistente del
portal, completar el checkout mirando la pantalla, descargar la factura
por el enlace) — la Fase 2.7 de esta misma rama ya hizo ese recorrido para
el flujo de reserva/pago de punta a punta el 2026-10-06, así que esa parte
puntual sí está verificada en vivo. Lo que falta de esta fase
específicamente es el resto de las pantallas públicas (`/alojamientos`,
`/encuesta`, `/firmar`) y el asistente del portal, que no se tocaron en
aquella corrida.

## Resumen

Cero hallazgos. Los tres riesgos que el brief señala explícitamente para
esta fase ya estaban cerrados de antes.
