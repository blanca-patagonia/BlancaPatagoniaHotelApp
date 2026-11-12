#!/usr/bin/env python3
"""Genera el diccionario de datos de la tesis (Markdown) desde el esquema real.

Uso:  PGPASSWORD=postgres python3 generar-diccionario.py > ../../diccionario-de-datos.md
Los tipos, las claves y la obligatoriedad salen de la base; las descripciones, de este archivo.
"""
import subprocess, sys

D = {
'huespedes': ("Personas que se alojan o reservan. Una ficha por huésped.", {
 'id':'Identificador del huésped.','nombre':'Nombre de pila.','apellido':'Apellido. Único dato obligatorio para reservar en el mostrador.',
 'doc_tipo':'Tipo de documento (DNI, pasaporte, etc.).','doc_numero':'Número de documento.','email':'Correo al que se envían la confirmación y los avisos.',
 'telefono':'Teléfono de contacto.','nacionalidad':'Nacionalidad declarada.','notas':'Observaciones internas de recepción.','creado_en':'Fecha y hora de alta de la ficha.',
 'puntos':'Puntos de fidelidad acumulados.','condicion_iva':'Condición frente al IVA; define la letra de la factura. Por defecto, consumidor final.',
 'vip':'Marca de huésped VIP.','residente_exterior':'Indica si reside en el exterior; es una de las dos condiciones de la exención de IVA.',
 'acepta_avisos':'Acepta avisos sobre su reserva (confirmación, recordatorio, factura).','acepta_promociones':'Acepta recibir promociones; requiere consentimiento explícito.',
 'anonimizado':'Indica que sus datos personales fueron suprimidos a pedido del titular.'}),
'reservas': ("Cabecera de cada reserva: quién reserva, por qué canal, en qué estado y por cuánto.", {
 'id':'Identificador de la reserva.','codigo':'Código legible que se le da al huésped (por ejemplo, BP-261112-E07B).','huesped_id':'Huésped titular.',
 'estado':'Estado del ciclo de vida: pendiente, confirmada, pagada, in_house, checkout, cancelada o no_show.','canal':'Canal de origen: directo, web, booking o expedia.',
 'tarifa_tipo':'Tarifa aplicada: rack (mostrador y web) o neto (agencias en línea).','promocion_id':'Promoción aplicada, si la hay.','politica_id':'Política de cancelación vigente al reservar.',
 'moneda':'Moneda de los importes (USD).','total':'Importe final de la estadía, con IVA.','notas':'Pedido especial del huésped u observaciones.','creada_por':'Usuario que cargó la reserva; vacío si la hizo el huésped en el portal.',
 'creada_en':'Fecha y hora de alta.','token':'Clave opaca del enlace público de confirmación, pago y factura.','grupo_id':'Agrupa las reservas de un mismo grupo.',
 'plan':'Plan de comidas; el desayuno está siempre incluido.','garantia':'Cómo está garantizada la reserva.','segmento':'Segmento comercial, para los reportes.','voucher':'Número de comprobante del canal, si lo hay.',
 'descuento_pct':'Descuento adicional, en porcentaje.','subtotal':'Importe sin IVA antes del descuento.','total_neto':'Importe sin IVA después del descuento.','iva':'IVA de la estadía.',
 'folio_alojamiento':'Folio (A o B) que paga el alojamiento.','folio_b_titular':'A nombre de quién se factura el folio B.','pago_desde_exterior':'Indica si el pago proviene del exterior; segunda condición de la exención de IVA.',
 'tarjeta_token':'Referencia que devuelve la pasarela por la tarjeta de garantía; no permite reconstruir el número.','tarjeta_ultimos4':'Últimos cuatro dígitos de la tarjeta de garantía.','tarjeta_marca':'Marca de la tarjeta de garantía.',
 'tarjeta_vencimiento':'Vencimiento de la tarjeta de garantía (MM/AA).','tarjeta_verificacion':'Resultado de la verificación de la tarjeta.','tarjeta_verificada_en':'Fecha y hora de la verificación.',
 'tarjeta_detalle':'Motivo del rechazo o de la imposibilidad de verificar.','cancelada_en':'Fecha y hora de la cancelación, si se canceló.'}),
'estadias': ("Ocupación de una unidad durante un período. Es la tabla que impide la sobreventa.", {
 'id':'Identificador de la estadía.','reserva_id':'Reserva a la que pertenece.','unidad_id':'Unidad física que ocupa.','tipo_unidad_id':'Tipo de alojamiento con el que se vendió.',
 'periodo':'Rango de fechas de la estadía; el día de salida no se cuenta como ocupado.','estado':'Estado, sincronizado con el de la reserva.','precio_noche':'Precio por noche sin IVA.',
 'huespedes':'Plazas ocupadas (adultos más menores).','check_in':'Fecha de entrada, calculada a partir del período.','check_out':'Fecha de salida, calculada a partir del período.',
 'adultos':'Cantidad de adultos.','menores':'Cantidad de menores.','bebes':'Cantidad de bebés en cuna; no ocupan plaza.','camas_extra':'Camas extra solicitadas.','cunas':'Cunas solicitadas.',
 'no_mover':'El huésped pidió esta unidad en particular.'}),
'unidades': ("Habitaciones y cabañas físicas del hotel.", {
 'id':'Identificador de la unidad.','tipo_unidad_id':'Tipo de alojamiento al que pertenece.','nombre':'Nombre de la habitación o cabaña.','estado':'Estado de limpieza: limpia, sucia, inspeccionada o bloqueada.',
 'activo':'Indica si la unidad está en uso.','creado_en':'Fecha y hora de alta.','asignada_a':'Mucama asignada a la unidad.','piso':'Planta en la que está.','bloque':'Sector o edificio.','orden':'Orden dentro del piso, para el recorrido de limpieza.'}),
'tipos_unidad': ("Tipos de alojamiento que se venden (Standard, Superior, Suite, cabañas…).", {
 'id':'Identificador del tipo.','codigo':'Código corto (por ejemplo, HOST-SUP).','nombre':'Nombre comercial.','categoria':'Hostería o cabaña.','capacidad_max':'Cantidad máxima de plazas.',
 'descripcion':'Texto que se muestra en el portal.','amenities':'Comodidades incluidas.','activo':'Indica si se ofrece a la venta.','creado_en':'Fecha y hora de alta.'}),
'tarifas': ("Precio por noche de cada tipo de alojamiento en cada temporada.", {
 'id':'Identificador de la tarifa.','tipo_unidad_id':'Tipo de alojamiento.','temporada_id':'Temporada.','precio_neto':'Precio para agencias, sin IVA. No es visible para el público.',
 'precio_rack':'Precio de mostrador, sin IVA.','moneda':'Moneda de la tarifa (USD).','iva_pct':'Porcentaje de IVA.','vigente':'Indica si la tarifa está en vigencia.'}),
'consumos': ("Cada línea cargada a la cuenta de una reserva: productos y servicios adicionales.", {
 'id':'Identificador de la línea.','reserva_id':'Reserva a la que se carga.','producto_id':'Producto o servicio consumido.','cantidad':'Cantidad.','precio_unitario':'Precio unitario en USD, congelado al momento de la carga.',
 'fecha':'Día del consumo, según la fecha del hotel.','cargado_por':'Usuario que lo cargó.','creado_en':'Fecha y hora de carga.','comanda':'Número que agrupa las líneas cargadas juntas en el punto de venta.',
 'nota':'Aclaración de la línea.','folio':'Folio al que se carga: A (titular) o B (tercero).','comprobante':'Comprobante interno asociado.','departamento_id':'Departamento que lo vendió, copiado al momento de la venta.',
 'moneda_origen':'Moneda en que se cobró, si no fue en dólares.','importe_origen':'Importe en la moneda de origen.','cotizacion_usada':'Cotización aplicada para convertir a dólares.'}),
'productos_servicios': ("Catálogo de lo que se puede cargar a una cuenta: frigobar, restaurante, excursiones, traslados.", {
 'id':'Identificador del producto.','codigo':'Código corto.','nombre':'Nombre que se muestra al cargar.','categoria':'Categoría: desayuno, frigobar, excursión, traslado u otro.','precio':'Precio vigente.',
 'moneda':'Moneda del precio (USD).','activo':'Indica si se puede vender.','creado_en':'Fecha y hora de alta.','stock':'Unidades disponibles; vacío en los servicios, que no llevan stock.',
 'stock_minimo':'Cantidad por debajo de la cual se avisa que hay que reponer.','departamento_id':'Departamento que lo vende.'}),
'departamentos': ("Sectores que venden (frigobar, restaurante, excursiones…), en dos niveles.", {
 'id':'Identificador del departamento.','codigo':'Código corto.','nombre':'Nombre.','padre_id':'Departamento del que depende; vacío si es de primer nivel.','orden':'Orden en que se muestra.',
 'activo':'Indica si está en uso.','creado_en':'Fecha y hora de alta.'}),
'pagos': ("Cobros y devoluciones de una reserva, en efectivo, por transferencia, con tarjeta o en línea.", {
 'id':'Identificador del pago.','reserva_id':'Reserva que se cobra.','medio':'Medio: efectivo, transferencia, tarjeta, Mercado Pago, Stripe o Payway.','tipo':'Seña, saldo o reembolso.',
 'monto':'Importe en dólares; es el que salda la reserva.','moneda':'Moneda en que efectivamente se cobró.','estado':'Pendiente, aprobado, rechazado o reembolsado.','external_id':'Referencia del cobro en la pasarela; evita registrar dos veces el mismo aviso.',
 'nota':'Observación.','creado_por':'Usuario que lo registró; vacío si lo informó la pasarela.','creado_en':'Fecha y hora del registro.','monto_cobrado':'Importe cobrado en la moneda del pago.',
 'cotizacion':'Tipo de cambio aplicado, congelado al generar el cobro.','cupon':'Número de cupón o de autorización de la terminal.','ultimos4':'Últimos cuatro dígitos de la tarjeta.','tarjeta_marca':'Marca de la tarjeta.',
 'url_pago':'Enlace de pago generado en la pasarela.','vence_en':'Fecha y hora hasta la que sirve el enlace.'}),
'facturas': ("Comprobantes emitidos. Una reserva tiene como máximo una factura, y no se modifica una vez emitida.", {
 'id':'Identificador de la factura.','reserva_id':'Reserva facturada.','numero':'Número interno del comprobante.','total':'Importe total.','moneda':'Moneda del comprobante.','pdf_url':'Ubicación del archivo, si se generó.',
 'cae':'Código de autorización electrónico.','cae_vto':'Vencimiento del código de autorización.','punto_venta':'Punto de venta fiscal.','tipo_comprobante':'Letra del comprobante: A, B o C.','emitida_por':'Usuario que la emitió.',
 'emitida_en':'Fecha y hora de emisión.','neto':'Importe sin IVA.','iva':'IVA discriminado.','alicuota_iva':'Alícuota de IVA aplicada.','condicion_iva_receptor':'Condición frente al IVA del huésped al emitir.',
 'cuit_receptor':'CUIT del receptor, cuando corresponde factura A.','numero_fiscal':'Número correlativo dentro del punto de venta.','cae_solicitado_en':'Fecha y hora en que se pidió la autorización.',
 'exento':'Parte del neto que no paga IVA (alojamiento a turistas del exterior).','motivo_exencion':'Fundamento de la exención, impreso en el comprobante.'}),
'encuestas_satisfaccion': ("Encuesta que se genera al hacer el check-out y el huésped responde por un enlace.", {
 'id':'Identificador de la encuesta.','reserva_id':'Reserva evaluada.','token':'Clave opaca del enlace de la encuesta.','puntaje':'Puntaje de 0 a 10; vacío hasta que se responde.','comentario':'Comentario libre del huésped.',
 'enviada_en':'Fecha y hora en que se envió la invitación.','respondida_en':'Fecha y hora de la respuesta.'}),
'notificaciones': ("Bandeja de salida de los correos al huésped, con reintentos.", {
 'id':'Identificador del aviso.','evento':'Qué se avisa: confirmación, pago recibido, cancelación, recordatorio, encuesta, etc.','canal':'Canal de salida (correo electrónico).','clave':'Clave que impide enviar dos veces el mismo aviso.',
 'destinatario':'Dirección de correo del destinatario.','variables':'Datos con los que se arma el mensaje.','estado':'Pendiente, enviada o fallida.','intentos':'Cantidad de intentos de envío.',
 'proximo_en':'Fecha y hora del próximo intento.','enviada_en':'Fecha y hora de envío.','error':'Último error informado por el servicio de correo.','huesped_id':'Huésped al que se dirige.','reserva_id':'Reserva relacionada.',
 'creado_en':'Fecha y hora en que se encoló.','entregada_en':'Fecha y hora de entrega, si se informa.','leida_en':'Fecha y hora de lectura, si se informa.','proveedor_id':'Identificador del envío en el servicio de correo.'}),
}
OTRAS = {
 'perfiles':'Usuarios del personal, con su rol (administrador, gerencia, recepción o housekeeping) y si están activos.',
 'temporadas':'Temporadas del tarifario (baja, media y alta).','temporada_rangos':'Rangos de fechas que componen cada temporada.',
 'promociones':'Promociones vigentes, con su descuento y sus condiciones.','politicas_cancelacion':'Plazos y cargos de la política de cancelación.',
 'housekeeping_registros':'Registro de cada limpieza: unidad, mucama, comentario y fotos.','notas_credito':'Notas de crédito emitidas sobre una factura.',
 'puntos_venta':'Puntos de venta fiscales y su último número emitido.','facturas_numeracion':'Reserva del número correlativo de cada factura.',
 'datos_fiscales':'Datos fiscales del hotel como emisor (una sola fila).','cotizaciones':'Cotizaciones de divisas, automáticas y manuales.',
 'auditoria':'Rastro de las operaciones sensibles: quién cambió qué y cuándo.','auditoria_accesos':'Rastro de quién consultó la ficha de un huésped.',
 'errores':'Errores del servidor, para verlos desde el panel.','cron_corridas':'Resultado de cada corrida de las tareas programadas.',
 'consultas_bot':'Consultas hechas al asistente del portal.','intentos_limitados':'Contador del límite de intentos por origen.',
}
TIPOS = {'uuid':'identificador','text':'texto','integer':'entero','smallint':'entero','bigint':'entero','numeric':'decimal','boolean':'sí / no','date':'fecha',
 'timestamptz':'fecha y hora','daterange':'rango de fechas','jsonb':'estructura','text[]':'lista de textos','inet':'dirección IP'}

def q(sql):
    out = subprocess.run(['psql','-h','127.0.0.1','-p','55322','-U','postgres','-d','postgres','-At','-F','|','-c',sql],capture_output=True,text=True,check=True).stdout
    return [l.split('|') for l in out.splitlines() if l]
cols = {}
for t,c,ty,nn in q("""select table_name, column_name,
   case when data_type='USER-DEFINED' then udt_name when data_type='ARRAY' then ltrim(udt_name,'_')||'[]' when data_type like 'timestamp%' then 'timestamptz'
        when data_type='character varying' then 'text' else data_type end, is_nullable
   from information_schema.columns where table_schema='public' order by table_name, ordinal_position"""):
    cols.setdefault(t,[]).append((c,ty,nn=='NO'))
pk = {(t,c) for t,c in q("""select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu
   using (constraint_name, table_schema) where tc.constraint_type='PRIMARY KEY' and tc.table_schema='public'""")}
fk = {(t,c):rt for t,c,rt in q("""select cl.relname, a.attname, cf.relname from pg_constraint co join pg_class cl on cl.oid=co.conrelid join pg_class cf on cf.oid=co.confrelid
   join pg_namespace n on n.oid=cl.relnamespace and n.nspname='public' join pg_attribute a on a.attrelid=co.conrelid and a.attnum=co.conkey[1] where co.contype='f'""")}
SISTEMA = set(D)|set(OTRAS)|{'users'}
print("# Diccionario de datos\n")
print("Generado del esquema real de la base con `figuras/fuentes/generar-diccionario.py`. Se detallan las tablas que intervienen en los casos de uso principales; las demás se describen al final.\n")
print("Referencias: **PK** clave primaria · **FK** clave foránea · **Obl.** dato obligatorio.\n")
faltan=[]
for t,(desc,dc) in D.items():
    print(f"## {t}\n\n{desc}\n\n| Campo | Tipo | Clave | Obl. | Descripción |\n|---|---|---|---|---|")
    for c,ty,nn in cols[t]:
        rt = fk.get((t,c))
        if rt and rt not in SISTEMA: continue          # columnas hacia tablas que la aplicación no usa
        if c not in dc: faltan.append(f'{t}.{c}'); continue
        clave = 'PK' if (t,c) in pk else (f'FK → {rt}' if rt else '')
        print(f"| `{c}` | {TIPOS.get(ty, ty.replace('_',' '))} | {clave} | {'Sí' if nn else 'No'} | {dc[c]} |")
    print()
print("## Otras tablas del sistema\n\n| Tabla | Contenido |\n|---|---|")
for t,d in OTRAS.items():
    assert t in cols, t; print(f"| `{t}` | {d} |")
if faltan: print('FALTAN', faltan, file=sys.stderr)
