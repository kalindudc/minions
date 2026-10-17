#!/usr/bin/env bash
# Run e2e tests via a non-interactive pi session with live progress.
# Usage: ./scripts/e2e.sh [test-filter]
# Examples:
#   ./scripts/e2e.sh              # run all tests
#   ./scripts/e2e.sh step         # run tests matching "step"
#   ./scripts/e2e.sh graceful     # run tests matching "graceful"
set -uo pipefail

FILTER="${1:-}"
PROGRESS="/tmp/logs/pi-minions/e2e-progress.log"
RESULTS="/tmp/logs/pi-minions/e2e-results.json"
FRAMES=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")

rm -f "$PROGRESS" "$RESULTS"
mkdir -p /tmp/logs/pi-minions
touch "$PROGRESS"

rm -f /tmp/logs/pi-minions/minions/*.log
rm -f /tmp/logs/pi-minions/debug.log
touch /tmp/logs/pi-minions/debug.log

echo ""
echo "  pi-minions e2e test suite"
echo "  ─────────────────────────"
if [[ -n "$FILTER" ]]; then
  echo "  filter: $FILTER"
fi
echo ""

# find all tests files fuzzy matching the filter, sorted by name
TEST_FILES=()
while IFS= read -r -d '' file; do
  TEST_FILES+=("$file")
done < <(find test/pi/e2e -type f -name "*$FILTER*" -print0 | sort -z)

echo ""
echo "  Found ${#TEST_FILES[@]} test(s):"
for f in "${TEST_FILES[@]}"; do
  echo "    - $f"
done
echo ""

PROMPT="Load the e2e-runner skill. Execute test files in test/pi/e2e/ in sorted order. Follow the skill instructions exactly. Write the JSON report when done."
if [[ -n "$FILTER" ]]; then
  PROMPT="Load the e2e-runner skill. Run only the following tests: \`${TEST_FILES[*]}\`. Execute the test files in test/pi/e2e/. Follow the skill instructions exactly. Write the JSON report when done."
fi

# use pi --list-models to prompt the user for a model

MODELS_OUTPUT=$(pi --list-models 2>/dev/null)
if [[ -z "$MODELS_OUTPUT" ]]; then
  echo "  ✗ Failed to fetch models from pi --list-models"
  exit 1
fi

if command -v fzf >/dev/null 2>&1; then
  SELECTED_LINE=$(echo "$MODELS_OUTPUT" | fzf --header-lines=1 --prompt="Select model: ")
else
  echo "$MODELS_OUTPUT"
  echo ""
  read -rp "  Enter row number (2-N, skipping header): " row
  SELECTED_LINE=$(echo "$MODELS_OUTPUT" | sed -n "${row}p")
fi

SELECTED_PROVIDER=$(echo "$SELECTED_LINE" | awk '{print $1}')
SELECTED_MODEL=$(echo "$SELECTED_LINE" | awk '{print $2}')
echo "  Using: $SELECTED_PROVIDER/$SELECTED_MODEL"
echo ""


# Start pi in background — non-interactive, no session saved
pi -e "$(pwd)/extensions/pi/index.ts" -p "$PROMPT" -ns --skill "./.pi/skills/e2e-runner/" --model "$SELECTED_PROVIDER/$SELECTED_MODEL"  >/dev/null 2>&1 &
PID=$!

# Watch progress file with animated spinner
STATUS=""
FRAME=0
LAST_COUNT=0

while kill -0 "$PID" 2>/dev/null; do
  COUNT=$(wc -l < "$PROGRESS" 2>/dev/null | tr -d ' ')
  COUNT=${COUNT:-0}

  while (( LAST_COUNT < COUNT )); do
    LAST_COUNT=$((LAST_COUNT + 1))
    LINE=$(sed -n "${LAST_COUNT}p" "$PROGRESS")
    TYPE="${LINE%% *}"
    NAME="${LINE#* }"
    case "$TYPE" in
      RUNNING)
        STATUS="$NAME"
        ;;
      PASS)
        printf "\r\033[K  \033[32m✓\033[0m %s\n" "$NAME"
        STATUS=""
        ;;
      FAIL)
        printf "\r\033[K  \033[31m✗\033[0m %s\n" "$NAME"
        STATUS=""
        ;;
    esac
  done

  printf "\r  %s %s" "${FRAMES[$FRAME]}" "${STATUS:-Working...}"
  FRAME=$(( (FRAME + 1) % 10 ))
  sleep 0.1
done

# Drain any remaining progress lines after pi exits
COUNT=$(wc -l < "$PROGRESS" 2>/dev/null | tr -d ' ')
COUNT=${COUNT:-0}
while (( LAST_COUNT < COUNT )); do
  LAST_COUNT=$((LAST_COUNT + 1))
  LINE=$(sed -n "${LAST_COUNT}p" "$PROGRESS")
  TYPE="${LINE%% *}"
  NAME="${LINE#* }"
  case "$TYPE" in
    PASS)  printf "\r\033[K  \033[32m✓\033[0m %s\n" "$NAME" ;;
    FAIL)  printf "\r\033[K  \033[31m✗\033[0m %s\n" "$NAME" ;;
  esac
done

printf "\r\033[K"
wait "$PID" 2>/dev/null || true
echo ""

# Validate JSON report
if [[ ! -f "$RESULTS" ]]; then
  echo "  ✗ No results file at $RESULTS"
  echo "    Debug log: /tmp/logs/pi-minions/debug.log"
  exit 1
fi

node -e "
  const r = JSON.parse(require('fs').readFileSync('$RESULTS','utf8'));
  console.log('  ─────────────────────────');
  for (const t of r.tests) {
    const icon = t.passed ? '✓' : '✗';
    console.log('  ' + icon + ' ' + t.name);
    if (!t.passed) for (const c of (t.conditions||[])) if (!c.passed) console.log('      ' + c.description + ': ' + c.reason);
  }
  console.log('');
  if (r.summary.failed > 0) {
    console.error('  ' + r.summary.failed + '/' + r.summary.total + ' test(s) failed');
    process.exit(1);
  }
  console.log('  All ' + r.summary.passed + '/' + r.summary.total + ' tests passed.');
"
