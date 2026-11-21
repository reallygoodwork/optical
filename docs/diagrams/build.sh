#!/usr/bin/env bash
# Regenerate the README drawings with Plotter (https://github.com/pasqualevitiello/plotter).
# Needs Python 3 and Chrome/Chromium. Set PLOTTER to the plotter skill folder, or this clones it.
set -euo pipefail
cd "$(dirname "$0")"
if [ -z "${PLOTTER:-}" ]; then
  [ -d .plotter ] || git clone -q --depth 1 https://github.com/pasqualevitiello/plotter.git .plotter
  export PLOTTER="$PWD/.plotter/skills/plotter"
fi
python3 drawings.py
for f in src/*.svg; do
  n=$(basename "$f" .svg)
  python3 "$PLOTTER/scripts/check.py" "$f"
  python3 "$PLOTTER/scripts/export-svg.py" "$f" "$n.svg" --id-prefix "$n" --embed-font >/dev/null   # standalone SVG
  python3 "$PLOTTER/scripts/render.py" "$f" "$n.png" --theme both --scale 2 >/dev/null             # $n-light.png, $n-dark.png
done
echo "done: $(ls *.png | wc -l) PNGs, $(ls *.svg | wc -l) SVGs"
