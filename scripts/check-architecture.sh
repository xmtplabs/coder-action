#!/usr/bin/env bash
set -uo pipefail
fail=0
report() {
  echo "ARCHITECTURE VIOLATION: $1" >&2
  echo "$2" >&2
  fail=1
}

# src/actions/* is mostly deleted post-migration; keep this check for the
# pure modules that remain (messages.ts, task-naming.ts).
if [ -d src/actions ]; then
  out=$(grep -rnE 'from "(\.\./)*services/coder/|ExperimentalCoderSDK|CoderSDK|CoderAPIError' src/actions/ --include='*.ts' || true)
  [ -n "$out" ] && report "actions import Coder internals" "$out"
fi

# @octokit/webhooks-methods: confined to the HTTP layer (src/http/).
out=$(grep -rnE 'from "@octokit/webhooks-methods' src/ --include='*.ts' | grep -v '^src/http/' || true)
[ -n "$out" ] && report "@octokit/webhooks-methods import outside src/http/" "$out"

# TaskName/TaskId brand declarations only in services/task-runner.ts
out=$(grep -rnE '\.brand\("(TaskName|TaskId)"' src/ --include='*.ts' | grep -v '^src/services/task-runner.ts:' || true)
[ -n "$out" ] && report "TaskName/TaskId brand defined outside services/task-runner.ts" "$out"

# Fail if any non-test file imports from bun:test
out=$(grep -RInE "from ['\"]bun:test['\"]" src/ || true)
[ -n "$out" ] && report "bun:test import found in src/" "$out"

# Fail if pino remains in imports
out=$(grep -RInE "from ['\"]pino(-pretty)?['\"]" src/ || true)
[ -n "$out" ] && report "pino import found in src/" "$out"

# Fail if hono remains in imports (bare fetch handler only)
out=$(grep -RInE "from ['\"]hono" src/ || true)
[ -n "$out" ] && report "hono import found in src/" "$out"

# Fail if Dockerfile or .dockerignore exists
[ -e Dockerfile ] && report "Dockerfile must not exist" ""
[ -e .dockerignore ] && report ".dockerignore must not exist" ""

# Fail if wrangler.toml is absent
[ ! -f wrangler.toml ] && report "wrangler.toml must exist" ""

# Fail if src/services/coder/polling.ts still exists
[ -e src/services/coder/polling.ts ] && report "polling.ts must not exist" ""

exit $fail
