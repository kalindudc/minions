#!/usr/bin/env bash
set -euo pipefail

PKG="npm"
if command -v pnpm &>/dev/null; then
  PKG="pnpm"
fi

echo "==> Running Biome linter and formatter..."
${PKG} exec biome check --write --unsafe --no-errors-on-unmatched --error-on-warnings ./src ./extensions ./test
biome_exit=$?

echo ""
echo "==> Running TypeScript type checker..."
${PKG} exec tsc --noEmit
tsc_exit=$?

echo ""
if [ $biome_exit -ne 0 ] || [ $tsc_exit -ne 0 ]; then
  echo "✗ Style check failed"
  exit 1
else
  echo "✓ Style check passed"
fi
