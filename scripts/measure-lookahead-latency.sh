#!/usr/bin/env bash
# Measure lookahead-brief latency across multiple projects.
# Usage: bash scripts/measure-lookahead-latency.sh [project1 project2 ...]
# Default: tests against wezbridge if no args.

set -u
GOOSE="${GOOSE_BIN:-$HOME/.local/bin/goose.exe}"
RECIPE="$(cd "$(dirname "$0")/.." && pwd)/recipes/lookahead-brief.yaml"

declare -a TARGETS
if [ $# -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=("G:/_OneDrive/OneDrive/Desktop/Py Apps/wezbridge")
fi

echo "=== look-ahead recipe latency benchmark ==="
echo "recipe: $RECIPE"
echo

for proj in "${TARGETS[@]}"; do
  if [ ! -d "$proj" ]; then
    echo "[skip] $proj — not a directory"
    continue
  fi
  if [ ! -f "$proj/monitoring.md" ]; then
    echo "[skip] $proj — no monitoring.md (not orchestrated yet)"
    continue
  fi

  echo "=== $(basename "$proj") ==="
  cd "$proj" || continue

  # COLD run (fresh ACP + MCP boot)
  T0=$(date +%s%N)
  out=$("$GOOSE" run --recipe "$RECIPE" --params "user_task=One sentence — what is the active task?" --no-session 2>&1 | tail -3)
  T1=$(date +%s%N)
  COLD_MS=$(( (T1 - T0) / 1000000 ))
  echo "  cold:  ${COLD_MS}ms"

  # WARM run (immediate retry — MM cache may help)
  T0=$(date +%s%N)
  out=$("$GOOSE" run --recipe "$RECIPE" --params "user_task=One sentence — what is the active task?" --no-session 2>&1 | tail -3)
  T1=$(date +%s%N)
  WARM_MS=$(( (T1 - T0) / 1000000 ))
  echo "  warm:  ${WARM_MS}ms"
  echo
done

cd - > /dev/null 2>&1
echo "=== done ==="
