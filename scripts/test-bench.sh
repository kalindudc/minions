#!/usr/bin/env bash
set -euo pipefail

PKG="npm"
if command -v pnpm &>/dev/null; then
  PKG="pnpm"
fi

mkdir -p tmp/profiles

echo "==> Running benchmark tests..."
${PKG} exec vitest bench test/pi/perf/ --run

echo "==> Running CPU profiling..."
NODE_OPTIONS='--cpu-prof --cpu-prof-dir=./tmp/profiles' ${PKG} exec vitest bench test/pi/perf/ --run

echo "==> Running heap profiling..."
NODE_OPTIONS='--heap-prof --heap-prof-dir=./tmp/profiles' ${PKG} exec vitest bench test/pi/perf/ --run

echo ""
echo "Profiles saved to tmp/profiles/"
ls -lh tmp/profiles/ || echo "No profiles generated"
