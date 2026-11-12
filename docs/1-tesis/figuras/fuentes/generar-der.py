#!/usr/bin/env python3
"""Genera los DER (PlantUML) leyendo el esquema de una base con las migraciones aplicadas.

Uso:  PGPASSWORD=postgres python3 generar-der.py   (base aislada local, puerto 55322)
Solo incluye las 30 tablas que usa la aplicación.
"""
import subprocess, collections

SISTEMA = """reservas huespedes estadias unidades tipos_unidad housekeeping_registros encuestas_satisfaccion
notificaciones politicas_cancelacion consumos productos_servicios departamentos pagos facturas notas_credito
puntos_venta facturas_numeracion datos_fiscales cotizaciones tarifas temporadas temporada_rangos promociones
perfiles auditoria auditoria_accesos errores cron_corridas consultas_bot intentos_limitados""".split()
GRUPOS = {
  'der-reservas': ("Reservas, estadías y huéspedes", "huespedes reservas estadias unidades tipos_unidad housekeeping_registros encuestas_satisfaccion notificaciones politicas_cancelacion promociones perfiles".split()),
  'der-cuenta': ("Consumos, pagos y facturación", "reservas consumos productos_servicios departamentos pagos facturas notas_credito puntos_venta facturas_numeracion datos_fiscales cotizaciones".split()),
  'der-administracion': ("Tarifario, seguridad y operación", "tipos_unidad tarifas temporadas temporada_rangos promociones perfiles auditoria auditoria_accesos errores cron_corridas consultas_bot intentos_limitados".split()),
}
MAX_COLS = 16

def q(sql):
    out = subprocess.run(['psql','-h','127.0.0.1','-p','55322','-U','postgres','-d','postgres','-At','-F','|','-c',sql],
                         capture_output=True, text=True, check=True).stdout
    return [l.split('|') for l in out.splitlines() if l]

cols = collections.defaultdict(list)
for t,c,ty,nn in q("""select table_name, column_name,
       case when data_type='USER-DEFINED' then udt_name when data_type='ARRAY' then ltrim(udt_name,'_')||'[]'
            when data_type like 'timestamp%' then 'timestamptz' when data_type='character varying' then 'text' else data_type end,
       is_nullable from information_schema.columns where table_schema='public' order by table_name, ordinal_position"""):
    cols[t].append((c,ty,nn=='NO'))
pks = collections.defaultdict(set)
for t,c in q("""select tc.table_name, kcu.column_name from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu using (constraint_name, table_schema)
       where tc.constraint_type='PRIMARY KEY' and tc.table_schema='public'"""):
    pks[t].add(c)
fks = []
for t,c,rt in q("""select cl.relname, a.attname, cf.relname from pg_constraint co
       join pg_class cl on cl.oid=co.conrelid join pg_class cf on cf.oid=co.confrelid
       join pg_namespace n on n.oid=cl.relnamespace and n.nspname='public'
       join pg_attribute a on a.attrelid=co.conrelid and a.attnum=co.conkey[1]
       where co.contype='f' and cf.relnamespace=n.oid"""):
    fks.append((t,c,rt))
fkcols = {(t,c):rt for t,c,rt in fks}

def visible(t,c):
    # Las columnas que apuntan a tablas que la aplicación no usa no se dibujan.
    rt = fkcols.get((t,c))
    return rt is None or rt in SISTEMA

def entidad(t, detalle=True):
    l = [f'entity "{t}" as {t} {{']
    if detalle:
        vis = [(c,ty,nn) for c,ty,nn in cols[t] if visible(t,c)]
        clave = [x for x in vis if x[0] in pks[t]]
        resto = [x for x in vis if x[0] not in pks[t]]
        for c,ty,nn in clave: l.append(f'  * **{c}** : {ty} <<PK>>')
        l.append('  --')
        for c,ty,nn in resto[:MAX_COLS]:
            l.append(f'  {"* " if nn else ""}{c} : {ty}{" <<FK>>" if (t,c) in fkcols else ""}')
        if len(resto) > MAX_COLS: l.append(f'  … y {len(resto)-MAX_COLS} columnas más')
    l.append('}')
    return '\n'.join(l)

def relaciones(tablas):
    vistos, l = set(), []
    for t,c,rt in fks:
        if t in tablas and rt in tablas and (t,rt,c) not in vistos:
            vistos.add((t,rt,c)); obl = any(cc==c and nn for cc,_,nn in cols[t])
            l.append(f'{rt} {"||" if obl else "|o"}--o{{ {t} : {c}')
    return l

def escribir(nombre, titulo, tablas, detalle=True, extra=''):
    cuerpo = ['@startuml','!include _estilo.iuml','hide methods','skinparam linetype ortho', extra]
    cuerpo += [entidad(t, detalle) for t in tablas] + relaciones(set(tablas)) + ['@enduml']
    open(f'pp3-{nombre}.puml','w').write('\n'.join(cuerpo)+'\n'); print(nombre, len(tablas), 'tablas')

faltan = [t for t in SISTEMA if t not in cols]; assert not faltan, faltan
escribir('der-general', 'Vista general', SISTEMA, detalle=False, extra='hide members\nleft to right direction')
for n,(titulo,tablas) in GRUPOS.items(): escribir(n, titulo, tablas)
