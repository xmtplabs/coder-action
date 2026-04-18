#!/usr/bin/env bash
set -uo pipefail
fail=0
report() {
  echo "ARCHITECTURE VIOLATION: $1" >&2
  echo "$2" >&2
  fail=1
}

# EARS-REQ-3: actions do not import Coder specifics
out=$(grep -rnE 'from "(\.\./)*services/coder/|ExperimentalCoderSDK|CoderSDK|CoderAPIError' src/actions/ --include='*.ts' || true)
[ -n "$out" ] && report "actions import Coder internals" "$out"

# EARS-REQ-4: framework isolation (hono / @octokit/webhooks-methods only under src/http/)
out=$(grep -rnE 'from "(hono|@octokit/webhooks-methods)' src/ --include='*.ts' | grep -v '^src/http/' || true)
[ -n "$out" ] && report "Hono/webhooks-methods import outside src/http/" "$out"

# EARS-REQ-13: TaskName/TaskId brand declarations only in services/task-runner.ts
out=$(grep -rnE '\.brand\("(TaskName|TaskId)"' src/ --include='*.ts' | grep -v '^src/services/task-runner.ts:' || true)
[ -n "$out" ] && report "TaskName/TaskId brand defined outside services/task-runner.ts" "$out"

exit $fail
