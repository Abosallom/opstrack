#!/usr/bin/env bash
# Renders the owner guides to PDF. Chrome headless, no network, no external assets.
set -euo pipefail
cd "$(dirname "$0")"
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
TMP="$(mktemp -d)"
for f in "$@"; do
  base="${f%.html}"
  python3 - "$f" "$TMP/$base.html" <<'PY'
import sys, pathlib
src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
dst.write_text(src.read_text().replace(
    '<!--BASECSS-->', '<style>\n' + pathlib.Path('_base.css').read_text() + '\n</style>'))
PY
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer --no-sandbox \
    --print-to-pdf="$PWD/$base.pdf" --virtual-time-budget=6000 \
    "file://$TMP/$base.html" 2>/dev/null
  python3 - "$base.pdf" <<'PY'
import sys, re, pathlib
d = pathlib.Path(sys.argv[1]).read_bytes()
n = len(re.findall(rb"/Type\s*/Page(?![s])", d))
print("%s  %.0f KB  %d pages" % (sys.argv[1], len(d)/1024, n))
PY
done
