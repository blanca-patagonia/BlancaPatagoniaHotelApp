# ADR 0039 — Asistente de IA del panel, con herramientas de datos de solo lectura

- **Estado:** Aceptada
- **Fecha:** 2026-09-15
- **Origen:** pedido del dueño del hotel: un chat de IA en el panel para
  preguntar por datos del sistema (ocupación, porcentajes, ADR y demás
  números de un hotel), que facilite dudas y sugiera mejoras.

## Contexto

El sistema ya tiene un `AsistenteProvider` (ADR 0011): reglas fijas, sin
modelo de lenguaje detrás, usado en el portal público para preguntas
frecuentes del huésped. Fue una decisión deliberada en su momento —un huésped
haciendo una pregunta sensible (plata, disponibilidad) a un modelo que puede
alucinar era un riesgo que no valía la pena—. Lo que pide el hotel ahora es
otra cosa: **un asistente para el staff**, adentro del panel, que conteste
con los números reales del hotel (ocupación, ADR, facturación, reservas) y
pueda sugerir mejoras de gestión. Eso sí necesita un modelo de lenguaje de
verdad: reglas fijas no alcanzan para una pregunta libre en lenguaje natural.

El hotel todavía no decidió con qué proveedor — se habló de un nivel gratuito
de NVIDIA, o de otros como OpenRouter — así que la decisión de arquitectura
no puede atarse a una marca.

## Decisión

**Un adapter genérico compatible con el formato de OpenAI** ("chat
completions" con `tools`/function-calling), configurado por variables de
entorno (`IA_PROVIDER=openai_compatible`, `IA_BASE_URL`, `IA_API_KEY`,
`IA_MODELO`). Ese formato lo hablan la mayoría de los proveedores del
mercado —OpenAI, NVIDIA NIM, OpenRouter, Groq, y otros—, así que cambiar de
proveedor es cambiar tres variables, no código. Sin SDK, por HTTP directo:
mismo criterio que el resto de los adapters del proyecto.

**El modelo nunca contesta un dato del hotel de memoria.** El system prompt
(`lib/domain/ia-herramientas.ts`) le exige llamar a una herramienta para
cualquier número — ocupación, ADR, facturación, reservas, satisfacción — y
la ejecución real (`app/panel/ia/herramientas.ts`) lee la base con las
**mismas consultas que ya usan los informes gerenciales**
(`app/panel/reportes/datos.ts` + `lib/domain/metricas*.ts`): un mismo número
en el asistente y en Reportes es la garantía de que no van a decir cosas
distintas. Las herramientas son de **solo lectura**: ninguna hace `insert`,
`update` ni `delete`, y corren con el cliente del usuario (RLS), nunca con
`service_role` — el asistente sólo puede leer lo que la persona que lo usa
ya podría leer entrando a Reportes.

**Sin proveedor configurado, no hay simulador — la pantalla lo dice.** Los
otros nueve adapters del proyecto tienen un simulador que no hace la
operación real pero deja recorrer la pantalla en desarrollo. Acá un
simulador tendría que **inventar una respuesta**, y una respuesta inventada
sobre datos del hotel es exactamente lo que el resto del sistema evita en
cada rincón (el "USD 0" de la Fase 18, el `precio_neto` del ADR 0016, la
cotización que "no inventa" en `lib/divisas`). El criterio es el mismo que
`WhatsAppProvider` (`lib/whatsapp/`): sin credenciales, el canal
**no se ofrece**, no se simula.

**Área nueva (`ia`), sólo para admin y gerencia.** Contesta con datos de
plata y de ocupación — los mismos que ya son privados en `reportes` y
`conciliacion` — y corre contra un proveedor externo, potencialmente pago:
no tiene sentido dárselo a recepción ni a housekeeping, que tampoco entran a
esos otros dos módulos.

**Sin persistencia de conversación (v1).** El historial vive en el estado
del componente de cliente y se manda entero (acotado) en cada consulta; no
hay tabla nueva. Guardar el historial de chat es una mejora futura razonable
—por ejemplo para auditar qué se preguntó—, pero no hacía falta para la
primera versión y evita una migración y una política RLS más de las que
mantener.

**Tope de vueltas de herramienta por consulta (4).** Cada vuelta es una
llamada al proveedor, que en la mayoría de los planes gratuitos tiene cupo
limitado. Sin este tope, un modelo que insiste en pedir la misma herramienta
agotaría el cupo del hotel con una sola pregunta.

## Lo que NO se puede cerrar desde el código

1. **Elegir y contratar (o dar de alta gratis) un proveedor real.** Es un
   trámite del hotel con su cuenta, igual que WhatsApp Business o Mercado
   Pago en sus propios ADRs.
2. **Que el modelo elegido de verdad soporte `tools`/function-calling.**
   No todos los modelos de los niveles gratuitos lo soportan igual de bien;
   el system prompt refuerza "nunca inventes" pero es una instrucción, no
   una garantía a nivel de código — un modelo que ignore la instrucción de
   todas formas podría inventar un número. Es una limitación conocida y
   documentada, no resuelta: si aparece en la práctica, la mitigación futura
   sería validar la respuesta contra alguna herramienta antes de mostrarla,
   o exigir que el modelo elegido soporte `tool_choice: "required"`.
3. **Rediseñar Conversaciones como bandeja única, estilo Chatwoot.** Es un
   pedido aparte del mismo hotel (ver la nota en esa pantalla): no se trata
   de integrar la aplicación Chatwoot —es un sistema separado, Rails +
   Postgres + Redis, que habría que hostear—, sino de rehacer la pantalla
   actual (hoy organizada por canal interno) como una bandeja por
   **conversación**, con WhatsApp e Instagram como canales nuevos y el
   historial de cada contacto unificado sin importar por dónde escribió.
   Queda para cuando lleguen el código y las credenciales de esos dos
   canales, como una pasada de diseño propia.
