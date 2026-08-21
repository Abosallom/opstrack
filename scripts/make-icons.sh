#!/usr/bin/env bash
# Regenerates EVERY raster the app ships from the one generated mark.
#
#   ./scripts/make-icons.sh
#
# A logo revision is: edit the constants in scripts/make-icon.mjs, run this, and
# look at the output. There is no second place to hunt — the PWA manifest icons,
# the favicon, the Apple touch icon and the iOS AppIcon all come out of here.
#
# macOS only (qlmanage is the SVG rasteriser; Pillow does the resampling).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v qlmanage >/dev/null || { echo "qlmanage not found (macOS only)"; exit 1; }
python3 -c "import PIL" 2>/dev/null || { echo "Pillow not installed: pip3 install Pillow"; exit 1; }

node scripts/make-icon.mjs

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Rasterise each variant ONCE at full size, then resample down. Rendering the
# SVG separately at 32px puts the rasteriser in charge of a hairline stroke and
# it thins it away; a Lanczos downscale from 1024 keeps the petals solid.
for v in icon icon-opaque icon-maskable; do
  qlmanage -t -s 1024 -o "$WORK" "public/$v.svg" >/dev/null 2>&1
  [ -f "$WORK/$v.svg.png" ] || { echo "rasterise failed: $v"; exit 1; }
done

IOS_ICON=ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png

python3 - "$WORK" "$IOS_ICON" <<'PY'
import sys
from PIL import Image

work, ios_icon = sys.argv[1], sys.argv[2]
src = {v: Image.open(f"{work}/{v}.svg.png").convert("RGBA") for v in
       ("icon", "icon-opaque", "icon-maskable")}

def emit(variant, size, out, drop_alpha=False):
    im = src[variant].resize((size, size), Image.LANCZOS)
    if drop_alpha:
        # Apple rejects an app icon that merely CARRIES an alpha channel, even
        # one that is opaque everywhere, so this composites onto white and
        # converts to RGB rather than trusting the plate to be enough.
        plate = Image.new("RGB", im.size, (255, 255, 255))
        plate.paste(im, mask=im.split()[3])
        im = plate
    im.save(out, "PNG", optimize=True)
    print(f"  {out}  {size}x{size}{' RGB' if drop_alpha else ''}")

emit("icon", 512, "public/pwa-512.png")
emit("icon", 192, "public/pwa-192.png")
emit("icon", 32, "public/favicon-32.png")
emit("icon-maskable", 512, "public/pwa-maskable-512.png")
emit("icon-maskable", 192, "public/pwa-maskable-192.png")
emit("icon-opaque", 180, "public/apple-touch-icon.png", drop_alpha=True)
emit("icon-opaque", 1024, ios_icon, drop_alpha=True)
PY

echo "icons regenerated"
