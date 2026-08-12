-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0029 — Límite de intentos en las entradas públicas (Fase 1 de la
-- auditoría de seguridad)
--
-- Problema que resuelve, en orden de gravedad:
--
-- 1. El alta pública de reservas no tenía ningún límite, y **cada reserva
--    pendiente bloquea una unidad durante 5 días** (ver
--    `expirar_reservas_pendientes`, migración 0011). Con 15 unidades, un script
--    que enviara el formulario unas decenas de veces dejaba al hotel sin
--    inventario vendible por cinco días. No es una molestia técnica: es una
--    denegación de servicio contra el negocio, ejecutable sin autenticarse.
--
-- 2. El login no limitaba reintentos. Supabase Auth aplica su propio límite,
--    pero no queda registro local del intento ni se frena antes de llegar.
--
-- 3. La encuesta pública podía reenviarse en masa y ensuciar el NPS, que
--    alimenta los reportes de gestión.
--
-- Por qué en la base y no en la aplicación: el contador tiene que ser atómico.
-- Si dos peticiones simultáneas leyeran el conteo y después insertaran, ambas
-- podrían pasar el límite. Acá se inserta primero y se cuenta después, dentro
-- de la misma función: el propio intento siempre está incluido en el conteo, lo
-- que hace que el resultado sea conservador (nunca deja pasar de más).
-- ─────────────────────────────────────────────────────────────────────────────

create table intentos_limitados (
  id        bigint generated always as identity primary key,
  ip        inet not null,
  accion    text not null,
  creado_en timestamptz not null default now()
);

comment on table intentos_limitados is
  'Registro de intentos por IP en las entradas públicas, para limitar el volumen.';

-- El índice cubre la consulta exacta del limitador: misma IP, misma acción,
-- ventana reciente.
create index on intentos_limitados (ip, accion, creado_en desc);

alter table intentos_limitados enable row level security;

-- Sin políticas de lectura ni escritura a propósito: la tabla la maneja
-- exclusivamente la función de abajo, que corre como `security definer`. Nadie
-- debería poder leer desde qué IPs se intentó algo, ni borrar su propio rastro.
revoke all on intentos_limitados from anon, authenticated;

-- ── Limitador ────────────────────────────────────────────────────────────────
-- Registra el intento y devuelve `true` si TODAVÍA está permitido.
create or replace function registrar_intento(
  p_ip      inet,
  p_accion  text,
  p_maximo  int,
  p_minutos int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recientes int;
begin
  -- Sin IP no se puede limitar (puede pasar detrás de ciertos proxies). Se deja
  -- pasar en lugar de bloquear: es preferible un hueco conocido a rechazar
  -- reservas legítimas por un encabezado ausente.
  if p_ip is null then
    return true;
  end if;

  insert into intentos_limitados (ip, accion) values (p_ip, p_accion);

  select count(*) into v_recientes
  from intentos_limitados
  where ip = p_ip
    and accion = p_accion
    and creado_en > now() - make_interval(mins => p_minutos);

  return v_recientes <= p_maximo;
end;
$$;

comment on function registrar_intento(inet, text, int, int) is
  'Registra un intento y devuelve true si aún no se superó el límite. El propio '
  'intento cuenta, así que el resultado nunca deja pasar de más.';

grant execute on function registrar_intento(inet, text, int, int) to service_role;

-- ── Purga ────────────────────────────────────────────────────────────────────
-- Sin esto la tabla crece sin techo. Una hora de historia alcanza: la ventana
-- más larga que usa la aplicación es de 60 minutos.
create or replace function purgar_intentos(p_horas int default 2)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrados int;
begin
  delete from intentos_limitados
  where creado_en < now() - make_interval(hours => p_horas);
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

comment on function purgar_intentos(int) is
  'Borra los intentos viejos. Sin esto la tabla crece indefinidamente.';

grant execute on function purgar_intentos(int) to service_role;

-- Se programa junto al resto de las tareas. El bloque es tolerante: si
-- `pg_cron` no está disponible (por ejemplo en algunos entornos locales), la
-- migración no debe fallar por eso.
do $$
begin
  perform cron.schedule('purgar-intentos', '0 * * * *', 'select purgar_intentos()');
exception
  when others then
    raise notice 'pg_cron no disponible: purgar_intentos() queda sin programar.';
end;
$$;
