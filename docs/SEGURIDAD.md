# Seguridad — hallazgos y correcciones

Formato de cada entrada: **qué encontré → por qué es riesgo → qué hice → cómo
verificarlo**.

---

## 🔴 1. El alta pública de reservas no tenía límite de volumen

### Qué encontré
`crearReservaPublica` (`app/reservar/actions.ts`) no aplicaba ninguna
restricción por IP. Cualquiera podía enviar el formulario público las veces que
quisiera, sin autenticarse.

### Por qué es riesgo
No es spam molesto: **cada reserva pendiente bloquea una unidad durante 5 días**
(`expirar_reservas_pendientes`, migración 0011). El hotel tiene 15 unidades.

Un script que enviara el formulario unas decenas de veces dejaba al hotel **sin
inventario vendible durante casi una semana**. Es una denegación de servicio
contra el negocio, no contra el servidor, y se ejecuta desde un navegador.

### Qué hice
Migración `0029_limite_de_intentos.sql`:

- Tabla `intentos_limitados` (IP, acción, fecha) **sin políticas RLS de lectura
  ni escritura** y con los permisos revocados a `anon` y `authenticated`. La
  maneja solo la función de abajo: nadie debería poder consultar desde qué IPs
  se intentó algo, ni borrar su propio rastro.
- Función `registrar_intento(ip, accion, maximo, minutos)`, `security definer`.
  **Inserta primero y cuenta después**, dentro de la misma llamada. Eso la hace
  atómica: si dos peticiones simultáneas leyeran el conteo y después
  insertaran, ambas podrían pasar el techo.
- `purgar_intentos()` programada por hora, para que la tabla no crezca sin fin.

Los límites viven en `lib/domain/limites.ts`, **cada uno con su justificación
escrita**. Un límite sin motivo se termina ajustando a ojo cuando alguien se
queja, y ahí deja de proteger.

| Acción | Límite | Por qué ese número |
|---|---|---|
| Reserva pública | 5 / hora | Una familia reserva 3-4 habitaciones seguidas; un ataque necesita cientos |
| Login | 10 / 15 min | Tolera a quien no recuerda la contraseña; corta la fuerza bruta |
| Encuesta | 3 / hora | Se responde una vez; evita inflar el NPS de los reportes |

**Decisión deliberada:** si la comprobación falla (base caída, encabezado
ausente), se **deja pasar**. El limitador protege contra abuso, pero si se rompe
no debe impedir que un huésped legítimo reserve. Bloquear todo ante un fallo del
contador convierte un problema de infraestructura en una caída de ventas.

### Cómo verificarlo
```bash
# 6 intentos con máximo 5: el sexto debe dar false
for i in 1 2 3 4 5 6; do
  curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/registrar_intento" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"p_ip":"203.0.113.9","p_accion":"reserva_publica","p_maximo":5,"p_minutos":60}'
done
```
Resultado comprobado: `true true true true true false`. Otra IP sigue en `true`.

```bash
# anon no debe poder leer la tabla
curl -s "$SUPABASE_URL/rest/v1/intentos_limitados?select=ip" -H "apikey: $ANON_KEY"
# → 42501 permission denied for table intentos_limitados
```

---

## 🟠 2. El login no limitaba reintentos

### Qué encontré
`iniciarSesion` consultaba las credenciales sin restricción de volumen.

### Por qué es riesgo
Fuerza bruta contra las cuentas del personal. Supabase Auth aplica su propio
límite del lado del servidor, lo que **mitiga** el ataque, pero no lo registra
localmente ni lo frena antes de llegar — con lo cual tampoco hay forma de
enterarse de que está ocurriendo.

### Qué hice
Mismo limitador, 10 intentos cada 15 minutos. Se comprueba **antes** de
consultar las credenciales, para no darle a un atacante una vía de deducir si un
email existe midiendo el tiempo de respuesta.

Se dejó asentado en el código por qué el mensaje de error es único («Email o
contraseña incorrectos»): distinguir «no existe» de «contraseña incorrecta» le
confirmaría a un atacante qué cuentas existen.

### Cómo verificarlo
Once intentos fallidos seguidos desde la misma IP: el undécimo responde
«Demasiados intentos» en lugar de consultar las credenciales.

---

## ✅ Gestión de secretos — sin hallazgos

Tres comprobaciones, todas limpias (ver `docs/AUDITORIA_INICIAL.md` §3):
ningún `.env` en el historial, ningún token real en los 44 commits, ningún
literal sospechoso en el código. **No hace falta rotar credenciales.**

---

## Pendiente de esta fase

- Contraseña por defecto del seed (`blancadev1234`): impedir que se use fuera
  de desarrollo.
- Headers de seguridad en `next.config.ts`.
- **Auditar cada política RLS, una por una.** Están activadas en las 32 tablas,
  pero eso no dice qué permite cada una.
- Validación con Zod en el borde público (hoy es una expresión regular).
- Límite en la encuesta pública (el limitador ya existe; falta conectarlo).
