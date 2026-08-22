#!/usr/bin/env bash
# Renders each .page section to its own A4-proportioned PNG for visual checking.
set -euo pipefail
cd "$(dirname "$0")"
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
f="$1"; base="${f%.html}"; OUT="preview/$base"; rm -rf "$OUT"; mkdir -p "$OUT"
python3 - "$f" "$OUT" <<'PY'
import sys, pathlib, re
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
html = src.read_text().replace('<!--BASECSS-->', '<style>\n'+pathlib.Path('_base.css').read_text()+'\n</style>')
head, body = html.split('<body>', 1)
body = body.rsplit('</body>', 1)[0]
pages = re.findall(r'<section class="page">.*?</section>', body, re.S)
for i, p in enumerate(pages, 1):
    (out / f'p{i:02d}.html').write_text(head + '<body style="margin:0">' + p + '</body></html>')
print(len(pages))
PY
n=$(ls "$OUT"/*.html | wc -l | tr -d ' ')
for h in "$OUT"/*.html; do
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=794,1122 --screenshot="${h%.html}.png" --virtual-time-budget=4000 \
    "file://$PWD/$h" 2>/dev/null
done
echo "$n pages -> $OUT/*.png"
