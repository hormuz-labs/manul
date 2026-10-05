#!/bin/sh
# Regenerate every app icon from build/icon.svg (needs rsvg-convert: `brew install librsvg`; iconutil is macOS-only).
#   build/icon.png          1024 master (electron-builder default)
#   build/icon.icns         macOS
#   build/icon.ico          Windows (256, 128, 64, 48, 32, 16)
#   build/icons/NxN.png     Linux (electron-builder picks them up by size)
#   src/renderer/public/    the in-app mark
set -e
cd "$(dirname "$0")/.."
rsvg-convert -w 1024 -h 1024 build/icon.svg -o build/icon.png
mkdir -p build/icons build/icon.iconset src/renderer/public
for s in 16 32 48 64 128 256 512 1024; do rsvg-convert -w $s -h $s build/icon.svg -o build/icons/${s}x${s}.png; done
for s in 16 32 128 256 512; do
  rsvg-convert -w $s -h $s build/icon.svg -o build/icon.iconset/icon_${s}x${s}.png
  rsvg-convert -w $((s*2)) -h $((s*2)) build/icon.svg -o build/icon.iconset/icon_${s}x${s}@2x.png
done
if command -v iconutil >/dev/null; then iconutil -c icns build/icon.iconset -o build/icon.icns; fi
rm -rf build/icon.iconset
node scripts/ico.mjs build/icon.ico build/icons/256x256.png build/icons/128x128.png build/icons/64x64.png build/icons/48x48.png build/icons/32x32.png build/icons/16x16.png
cp build/icon.svg src/renderer/public/manul.svg
echo "icons written"
