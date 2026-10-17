#!/usr/bin/env bash
set -euo pipefail

if command -v 0x &>/dev/null; then
  echo "==> Generating flamegraph with 0x..."
  0x --output-dir ./tmp/profiles -- node ./node_modules/.bin/vitest bench test/pi/perf/ --run
else
  echo "==> Skipping flamegraph (0x not installed). Install with: npm install -g 0x"
fi
