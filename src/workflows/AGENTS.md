# src/workflows — agent rules

Durable processing layer. Break any of these rules and things silently corrupt on replay.

## Step callbacks must return structured-cloneable data

Every `step.do` callback returns **plain JSON-serializable data** — primitives, plain objects, or arrays of serializables. The Workflow engine persists return values via structured clone and throws on anything non-cloneable.

```ts
// ❌ Raw Octokit / Coder SDK responses contain symbols + functions
await step.do("fetch-pr", async () => github.getPR(owner, repo, n));

// ✅ Project to scalars you actually need
await step.do("fetch-pr", async () => {
  const raw = await github.getPR(owner, repo, n);
  return { number: raw.number, authorLogin: raw.user.login, headSha: raw.head.sha };
});
```

Never return: class instances (`Octokit`, `CoderService`, `GitHubClient`, `URL`, `Response`, `Request`), functions, `Symbol`, circular references, or raw SDK responses.

## Closure state in `run()` must be derived purely from cached step outputs

The engine replays `run()` from the top on every resume. Completed `step.do` calls return their cached outputs; code between them re-executes. Two hard rules:

1. **Never mutate closure state inside a `step.do` callback.** The callback doesn't re-execute on replay, so the mutation wouldn't happen again. `imageList.push(x)` inside a step is a latent bug.
2. **Never depend on `Date.now()`, `Math.random()`, or cross-request globals.** Replay sees different values.

Under those rules, mutation of closure variables **outside** step callbacks, based purely on cached step outputs, is safe. This is how `ensure-task-ready.ts` tracks `nilStateStartAttempt` across iterations.

## Step names must be unique per instance

Workflows caches step outputs by name within an instance. Two `step.do("foo", ...)` calls collide.

```ts
// ❌ Second iteration returns the first iteration's cached result
for (const job of failedJobs) {
  await step.do("fetch-job-logs", async () => ...);
}

// ✅
for (const job of failedJobs) {
  await step.do(`fetch-job-logs-${job.id}`, async () => ...);
}
```

## Task naming: deterministic, issue-scoped, `generateTaskName` only

Tasks are named `{prefix}-{repo}-{issueNumber}` (e.g. `gh-myrepo-42`). Two hard rules:

1. **Always use `generateTaskName()` from `src/actions/task-naming.ts`** — never build names by string interpolation. The helper truncates the repo name to stay under Coder's 32-character limit and trims trailing dashes.
2. **Key on the issue number, not the PR number.** PR-scoped events (`pull_request_review_comment`, `pull_request_review`, `workflow_run` failures) must call `github.findLinkedIssues(owner, repo, prNumber)` first and use the first linked issue's number. PR with no linked issue → silently no-op; no task exists to route to.

`runFailedCheck` is the reference pattern. `runComment` shipped the issue-vs-PR bug once — see `docs/gotchas.md`.

## Step factory signature

Every `src/workflows/steps/*.ts` export follows the same shape:

```ts
export interface RunFooContext {
  step: WorkflowStep;
  coder: CoderService;
  github: GitHubClient;
  config: AppConfig;
  event: FooEvent;
}

export async function runFoo(ctx: RunFooContext): Promise<void> { /* ... */ }
```

`CoderTaskWorkflow.run()` constructs `coder` and `github` once at the top and passes them through. That's the DI seam — tests pass fakes directly without patching module-level imports. Adding a new factory? Mirror the shape exactly; the workflow dispatch relies on it.

## Paused tasks: resume only in pre-poll dispatch

`ensureTaskReady` handles `paused` in two different places:

- **Pre-poll** (initial lookup): resume via `step.do("resume-paused-task", …)` then enter the poll loop.
- **Mid-poll** (task became paused while we were waiting): throw `NonRetryableError`. Don't loop resume attempts — a task re-entering paused mid-wait signals workspace instability and continuing won't help.

## Send input only after `ensureTaskReady`

`CoderService.sendTaskInput` is a single POST with no pre-checks. Never call it outside of a workflow step factory that has first awaited `ensureTaskReady`. Bypassing the readiness wait means sending to a `working` or `paused` task, where the send is rejected or queued unpredictably.

## Don't catch-all at the top of `run()`

Uncaught exceptions transition the instance to `errored` state, which surfaces in `wrangler workflows instances list` and Workers Logs. An operator can `instance.restart()` after fixing the root cause. Adding a catch-all swallow would hide production issues. If a step hits a terminal error, throw `NonRetryableError` — explicit, terminal, observable.

## Instance IDs are the dedupe mechanism

`buildInstanceId(event, deliveryId)` produces a deterministic ID per delivery. GitHub retries with the same `X-GitHub-Delivery` collide on `WORKFLOW.create()` with "already exists", which the Worker catches and returns 200 for. Don't add application-level idempotency keys — the instance ID does it all.

Character set: `[a-zA-Z0-9_-]{1,64}` (underscore allowed, dot not). The sanitizer replaces anything outside that with `-` and truncates.

## `ensureTaskReady` thresholds

`ensure-task-ready.ts` hard-codes:

- `MAX_ATTEMPTS = 60` (30 min total at 30-second polls)
- `ERROR_GRACE_ATTEMPTS = 10` (5 min of `error`/`unknown` tolerated)
- `NIL_STATE_GRACE_ATTEMPTS = 4` (2 min of `active + null` before treated as idle)
- `POLL_INTERVAL = "30 seconds"`
- `STATUS_RETRY` = 3 × 2s exponential (per-step transient-failure absorption)

These aren't arbitrary:
- Timeout throws a plain `Error` (NOT `NonRetryableError`) so an operator can `instance.restart()`.
- Error/unknown-beyond-grace throws `NonRetryableError` — the task is stuck, retrying won't help.
- `active + idle`/`complete`/**`failed`** all return immediately. `failed` is terminal-ready in Coder semantics — see `docs/gotchas.md`.

## See also

- `docs/conventions.md` — general code conventions across the repo
- `docs/gotchas.md` — foot-guns with context
- `docs/testing.md` — introspection and fake-step patterns
