#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GIT="/usr/bin/git"
PYTHON="/usr/bin/python3"
LOG="$ROOT/logs/daily_publish.log"

mkdir -p "$ROOT/logs"

log() {
  printf '%s INFO %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG"
}

fail() {
  local message="$1"
  printf '%s ERROR %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$message" | tee -a "$LOG" >&2
  "$PYTHON" -B "$ROOT/scripts/notify_feishu.py" \
    --failure "$message" \
    --failure-stage "同步公有 Git 仓库" \
    --log-path "$LOG" || true
  exit 1
}

cd "$ROOT"

branch="$($GIT branch --show-current)"
if [ "$branch" != "main" ]; then
  fail "public repository must be on main, currently on ${branch:-detached HEAD}"
fi

dirty="$($GIT status --porcelain --untracked-files=all)"
if [ -n "$dirty" ]; then
  dirty_paths="$(printf '%s\n' "$dirty" | sed -n '1,8p' | sed 's/^...//' | awk 'BEGIN { sep = "" } { printf "%s%s", sep, $0; sep = ", " } END { print "" }')"
  fail "refusing to sync public repository with uncommitted files: $dirty_paths"
fi

log "syncing public repository origin/main"
if ! output="$($GIT fetch origin main 2>&1)"; then
  fail "public repository fetch failed: $output"
fi
if [ -n "$output" ]; then
  log "$output"
fi

if ! output="$($GIT merge --ff-only origin/main 2>&1)"; then
  fail "public repository fast-forward failed: $output"
fi
if [ -n "$output" ]; then
  log "$output"
fi

exec "$PYTHON" -B "$ROOT/scripts/run_daily_publish.py" "$@"
