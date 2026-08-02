# ADR 0010 — Contratos y firma electrónica

- **Estado:** aceptada
- **Fecha:** 2026-08-02
- **Fase:** 10.1

## Contexto

El hotel firma convenios con agencias (tarifas netas), contratos con proveedores
y acuerdos con empleados. Hasta ahora eso vivía fuera del sistema: en papel o en
un PDF por email, sin registro de quién aceptó qué ni desde cuándo rige.

Se tomó como referencia la app **Firma (Sign)** de Odoo, adaptada al dominio
hotelero y al alcance académico del proyecto.

## Decisión

**1. Un modelo de contrato con ciclo de vida explícito.** Tabla `contratos` con
la máquina de estados `borrador → enviado → firmado | rechazado | vencido`, y
tabla `firmas` con la constancia de aceptación.

**2. Las reglas viven en el dominio puro.** `lib/domain/contratos.ts` concentra
las transiciones válidas y las condiciones de firma (no se firma un contrato
vencido; no se reenvía uno ya firmado). La vista pública, la Server Action y el
panel consultan **la misma función**, y está cubierta por 23 tests.

**3. Firma por token, sin cuenta.** La contraparte no es usuario del sistema. Se
reutiliza el mecanismo ya probado en la confirmación de reserva (migración
0011): un token opaco `uuid` en la URL actúa como credencial, y la página se
resuelve en el servidor con `service_role`. **`anon` no tiene ninguna política
de lectura** sobre `contratos` ni `firmas`.

**4. Adapter `FirmaElectronicaProvider`.** Mismo patrón que `PaymentProvider`:
interfaz estable + proveedor local. Enchufar DocuSign o un servicio de firma
digital es cambiar la variable de entorno `FIRMA_PROVIDER`, no reescribir el
módulo.

**5. Referencia polimórfica validada en la base.** `contratos.entidad_id` apunta
a `agencias`, `proveedores` o `perfiles` según `tipo`, así que no puede
declararse como clave foránea. Un trigger (`validar_entidad_contrato`) verifica
que la entidad exista en la tabla correcta. Se eligió esto sobre tres columnas
nullable con tres FKs porque mantiene la tabla legible y concentra la regla en
un solo lugar, coherente con el principio del proyecto de que la integridad
crítica vive en Postgres.

## Limitación explícita: esto NO es una firma digital legal

La constancia que produce el proveedor local registra:

- el **hash SHA-256** del texto tal como se le mostró al firmante,
- la **fecha y hora**, la **IP** y el **user-agent**,
- el **nombre** que declaró quien aceptó.

Eso permite detectar manipulación posterior (si alguien edita el contrato, el
hash deja de coincidir y la verificación lo delata) y deja trazabilidad de la
aceptación. **Pero no constituye firma digital ni firma electrónica avanzada en
los términos de la Ley 25.506** de Argentina: no hay certificado emitido por una
autoridad certificante licenciada, ni sellado de tiempo de un tercero de
confianza, ni verificación de identidad del firmante más allá de la posesión del
enlace.

Es una decisión consciente de alcance: incorporar firma digital real exige
contratar un certificador licenciado, algo fuera del presupuesto y del objetivo
de una tesis. La vista pública lo aclara al pie, para no inducir a error a quien
firma.

## Consecuencias

**A favor**

- Los convenios quedan dentro del sistema, con vigencia y estado consultables.
- La verificación de integridad es real: el hash se computa con Web Crypto y se
  puede recalcular en cualquier momento desde el panel.
- Quien firma no necesita cuenta, igual que el huésped que confirma su reserva.

**En contra / riesgos asumidos**

- Sin validez legal (ver arriba).
- **No hay envío de email**: el enlace se copia del panel y se manda a mano,
  porque el proyecto no integra un proveedor de correo real.
- Quien tenga el enlace puede firmar. El token es un UUID v4 (no enumerable),
  pero no hay segundo factor ni verificación de identidad.
- El texto del contrato es texto plano; no hay adjuntos ni PDF. `documento_url`
  queda previsto para cuando exista gestión documental (ver ADR 0012).
