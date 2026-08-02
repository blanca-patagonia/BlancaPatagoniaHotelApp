# ADR 0011 — Asistente del portal público basado en reglas (no LLM)

- **Estado:** aceptada
- **Fecha:** 2026-08-02
- **Fase:** 10.2

## Contexto

El portal público recibe siempre las mismas consultas: a qué hora es el
check-in, cómo es la política de cancelación, si hay estacionamiento, si aceptan
mascotas. Hoy esas preguntas llegan por WhatsApp o teléfono y las contesta
recepción una por una.

La solución de moda sería conectar un modelo de lenguaje. Se evaluó y **se
descartó** para este proyecto.

## Decisión

Se implementa un **asistente basado en reglas** sobre el dominio propio:

1. `detectarIntencion(pregunta)` normaliza el texto (minúsculas, sin tildes,
   sin puntuación) y lo compara contra listas de palabras clave ordenadas por
   prioridad.
2. `componerRespuesta(intencion, datos)` arma la respuesta **con datos reales**:
   la política de cancelación se redacta a partir de las reglas cargadas en
   `politicas_cancelacion`, no de un texto fijo. Si el hotel cambia la política,
   el asistente responde la nueva sin tocar código.
3. Las intenciones de precio y disponibilidad **derivan al buscador real**, que
   ya consulta la RPC anti-overbooking.
4. Lo que no matchea ninguna regla se responde con honestidad («te vamos a
   contactar») y **se registra en `consultas_bot`** para que el staff le dé
   seguimiento desde el panel. Esa bandeja es, además, la fuente para saber qué
   reglas nuevas conviene agregar.

Todo esto vive en `lib/domain/asistente.ts`, es determinista y está cubierto por
18 tests.

## Por qué no un LLM

- **Costo recurrente.** Una API de LLM se paga por token, indefinidamente. Es
  una tesis sin presupuesto operativo y sin cliente que absorba ese gasto.
- **Credenciales.** El proyecto sostiene como regla no incorporar claves de
  servicios reales (ver pagos, facturación y firma). Una API key de un
  proveedor de IA rompería esa consistencia.
- **Alucinaciones sobre datos del negocio.** Un modelo puede inventar una
  política de cancelación o un precio. Acá la respuesta se construye desde la
  base: es verificable y auditable, que es justamente lo que se le pide a un
  sistema de gestión.
- **Determinismo y tests.** Las reglas se prueban con Vitest como cualquier otra
  lógica de dominio. Un LLM no admite ese tipo de verificación.

## Diseño desacoplado para el futuro

La interfaz `AsistenteProvider` (`lib/asistente/index.ts`) sigue el mismo patrón
que `PaymentProvider` y `FirmaElectronicaProvider`:

```ts
export interface AsistenteProvider {
  nombre: string
  responder(pregunta: string): Promise<RespuestaAsistente>
}
```

Enchufar un modelo real es escribir una clase que implemente esa interfaz y
cambiar `ASISTENTE_PROVIDER`. **El dominio no se reescribe**: el tipo
`RespuestaAsistente` (intención, texto, acción sugerida, si deriva) sirve igual
para un LLM. Incluso conviene conservar las reglas como capa previa, para
resolver sin costo las preguntas frecuentes y mandar al modelo solo la cola
larga.

## Consecuencias

**A favor**

- Costo cero, sin claves, sin dependencias nuevas.
- Respuestas siempre consistentes con los datos del sistema.
- La bandeja de consultas sin responder mide la cobertura real del bot.

**En contra / limitaciones**

- **No entiende lenguaje natural**, solo palabras clave: una pregunta con
  sinónimos que no estén en las listas cae en «desconocida». Es un fallo
  aceptable porque la derivación al staff es explícita y honesta.
- No mantiene contexto entre preguntas (cada consulta se evalúa sola).
- Los horarios y servicios están como constantes en `lib/asistente/index.ts`:
  no hay tabla de configuración general todavía.
