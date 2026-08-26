#!/usr/bin/env bash
#
# Enciende el inicio de sesión con Google en el entorno LOCAL.
#
# Hace los pasos 2 y 3 de los tres que hacen falta; el paso 1 —crear las
# credenciales en Google Cloud— es manual y está explicado en
# `supabase/config.toml`, arriba del bloque [auth.external.google].
#
# Uso:
#   GOOGLE_CLIENT_ID="…apps.googleusercontent.com" \
#   GOOGLE_CLIENT_SECRET="GOCSPX-…" \
#   bash scripts/activar-google.sh
#
# Por qué existe como script y no como instrucciones sueltas: el paso que se
# olvida es el reinicio. GoTrue lee `config.toml` **al arrancar**, así que poner
# `enabled = true` sin reiniciar el contenedor no tiene ningún efecto y parece que
# la función estuviera rota. Acá los dos pasos van juntos y al final se verifica.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${GOOGLE_CLIENT_ID:-}" || -z "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  echo "✗ Faltan las credenciales."
  echo
  echo "  Se sacan de Google Cloud → APIs y servicios → Credenciales →"
  echo "  Crear credenciales → ID de cliente de OAuth → Aplicación web."
  echo
  echo "  URI de redirección autorizado (exacto, sin barra final):"
  echo "      http://127.0.0.1:54321/auth/v1/callback"
  echo
  echo "  Después:"
  echo '      GOOGLE_CLIENT_ID="…" GOOGLE_CLIENT_SECRET="…" bash scripts/activar-google.sh'
  exit 1
fi

echo "▸ 1/3  Habilitando el proveedor en supabase/config.toml"
# Solo la línea `enabled` que está dentro del bloque de Google, no las otras.
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('supabase/config.toml')
s = p.read_text()
i = s.index('[auth.external.google]')
j = s.find('\n[', i + 1)
bloque = s[i:j if j != -1 else len(s)]
nuevo = re.sub(r'^enabled = false$', 'enabled = true', bloque, count=1, flags=re.M)
if nuevo == bloque:
    print('   (ya estaba en true)')
else:
    p.write_text(s[:i] + nuevo + (s[j:] if j != -1 else ''))
    print('   enabled = true')
PY

echo "▸ 2/3  Reiniciando Supabase para que GoTrue relea la configuración"
# `stop` sin --no-backup conserva la base: no se pierden los datos ni los usuarios.
npx supabase stop >/dev/null
npx supabase start >/dev/null

echo "▸ 3/3  Verificando contra el propio GoTrue"
estado=$(curl -s http://127.0.0.1:54321/auth/v1/settings | python3 -c "import sys,json; print(json.load(sys.stdin)['external']['google'])")

if [[ "$estado" == "True" ]]; then
  echo
  echo "✓ Listo. GoTrue informa google: true, así que el botón ya aparece en /login."
  echo "  La pantalla lo consulta sola (no hace falta ninguna variable en la app)."
  echo
  echo "  ⚠️ Reiniciá también el servidor de desarrollo: la respuesta se cachea 30 min."
else
  echo
  echo "✗ GoTrue sigue informando google: $estado."
  echo "  Revisá que las dos variables estuvieran exportadas al correr este script:"
  echo "  el CLI las resuelve al arrancar, y si faltan deja el proveedor apagado."
  exit 1
fi
