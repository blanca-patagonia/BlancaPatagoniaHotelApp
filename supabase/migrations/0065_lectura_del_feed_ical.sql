-- ============================================================================
-- 0065 · Registro de la última lectura del feed iCal de salida
-- ============================================================================
--
-- El feed iCal no tiene acuse de recibo: nadie avisa que lo leyó, y —lo que
-- importa— nadie avisa que DEJÓ de leerlo. Si Booking cambia la URL, la borra o
-- el token se rota sin actualizar el extranet, el hotel sigue creyendo que
-- publica sus bloqueos mientras en realidad no publica nada.
--
-- Esta columna es la única mitigación posible sin un canal de vuelta: el handler
-- la escribe en cada lectura y la pantalla puede decir «lo leyeron hace 3 h» o
-- «hace 6 días». Lo segundo es información que hoy no existe en ningún lado.
--
-- Es aditiva y nullable: `null` significa «nunca lo leyeron», que es el estado
-- real de un canal recién configurado y no un dato faltante.
--
-- ⚠️ No lleva `revoke select from anon`: `canal_config` ya lo tiene desde la
-- 0049, y una columna nueva no cambia los privilegios de la tabla.

alter table canal_config
  add column if not exists ical_leido_en timestamptz;

comment on column canal_config.ical_leido_en is
  'Cuándo se leyó por última vez el feed iCal de salida. `null` = nunca. Es lo más parecido a un acuse de recibo que permite el iCal: no confirma que el canal aplicó los bloqueos, sólo que pasó a buscarlos.';
