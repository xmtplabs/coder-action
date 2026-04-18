# src/services/coder — agent rules

`CoderService` is the HTTP-primitives wrapper for the Coder experimental tasks API. Orchestration (polling, retries, timeouts) lives one layer up in `src/workflows/`.

## Primitives only — no composite operations

Every public method maps to a single HTTP request. No method is allowed to:
- Poll / wait for state transitions
- Retry beyond the enclosing workflow step's retry policy
- Combine multiple external calls into one method

If a caller needs "create task, wait for ready, then send input," the caller composes `create` + `ensureTaskReady` + `sendTaskInput` — never a single `CoderService` method.

## `create` is idempotent per `(taskName, owner)`

If a task with the same name + owner already exists, `create` returns the existing task without modification. Never POSTs twice, never mutates. Task naming is deterministic (`generateTaskName` in `src/actions/task-naming.ts`), so a webhook retry for the same issue lands on the same task.

## `delete` is idempotent — no teardown

`delete` issues a single `DELETE /api/experimental/tasks/<owner>/<id>` and returns `{ deleted: true }` when removed or `{ deleted: false }` when the task didn't exist (no-op). Never stops the workspace separately, never waits, never deletes the workspace. The experimental tasks endpoint handles lifecycle on its own; don't interleave workspace-level operations.

## `findTaskByName` vs `getStatus` — different shapes

Easy to confuse:

| Method | Return shape | Notes |
|---|---|---|
| `findTaskByName(name, owner?)` | `ExperimentalCoderSDKTask \| null` | **Raw SDK** — has `id`, `owner_id` (UUID), `current_state`, `workspace_id`. Owner is a UUID, not a username. |
| `getTaskById(id, owner)` | `ExperimentalCoderSDKTask` | **Raw SDK**, throws on non-2xx. |
| `getStatus({ taskName, owner? })` | `Task \| null` | **Normalized** — has `id`, `name`, `status: TaskStatus`, `owner: string` (username), `url`. |
| `create(...)` | `Task` | **Normalized**. |

Workflow step factories use `findTaskByName` when they need the raw shape (e.g. `workspace_id` for resume), and `create` / `getStatus` when they need the normalized user-facing `Task`. Don't mix.

## UUID → username resolution

When a raw task's `owner_id` is a UUID (matches the v4 pattern), `resolveOwnerUsername` calls `GET /api/v2/users/<id>` to translate to a username. This matters because `Task.url` must carry a human-readable username (`/tasks/<username>/<id>`), and the experimental `/send` endpoint accepts either but username is conventional. Non-UUID inputs pass through unchanged.

## Status normalization

`normalizeStatus(rawStatus, currentState)` maps Coder's `(status, current_state.state)` tuple to our provider-agnostic `TaskStatus` enum (`"initializing" | "ready" | "stopped" | "error"`). `failed` current-state is treated as **ready** — the task is alive and waiting for input, the last operation just errored. See `docs/gotchas.md` for the Coder-CLI precedent.

## Warn-but-proceed on ambiguous lookups

`findTaskByName` without an `owner` argument scans all tasks by name. If multiple match, it logs a warning and returns the first. Don't silently drop duplicates — the warning is the signal for the operator to investigate.

## Secrets never in errors

`CoderAPIError` carries the HTTP status, status text, and response body text. The body may contain the request URL (redacted from secrets by Coder itself). Don't log the `apiToken` or construction-time config anywhere in this module.
