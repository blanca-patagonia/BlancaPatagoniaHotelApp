#!/bin/bash
# Arma el Word de la tesis en dos pasadas: la primera, con marcas invisibles, sirve para saber
# en qué página cae cada título y cada figura; la segunda escribe los índices con esos números.
#
#   docs/1-tesis/armar-docx.sh [salida.docx]
#
# Necesita Node con el paquete `docx`, Python 3 con Pillow, LibreOffice y poppler (pdftotext).
# SOFFICE permite indicar otro ejecutable de LibreOffice (por defecto, `soffice`).
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
SALIDA="${1:-$AQUI/Tesis_Moran_Fakiani.docx}"
TMP="$(mktemp -d)"
SOFFICE="${SOFFICE:-soffice}"

# Figuras reducidas: las capturas están a doble resolución y no hace falta tanto en la hoja.
python3 - "$AQUI" "$TMP/img" <<'PY'
import sys, os, glob, shutil
from PIL import Image
origen, destino = sys.argv[1], sys.argv[2]
for f in glob.glob(origen + '/figuras/*/*.png') + glob.glob(origen + '/figuras/*/*.jpg'):
    rel = os.path.relpath(f, origen); o = os.path.join(destino, rel); os.makedirs(os.path.dirname(o), exist_ok=True)
    im = Image.open(f); w, h = im.size
    if w > 1700 and '/capturas/' in f:
        im = im.convert('RGB').resize((1700, round(h * 1700 / w)), Image.LANCZOS)
        if f.endswith('.png'):
            im = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
            im.save(o, optimize=True)
        else:
            im.save(o, quality=85, optimize=True)
    else:
        shutil.copy(f, o)
PY
export TESIS_IMG="$TMP/img"

node "$AQUI/armar-docx.js" "$TMP/pasada1.docx" --marcas
python3 "$AQUI/completar-indices.py" "$TMP/pasada1.docx"
(cd "$TMP" && $SOFFICE --headless --convert-to pdf pasada1.docx >/dev/null 2>&1)

# Página de cada marca ⟦h12⟧ / ⟦f7⟧ en el PDF.
python3 - "$TMP/pasada1.pdf" "$TMP/paginas.json" <<'PY'
import sys, subprocess, re, json
texto = subprocess.run(['pdftotext', sys.argv[1], '-'], capture_output=True, text=True, check=True).stdout
paginas = {}
for n, hoja in enumerate(texto.split('\f'), 1):
    for clave in re.findall(r'⟦([hf]\d+)⟧', hoja):
        paginas.setdefault(clave, n)
json.dump(paginas, open(sys.argv[2], 'w'))
print(f'{len(paginas)} marcas ubicadas')
PY

node "$AQUI/armar-docx.js" "$SALIDA" "$TMP/paginas.json"
python3 "$AQUI/completar-indices.py" "$SALIDA"
rm -f "${SALIDA%.docx}.indices.json"
zip -d "$SALIDA" '*/' >/dev/null 2>&1 || true
find "$TMP" -delete
echo "Listo: $SALIDA"
