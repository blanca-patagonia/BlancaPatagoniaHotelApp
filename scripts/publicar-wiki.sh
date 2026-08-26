#!/usr/bin/env bash
#
# Publica el contenido de `docs/wiki/` en el wiki de GitHub del repositorio.
#
# Por qué existe: el wiki de GitHub es **otro repositorio git** (el mismo nombre
# con el sufijo `.wiki.git`). No se actualiza con un push del repositorio
# principal ni con un pull request: hay que clonarlo aparte y pushear ahí.
#
# Este script hace ese ida y vuelta, para que las páginas se escriban y se
# revisen en `docs/wiki/` —donde quedan versionadas junto al código que
# describen— y el wiki sea sólo el lugar donde se publican.
#
# Uso:
#   bash scripts/publicar-wiki.sh
#
# ⚠️ Requisito: el wiki tiene que estar **inicializado**. GitHub no crea el
# repositorio `.wiki.git` hasta que existe la primera página. Si nunca se creó
# ninguna, hay que crearla una sola vez desde la web (pegando el contenido de
# `docs/wiki/Home.md`) y después este script se encarga del resto.

set -euo pipefail

REPO="https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp.wiki.git"
ORIGEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docs/wiki"

if [ ! -d "$ORIGEN" ]; then
  echo "No encuentro $ORIGEN" >&2
  exit 1
fi

DESTINO="$(mktemp -d)"
echo "→ Clonando el wiki en $DESTINO"

if ! git clone "$REPO" "$DESTINO/wiki" 2>/dev/null; then
  cat >&2 <<'AYUDA'

No se pudo clonar el wiki. Las dos causas posibles:

  1. El wiki todavía no está inicializado. GitHub no crea el repositorio
     `.wiki.git` hasta que exista la primera página. Creala una vez desde
     la web —pegando el contenido de docs/wiki/Home.md con el título
     "Home"— y volvé a correr este script.

     https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/wiki/_new

  2. No tenés credenciales de escritura configuradas para GitHub en esta
     máquina.

AYUDA
  exit 1
fi

echo "→ Copiando las páginas"
cp "$ORIGEN"/*.md "$DESTINO/wiki/"

cd "$DESTINO/wiki"

if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "→ El wiki ya está al día. Nada que publicar."
  exit 0
fi

git add -A
git status --short

git commit -m "docs: sincronizar el wiki desde docs/wiki/"
git push origin HEAD

echo
echo "✅ Wiki publicado: https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/wiki"
echo "   (el clon temporal quedó en $DESTINO, se puede borrar)"
