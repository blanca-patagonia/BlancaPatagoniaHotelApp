#!/usr/bin/env python3
"""Completa el Word de la tesis: escribe los índices como campos de Word y activa la partición de palabras.

Uso:  python3 completar-indices.py <tesis.docx>     (lee <tesis>.indices.json, que deja armar-docx.js)

Los índices quedan como campos TOC verdaderos —Word los actualiza con «Actualizar campo»— y con
su resultado ya escrito, para que se vean completos sin tener que actualizarlos.
"""
import json, re, sys, zipfile, shutil, os
from xml.sax.saxutils import escape

docx = sys.argv[1]
ind = json.load(open(docx[:-5] + '.indices.json', encoding='utf8'))

def corrida(texto):
    return f'<w:r><w:t xml:space="preserve">{escape(texto)}</w:t></w:r>'

def entrada(estilo, texto, pagina, antes='', despues=''):
    return (f'<w:p><w:pPr><w:pStyle w:val="{estilo}"/></w:pPr>{antes}{corrida(texto)}'
            f'<w:r><w:tab/></w:r>{corrida(str(pagina))}{despues}</w:p>')

def campo(instruccion, entradas):
    inicio = ('<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
              f'<w:r><w:instrText xml:space="preserve"> {escape(instruccion)} </w:instrText></w:r>'
              '<w:r><w:fldChar w:fldCharType="separate"/></w:r>')
    fin = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    out = []
    for k, (estilo, texto, pagina) in enumerate(entradas):
        out.append(entrada(estilo, texto, pagina, inicio if k == 0 else '', fin if k == len(entradas) - 1 else ''))
    return ''.join(out)

toc = campo('TOC \\o "1-3" \\h \\z \\u', [(f'TOC{t["nivel"]}', t['texto'], t['pagina']) for t in ind['titulos']])
tof = campo('TOC \\h \\z \\c "Figura"', [('TableofFigures', f'Figura {f["numero"]}. {f["texto"]}', f['pagina']) for f in ind['figuras']])

tmp = docx + '.tmp'
with zipfile.ZipFile(docx) as z, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as o:
    for item in z.infolist():
        if item.filename.endswith('/'):
            continue
        data = z.read(item.filename)
        if item.filename == 'word/document.xml':
            xml = data.decode('utf8')
            for marca, nuevo in (('@@TOC@@', toc), ('@@TOF@@', tof)):
                i = xml.index(marca)
                a = xml.rfind('<w:p>', 0, i); a2 = xml.rfind('<w:p ', 0, i); a = max(a, a2)
                b = xml.index('</w:p>', i) + len('</w:p>')
                xml = xml[:a] + nuevo + xml[b:]
            data = xml.encode('utf8')
        elif item.filename == 'word/settings.xml':
            xml = data.decode('utf8')
            if 'autoHyphenation' not in xml:
                # El esquema fija el orden: va antes de los ajustes de compatibilidad y de las notas.
                for ancla in ('<w:evenAndOddHeaders', '<w:characterSpacingControl', '<w:footnotePr', '<w:endnotePr', '<w:compat', '</w:settings>'):
                    if ancla in xml:
                        xml = xml.replace(ancla, '<w:autoHyphenation w:val="true"/><w:hyphenationZone w:val="357"/>' + ancla, 1)
                        break
            data = xml.encode('utf8')
        o.writestr(item, data)
shutil.move(tmp, docx)
print(f'índices: {len(ind["titulos"])} títulos y {len(ind["figuras"])} figuras')
