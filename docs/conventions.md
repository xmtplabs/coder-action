# Conventions

Mandatory patterns. Breaking any of these results in code that compiles, passes type-check, and silently misbehaves — usually only after hibernation/replay. Read before non-trivial changes.

## Deterministic task naming

Tasks are named `{prefix}-{repo}-{issueNumber}` (e.g. `gh-myrepo-42`). **Always** use `generateTaskName()` from `src/actions/task-naming.ts` — never build names by string interpolation. The helper truncates the repo name to stay under Coder's 32-character limit and trims trailing dashes.

Tasks are keyed on the **issue** number, never the PR number. PR-scoped events (`pull_request_review_comment`, `pull_request_review`, `workflow_run` failures) must resolve the linked issue via `GitHubClient.findLinkedIssues(owner, repo, prNumber)` before naming the task. See the PR/issue gotcha in [gotchas.md](gotchas.md#pr-number-vs-issue-number-in-task-keys).

## Branded types

`TaskId` and `TaskName` are Zod-branded types declared in `src/services/task-runner.ts`. Produce them via:

```ts
const taskName = TaskNameSchema.parse(raw);
const taskId   = TaskIdSchema.parse(raw);  // UUID
```

Never cast with `as TaskName` / `as TaskId` — the brand has no runtime representation, and a bad cast will produce a corrupt value that passes all type checks.

## Step callback serialization (EARS-REQ-16a)

Every `step.do` callback must return **plain JSON-serializable data** — primitives, plain objects, or arrays of serializables. Never return:

- Class instances (`Octokit`, `CoderService`, `GitHubClient`, `URL`, `Response`, `Request`, …)
- Functions, `Symbol`, objects with circular references
- Raw Octokit response objects (they contain non-cloneable fields)
- Raw Coder SDK task objects (same reason)

The Workflow engine stores step results via structured clone and throws on anything non-serializable. When an external API call yields a rich object, extract the scalars you need:

```ts
// ✅ Good
const pr = await step.do("fetch-pr-info", async () => {
  const raw = await github.getPR(owner, repo, number);
  return {
    number: raw.number,
    authorLogin: raw.user.login,
    headSha: raw.head.sha,
  };
});

// ❌ Bad — raw contains Octokit-internal symbols and functions
const pr = await step.do("fetch-pr-info", async () => github.getPR(owner, repo, number));
```

## Closure state in run() (EARS-REQ-16b)

The Workflow engine replays `run()` from the top on every resume. Completed `step.do` calls return their cached outputs; the function body between them re-executes. This implies two rules:

1. **Closure state must not be mutated inside a `step.do` callback.** The callback doesn't re-execute on replay, so the mutation wouldn't happen again. `imageList.push(x)` inside a step is a latent bug.

2. **Closure state must not depend on `Date.now()`, `Math.random()`, or cross-request globals.** Replay sees different values.

Under those rules, closure state derived purely from cached step outputs **is** safe and is how `ensure-task-ready.ts` tracks `nilStateStartAttempt` across iterations:

```ts
let nilStateStartAttempt: number | null = null;   // outside any step.do
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const obs = await step.do(`check-status-${attempt}`, ..., async () => {...});
  // ↓ mutation happens OUTSIDE step.do, based ONLY on cached step output
  if (obs.status === "active" && obs.state === null) {
    if (nilStateStartAttempt === null) nilStateStartAttempt = attempt;
  } else {
    nilStateStartAttempt = null;
  }
  await step.sleep(`wait-${attempt}`, "30 seconds");
}
```

On replay, `nilStateStartAttempt` reconstructs to the same value it had before hibernation because each `step.do` returns its cached output and the mutation logic re-runs identically.

## Signature verification before anything else

`parseWebhookRequest` (`src/http/parse-webhook-request.ts`) runs the HMAC-SHA256 check via `@octokit/webhooks-methods#verify` (timing-safe) **before** reading headers or parsing JSON. The stage ordering is tested explicitly — unauthenticated callers get `401` without the parser leaking information about the body shape. Don't reorder.

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

The `CoderTaskWorkflow.run()` method constructs `coder` and `github` once at the top and passes them through. This is the DI seam — tests pass fakes directly without patching module-level imports.

## Logger

`src/infra/logger.ts` exports `createLogger` (production) and `TestLogger` (tests). Log structured objects:

```ts
logger.info("Webhook received", { deliveryId, eventName });
// emits: console.log(JSON.stringify({level: "info", msg: "Webhook received", deliveryId, eventName, ...bindings}))
```

Workers Logs ingests stdout JSON natively; every field becomes an indexed queryable dimension. Don't interpolate structured values into the `msg` string (`` `user ${id} logged in` ``) — the dashboard can't filter on them.

`TestLogger` captures `.messages` for assertion. Never invent a local `noopLogger` — `CoderService` construction accepts an optional `logger`; omit it for "no logging." *(There is currently one historical inline `noopLogger` in `src/services/coder/service.ts` that should migrate — see [gotchas.md](gotchas.md#inline-nooplogger-in-coderservice).)*

## Secrets handling

- `wrangler.toml` `[vars]` — non-secret config only (repo URLs, prefixes, template names).
- `wrangler secret put` (production) / `.dev.vars` (local) — `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET`, `CODER_TOKEN`.
- `loadConfig()` error messages use `issue.path` + `issue.message` from Zod; they **never** include raw values. Keep that invariant if you edit the loader.
- `.dev.vars` is gitignored via `.gitignore`. `.dev.vars.example` is committed as a template.

## Step names must be unique per instance

Cloudflare Workflows caches step outputs by name within an instance. Two `step.do("foo", ...)` calls in the same run collide — the second returns the cached first result or errors. When iterating, interpolate an index or id:

```ts
for (const job of failedJobs) {
  const logs = await step.do(`fetch-job-logs-${job.id}`, async () => ...);
  //                                       ^^^^^^^^^ required
}
```

## Workflow instance IDs

`buildInstanceId(event, deliveryId)` produces `{eventType}-{repo}-{issueOrPr}-{deliveryId}`, sanitized to the Workflow instance charset `[a-zA-Z0-9_-]{1,64}`. The sanitizer allows underscores, so `check_failed` is kept verbatim (not `check-failed`).

GitHub retries with the same `X-GitHub-Delivery` collapse to the same instance — `WORKFLOW.create()` throws "already exists", which the Worker catches via `isDuplicateInstanceError` and returns 200 for. The dedup mechanism is **entirely** on the instance ID; don't add application-level idempotency keys.
