#!/usr/bin/env python3
"""Inlines the photographs and the target drawings into brd.html.

brd.src.html is the authored file and carries tokens; brd.html is the rendered,
self-contained artefact that render.sh and preview.sh consume. No network, no
external asset, exactly as the other guides in this folder.
"""
import base64, pathlib, re

HERE = pathlib.Path(__file__).parent
ASSETS = HERE.parent / 'brd-assets'
src = (HERE / 'brd.src.html').read_text()

# ── the three photographs of today, as CSS custom properties ──────────────
shots = {'map': 'today-map.jpg', 'ovw': 'today-pmo-overview.jpg', 'del': 'today-pmo-delivery.jpg'}
css = ':root{\n'
for key, name in shots.items():
    b64 = base64.b64encode((ASSETS / name).read_bytes()).decode()
    css += '  --s-%s: url(data:image/jpeg;base64,%s);\n' % (key, b64)
css += '}\n'
src = src.replace('<!--DATAURI-->', '<style>\n' + css + '</style>')

# ── the target drawings, inlined; an optional viewBox override crops one ──
def svg(m):
    name, _, box = m.group(1).partition('|')
    body = (ASSETS / 'target' / (name + '.svg')).read_text()
    body = body[body.index('<svg'):]
    body = re.sub(r'\swidth="\d+"', '', body, count=1)
    if box:
        body = re.sub(r'viewBox="[^"]*"', 'viewBox="%s"' % box, body, count=1)
    return body

src = re.sub(r'<!--SVG:([^>]+?)-->', svg, src)

# ── page numbers, counted rather than typed ───────────────────────────────
total = src.count('<section class="page">')
n = [0]
def page(m):
    n[0] += 1
    return '<span>Page %d of %d</span>' % (n[0], total)
src = re.sub(r'<span>Page \d+ of \d+</span>', page, src)
assert n[0] == total, (n[0], total)
src = src.replace('that mark is on page 28.', 'that mark is on page %d.' % total)

missing = re.findall(r'<!--(?:SVG|DATAURI)[^>]*-->', src)
assert not missing, missing
(HERE / 'brd.html').write_text(src)
print('brd.html  %.0f KB' % (len(src) / 1024))
