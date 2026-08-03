# ADR 0014 — Portal de agencias y proveedores por token

- **Estado:** aceptada
- **Fecha:** 2026-08-03
- **Fase:** 11.2

## Contexto

El requisito original de la Fase 10 pedía que «cada agencia o proveedor vea solo
sus propios contratos desde el portal». Quedó sin implementar: lo único que
existía era la firma por token, que muestra **un** contrato puntual y nada más.
Una agencia no podía consultar qué convenios tiene vigentes ni cómo está su
cuenta corriente sin llamar por teléfono al hotel.

## Decisión

Se implementa un **portal por token**, no un sistema de cuentas.

Cada fila de `agencias` y `proveedores` recibe un `token uuid` único (migración
0024). La URL `/portal/[token]` muestra, en una sola pantalla:

- la **cuenta corriente** con sus movimientos, saldo y —para proveedores— el
  vencimiento y estado de cada comprobante;
- sus **contratos**, con estado y vigencia, y un botón para firmar los que estén
  pendientes (reutilizando el flujo de firma de la Fase 10).

Se resuelve en el servidor con `service_role`, igual que la confirmación de
reserva (0011), la firma (0018) y la encuesta (0023). **`anon` no recibe ninguna
política de lectura nueva.**

### La regla de aislamiento vive en el dominio

`contratosDeEntidad(tipo, entidadId, contratos)` filtra por tipo **y** por id, y
además **oculta los borradores**: un contrato que el hotel todavía está
redactando no debe aparecerle a la contraparte.

Se aplica aunque la consulta SQL ya filtre por entidad. Es deliberado: el
aislamiento es una propiedad de seguridad, y tenerlo como función testeada
significa que no depende de que alguien recuerde el `.eq()` en la próxima
consulta que se escriba.

### Por qué token y no cuentas de usuario

| | Token | Cuentas reales |
| --- | --- | --- |
| Alta | El hotel manda un enlace | Registro público, verificación de identidad |
| Modelo | Ninguna tabla nueva | Rol nuevo + mapeo usuario→entidad + políticas RLS |
| Superficie de ataque | Una URL adivinable solo por fuerza bruta sobre UUID v4 | Login público, recuperación de contraseña, sesiones |
| Consistencia | Igual que los otros tres flujos públicos | Un cuarto mecanismo distinto |

Para un hotel con una decena de agencias y proveedores, montar autenticación
pública agrega riesgo y complejidad sin resolver un problema real. La decisión
es la misma que se tomó para el huésped, que confirma su reserva por token sin
cuenta.

## Consecuencias

**A favor**

- Cierra el requisito sin abrir una superficie de autenticación pública.
- El socio se autoatiende: deja de llamar para preguntar el saldo.
- La regla de aislamiento está testeada (5 casos) y es una sola.

**En contra / riesgos asumidos**

- **Quien tenga el enlace, ve la información.** El token es un UUID v4 (no
  enumerable) y la pantalla advierte que es personal, pero no hay segundo factor
  ni caducidad. Si un socio reenvía el correo, el destinatario accede.
- **No hay rotación de token.** Si se filtra, hoy hay que cambiarlo a mano en la
  base. Un botón de «regenerar enlace» en el panel es la mejora natural.
- El portal es de **solo lectura**, salvo firmar. El socio no puede subir una
  factura ni disputar un cargo.
- No se registra quién accedió ni cuándo. Si eso importara, corresponde extender
  la tabla `auditoria` a los accesos del portal.
