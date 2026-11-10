# Preparación de la documentación de la tesis

> Hoja de ruta para escribir la tesis sobre la **versión reducida** (rama
> `tesis-a-presentar`, [ADR 0045](../decisiones/0045-version-reducida-para-la-tesis.md)).
> Reúne lo que la cátedra exige, lo que ya está escrito y lo que falta, para que
> quien escriba no tenga que reconstruirlo.

## 1. Qué exige la cátedra

### Estructura (checklist de avances: PP2 + PP3)

**Parte 1 — Relevamiento y propuesta (PP2)**
1. Introducción: carta de presentación (opcional) · pedido del usuario.
2. Relevamiento: contextual y del negocio · estructura de la organización · procesos de negocio (cada uno con **cursograma + descripción**) · tecnología (existente en la empresa y en el mercado).
3. Propuesta: diagnóstico y propuesta · propuesta general.

**Parte 2 — Modelado y desarrollo del sistema (PP3)**
4. Objetivos, límites y alcance.
5. Especificación de requerimientos.
6. Análisis y diseño del producto: modelado ambiental · modelado de paquetes · modelado de los casos de uso (por módulo y por caso de uso: requerimientos específicos, prototipos de interfaz, **ficha de caso de uso**, vista estática, vista dinámica).
7. Implementación del software (por módulo y caso de uso).
8. Integración y testing.
9. Especificaciones del sistema: despliegue · hardware mínimo y óptimo · software de base y de aplicación · **seguridad y auditoría**.

### Formato del documento final

- Hoja **A4**, márgenes de **2,5 cm** (superior, inferior y laterales).
- Texto **justificado**, con partición automática de palabras. Párrafos con sangría de 1,25 cm sin espacio entre ellos, o con espacio entre párrafos sin sangría (una de las dos, siempre la misma).
- Tipografía serifada (Times New Roman, Garamond) o sans-serif (Arial) para texto técnico; cuerpo de **10 a 12 pt**; interlineado **1,2 a 1,5**.
- Debe tener: **carátula, índice general, índice de figuras, membrete y número de página**.
- Toda imagen lleva **epígrafe** debajo: número de figura, descripción, año y fuente (las propias se rotulan «elaboración propia»). Las de terceros citan el autor, la obra o el enlace.

## 2. Qué hay escrito

| Archivo | Estado |
|---|---|
| [`tesis-completa.md`](tesis-completa.md) | Ya sigue la estructura de la cátedra (PP2 + PP3, 11 capítulos). Está escrita para el **sistema completo**: hay que ajustarla al alcance reducido. |
| [`tesis-pp3.md`](tesis-pp3.md) | Entrega de PP3 anterior. Referencia; no es la base. |

Los PDF generados se borraron a propósito: describían el sistema completo. Se
regeneran al final.

### Qué hay que cambiar en `tesis-completa.md`

- **Quitar el «Módulo 5 — Canales de venta»** (§9.6, §10.5) y todo lo que lo nombre: Booking, iCal, comisiones, ARI.
- **Reubicar Housekeeping** (queda; solo cambia su vecino) y reescribir **Gestión y administración** (§9.7, §10.6) con lo que queda: usuarios y roles, tarifario, temporadas, promociones, inventario, divisas, datos fiscales, tipos de alojamiento, ubicaciones, auditoría y errores.
- **Alcance (§4.3 a §4.5):** el sistema es el pedido original de PP2 (§1.2): reservas y estadías, check-in/check-out con facturación, consumos, huéspedes y reportes, más pagos y correo. **La tesis presenta el producto terminado que se le entrega al cliente: NO menciona en ningún momento los módulos quitados, ni la rama, ni la ADR 0045, ni «versión reducida».** Lo que el hotel no pidió simplemente no figura (ni como «fuera de alcance» ni como trabajo futuro).
- **Requerimientos (§5):** sacar los de canales, contratos, agencias, proveedores, mantenimiento, conciliación, bandeja, asistente de IA y otros idiomas.
- **Cifras:** 12 áreas del panel, 55 páginas, 29 ADRs, 3 tareas programadas, ~51.000 líneas en `src/`. Recontar al final (ver §4).
- **Modelo de datos (§6.3):** presentar las **30 tablas** que el código usa y aclarar que la base conserva 39 más sin pantalla (`docs/2-arquitectura/modelo-datos.md` las separa).
- **Testing (§11):** los números reales de esta rama. Hoy 1.197 tests corren sin base; los 583 de base de datos requieren Docker y **hay que correrlos antes de citarlos** (`npm run test:aislado`).

## 3. Inventario del sistema reducido (lo que hay que documentar)

**Actores:** administrador, gerencia, recepción, housekeeping (con cuenta) y huésped (sin cuenta, por enlace con token).

**Módulos y casos de uso candidatos**

| Módulo | Pantallas / flujos | Casos de uso centrales |
|---|---|---|
| Reservas y estadías | `panel/reservas` (listado, alta, grupo, ficha, cuenta, factura), `panel/ocupacion` (grilla con arrastre) | Buscar disponibilidad · Crear reserva (mostrador / web) · Confirmar · Check-in · Check-out · Cancelar · Reprogramar · Cambiar de unidad · Reserva grupal |
| Consumos | `panel/punto-venta`, cuenta de la reserva (folios A/B) | Cargar consumo · Anular comanda · Mover de folio |
| Cuenta, pagos y facturación | cuenta, factura, notas de crédito, `pago-simulado`, `pago-payway`, `reservar/pagar/[token]`, webhook de pagos | Registrar pago · Cobrar en línea · Emitir factura (CAE) · Emitir nota de crédito |
| Huéspedes | `panel/huespedes`, fidelidad, fusión de fichas | Alta / edición · Fusionar duplicados · Acumular puntos |
| Portal público | `[idioma]/` (portada, alojamientos, reservar, checkout), confirmación, factura, encuesta | Consultar disponibilidad · Reservar y pagar · Ver mi reserva y mi factura · Responder la encuesta |
| Housekeeping | `panel/housekeeping`, `mi-trabajo` (móvil) | Ver tareas por prioridad · Marcar limpia · Inspeccionar |
| Reportes | `panel/reportes/*` (ocupación, categorías, estados, satisfacción, facturación), exportación CSV | Consultar ocupación / ADR / RevPAR · Exportar |
| Administración | `panel/usuarios`, `panel/config/*`, `panel/auditoria`, `panel/errores`, `panel/buscar`, `panel/ayuda` | Gestionar usuarios y roles · Mantener tarifas y temporadas · Consultar la auditoría |

**Tablas que usa el código** (30): `reservas`, `huespedes`, `unidades`, `pagos`, `tipos_unidad`, `estadias`, `consumos`, `productos_servicios`, `facturas`, `perfiles`, `promociones`, `temporada_rangos`, `temporadas`, `tarifas`, `encuestas_satisfaccion`, `notificaciones`, `notas_credito`, `politicas_cancelacion`, `errores`, `cotizaciones`, `housekeeping_registros`, `departamentos`, `datos_fiscales`, `cron_corridas`, `consultas_bot`, `auditoria_accesos`, `auditoria`, más numeración fiscal y límite de intentos.

**Funciones de la base** que llama la aplicación: `crear_reserva`, `avanzar_estado_reserva`, `cambiar_unidad_reserva`, `editar_ficha_reserva`, `aplicar_precio_reserva`, `cotizar_estadia`, `cotizar_estadia_publica`, `unidades_disponibles`, `disponibilidad_por_tipo`, `actualizar_tarifas_en_lote`, `fusionar_huespedes`, `buscar_huespedes_parecidos`, `sumar_puntos_huesped`, `reponer_stock`, `siguiente_comanda`, `registrar_acceso_huesped`, `registrar_intento`, `consultas_recientes_de_ip`.

**Decisiones de arquitectura para citar** (en `docs/decisiones/`): 0001 stack · 0002 anti-overbooking en la base · 0003 / 0020 moneda y cotización · 0004 tarifas neto / rack / IVA · 0005 autenticación y roles · 0006 / 0027 / 0038 pagos · 0007 portal público · 0008 consumos y factura · 0012 facturación electrónica · 0016 precio neto fuera del alcance público · 0017 alta de usuario sin privilegios · 0018 simuladores que fallan fuerte · 0024 exención de IVA · 0025 tarjeta sin guardar el número · 0033 arrastrar cambia de habitación · 0042 verificación · 0045 versión reducida.

## 4. Lo que falta producir

1. **Figuras.** Diagrama de contexto, de paquetes y de casos de uso (se dibujan a partir de §3); **DER** generado de las migraciones; **capturas** de las pantallas con la aplicación corriendo (requiere las variables de entorno de Supabase en una sesión nueva); cursogramas de los procesos del relevamiento.
2. **Fichas de caso de uso** en el formato de la cátedra (nombre, actor, precondiciones, flujo principal, flujos alternativos, postcondiciones, reglas de negocio, requerimientos), con **diccionario de datos** por caso.
3. **Cifras verificadas:** correr `npm run test:aislado`, `npm run e2e` y recontar líneas, pantallas y tests.
4. **Regenerar el PDF** con el formato de la cátedra (A4, 2,5 cm, justificado, carátula, índices, membrete, paginación).

## 5. Decisiones ya tomadas por los autores

- **Versión de PP2 que vio el profesor:** `PP2_Moran_Fakiani` (la de mayo). Hay que respetar sus elementos formales, en particular la sección **«Firmas y conformidades»** y el **Anexo C: firma del comitente** (Franco Theo Cheli, Director de Blanca Patagonia S.A.S.).
- **Formato de entrega:** Word (`.docx`). El PDF se genera después si hace falta.
- **Casos de uso:** las tesis de ejemplo desarrollan entre 4 y 14 fichas completas (Bimba ~4, NutriSmart ~3, Club La Tablada ~14), cada una con diagrama de asociaciones, ficha, prototipo y diagrama de secuencia o interacciones. Se hacen **de 10 a 12 casos de uso completos** repartidos por módulo; no hace falta un «resto resumido».
- **Módulos quitados:** no se mencionan en ningún momento (ver §2).
