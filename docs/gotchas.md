# Gotchas

Things that have bitten us. Read before touching the adjacent code.

## PR number vs issue number in task keys

Tasks are named `{prefix}-{repo}-{issueNumber}` — deterministic per **issue**, not per PR. Coder creates the task when an issue is assigned, so the task is keyed on the issue number. The PR it eventually opens closes that issue via `closingIssuesReferences`.

Implication: any code path that receives a PR-scoped event (PR comment, PR review, workflow_run failure on an agent PR) **must** resolve the linked issue via `GitHubClient.findLinkedIssues(owner, repo, prNumber)` before building the task name. The PR number is never a valid task key.

`runComment` shipped with this bug once (calling `generateTaskName(..., event.target.number)` unconditionally). PR-kind comments were silently dropped because `gh-repo-<prNumber>` never existed. Fixed in `3dbb55c`; regression guard in `src/workflows/steps/comment.test.ts` — "PR comment: findTaskByName is called with `{prefix}-{repo}-{linkedIssue}`, NOT the PR number."

`runFailedCheck` already does this correctly — mirror its pattern if you add another PR-scoped event type.

## Step names must be unique per instance

Workflows caches step outputs by name within an instance. A static name inside a `for` loop collides on the second iteration:

```ts
// ❌ Second job collides with the first; cache returns the wrong logs.
for (const job of failedJobs) {
  const logs = await step.do("fetch-job-logs", async () => ...);
}

// ✅
for (const job of failedJobs) {
  const logs = await step.do(`fetch-job-logs-${job.id}`, async () => ...);
}
```

`runFailedCheck` shipped with this bug once. Fixed in `714a7bb`; regression guard in `failed-check.test.ts` asserts `new Set(step.calls).size === step.calls.length`.

## Step callbacks must return structured-cloneable data

See [conventions.md](conventions.md#step-callback-serialization-ears-req-16a). The most common mistake is returning a raw Octokit response or a raw Coder SDK task. Both contain non-cloneable fields (symbols, functions). The engine throws on attempted persistence. Always project down to plain scalars.

Closure captures of `Octokit` / `CoderService` / `GitHubClient` **inside** step callbacks are fine — they just can't cross the return boundary.

## Closure-state mutation inside a `step.do` callback is a latent bug

```ts
// ❌ The push runs on first execution but NOT on replay (cached result is returned).
// `imageList` ends up empty after hibernation.
const imageList = [];
await step.do("fetch-a", async () => imageList.push(await fetchA()));
await step.sleep("wait", "1 hour");  // hibernation boundary
await step.do("use-list", async () => useList(imageList));  // empty on replay

// ✅ State derived from step RETURNS, not from inside them.
const a = await step.do("fetch-a", async () => fetchA());
const b = await step.do("fetch-b", async () => fetchB());
await step.do("use-both", async () => useList([a, b]));
```

Full rule in [conventions.md](conventions.md#closure-state-in-run-ears-req-16b). The replay semantics are subtle; if you're unsure whether a closure mutation is safe, the answer is "probably not."

## `mockStepResult` with falsy values is treated as "no mock set"

In `@cloudflare/vitest-pool-workers`, miniflare's internal storage rejects or silently ignores `false` / `null` as step-mock values. The callback then runs for real and hits the live API (if reachable) or times out.

```ts
// ❌ If the step would normally return a boolean, this appears to work but doesn't.
await m.mockStepResult({ name: "check-github-permission" }, false);

// ✅ Either structure the step to return a plain object, or drop to unit-level
// tests that use a fake step directly (src/workflows/steps/*.test.ts).
```

Two would-be introspection tests (permission=false early-return, PR-not-found early-return) had to fall back to unit tests because of this. The unit tests in `src/workflows/steps/*.test.ts` cover those branches properly.

## `failed` is terminal-ready in Coder semantics

Intuitively weird but correct: `ensureTaskReady` treats `active + current_state.state === "failed"` as "ready to send input." This matches Coder's own CLI (`cli/task_send.go`). The state means "the task's previous operation errored, but the task itself is alive and idle, waiting for the next input." Think REPL: if the last expression threw, the prompt is back.

Changing this to refuse sending on `failed` would silently drop user comments whenever the previous agent attempt errored. The grouping `{idle, complete, failed}` is the product expectation — don't "fix" it without a product conversation.

## `CoderService.findTaskByName` returns the raw SDK task; `getStatus` returns the normalized Task

Easy to confuse:

- `findTaskByName(name, owner?)` → `ExperimentalCoderSDKTask | null` (raw — has `id`, `owner_id`, `current_state`, `workspace_id`, etc.)
- `getTaskById(id, owner)` → `ExperimentalCoderSDKTask` (raw, throws on non-2xx)
- `getStatus({ taskName, owner? })` → `Task | null` (normalized — has `id`, `name`, `status: TaskStatus`, `owner: string` [username], `url`)
- `create(...)` → `Task` (normalized)

The raw shape uses `owner_id` (UUID) and needs `resolveOwnerUsername` before building URLs. The normalized shape has already resolved the username and composed the URL. Pick the right one; don't mix.

## `resolveOwnerUsername` UUID detection

When `owner_id` from a raw task is a UUID (v4 pattern), `CoderService.resolveOwnerUsername()` calls `GET /api/v2/users/<id>` to translate to a username. Otherwise it assumes the input is already a username and returns it unchanged. This matters for URL composition (`Task.url` must carry a human-readable username) and for the `POST /api/v2/tasks/<owner>/<id>/send` endpoint (which accepts either, but username is conventional).

If a future Coder release changes the UUID format, the regex in `resolveOwnerUsername` needs updating.

## Inline `noopLogger` in `CoderService`

`src/services/coder/service.ts:40` has an inline `noopLogger` constant. This predates the migration and should be replaced with "omit the `logger` option, let the constructor default to no-op" — but the refactor was deferred because the inline impl works and the constructor was designed to require a logger. Low priority, but if you're touching `CoderService`'s construction, take the opportunity.

## Signature verification runs *before* JSON parsing (ordering matters)

`parseWebhookRequest` checks the signature before reading the `X-GitHub-Event` header or parsing the body. A malformed JSON body with a missing signature returns 401, not 400 — so unauthenticated callers never learn anything about body shape. See the "stage ordering" test in `src/http/parse-webhook-request.test.ts`. Don't reorder the stages to optimize for the common case.

## Workflows are not supported as remote bindings

`wrangler dev --remote` won't work for this project. Use plain `wrangler dev` for local Miniflare emulation and pair with `cloudflared tunnel --url http://localhost:8787` if GitHub needs to reach you.

## Webhook payloads can exceed Workflow event size

GitHub webhooks can be ~25 MB in extreme cases (huge commit lists, large diffs). Workflows caps `event.payload` at 1 MiB. Our event types (`issues`, `issue_comment`, `pull_request_review_comment`, `pull_request_review`, `workflow_run`) are empirically <100 KB, but if a `workflow_run.completed` payload ever exceeds 1 MiB, `WORKFLOW.create()` throws and the Worker returns 500 (GitHub will retry; if it keeps failing, the delivery is abandoned). No paginate-or-split is attempted. If this becomes a real problem, move the payload to R2 and pass a reference.

## Installation-token auth is deferred until the first API call

`@octokit/auth-app`'s `createAppAuth` is lazy: `new Octokit({ authStrategy: createAppAuth, auth: {...} })` doesn't network. The first Octokit method call (e.g. `octokit.rest.repos.getCollaboratorPermissionLevel(...)`) triggers the JWT mint + installation-token exchange. This is why we can construct Octokit at the top of `run()` without worrying about transient failures at construction time — they show up inside the first step that uses it, where step-retry covers them.

## Workflow binding rename orphans in-flight instances

If you ever rename `CODER_TASK_WORKFLOW` in `wrangler.toml`, in-flight instances bound to the old name are orphaned. Use [`migrateWorkflowBinding()`](https://developers.cloudflare.com/agents/api-reference/run-workflows/) in a dedicated migration step — don't bundle with other changes. (We don't currently plan to rename; this is a footgun for the future.)

## Uncaught errors in `run()` → `errored` state (intentional)

We deliberately do NOT wrap the top-level `switch (payload.type)` in a catch-all. An uncaught exception transitions the instance to `errored`, which surfaces in `wrangler workflows instances list` and Workers Logs. An operator can `instance.restart()` after fixing the underlying fault. Silent recovery would hide real production issues.

If you're tempted to add `try { ... } catch { /* swallow */ }` somewhere in a step factory, the answer is almost always "throw `NonRetryableError` instead so the failure is explicit and terminal."

## Zod 400-branch in `main.ts` is unreachable today

`parseWebhookRequest` returns 400 for missing `X-GitHub-Event` and invalid JSON. The router also returns `SkipResult` with a `validationError` flag that `main.ts` maps to 400 — but the router never sets `validationError: true` (it uses structural `as` casts with null-checks, not Zod schemas). So that specific 400 branch is dead code today. The test in `src/testing/integration.test.ts` pins the current behavior (malformed-but-signed payload → 200 SkipResult) with a comment noting what to change when/if the router gets a Zod refactor.

## Test isolation with `await using`

Workflow introspectors hold storage handles. Forgetting `await using` (or explicit `dispose()`) leaks state into the next test:

```ts
// ✅
await using instance = await introspectWorkflowInstance(env.CODER_TASK_WORKFLOW, id);

// ❌ state persists across tests; instance that completed in this test will
// already be marked complete in the next
const instance = await introspectWorkflowInstance(env.CODER_TASK_WORKFLOW, id);
```

See [testing.md](testing.md#workflow-introspection-pattern) for the full pattern.
