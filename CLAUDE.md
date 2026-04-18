# CLAUDE.md — coder-action

Cloudflare Worker + single Cloudflare Workflow that drives Coder AI task lifecycle from GitHub webhooks. The Worker signature-verifies and classifies each webhook, then enqueues a `CoderTaskWorkflow` instance that talks to the Coder and GitHub APIs durably (step-level retries, replay across isolate evictions).

## Quick orientation

**Tech stack:** Cloudflare Workers · Cloudflare Workflows · TypeScript (strict) · Zod · Biome · `@octokit/rest` · `@octokit/auth-app` · `@octokit/webhooks-methods` · `@cloudflare/vitest-pool-workers`

**Runtime:** workerd via `wrangler dev` locally, production on `*.workers.dev`. All config lives in `wrangler.toml`; secrets via `wrangler secret put` / `.dev.vars`.

**Development loop:**

```bash
npm install
npm run dev          # wrangler dev on :8787 (Miniflare + Workflow emulation)
npm run deploy       # wrangler deploy
npm test             # vitest inside workerd (pool-workers)
npm run test:watch   # same, with hot reload
npm run check        # typecheck + lint + format:check + test
npm run lint         # biome lint --error-on-warnings
npm run format       # biome format --write
npm run typecheck    # tsc --noEmit
```

To regenerate the `Env` type after changing `wrangler.toml`:

```bash
npx wrangler types
```

## Architecture

```
GitHub  ───POST /api/webhooks───▶  Worker (src/main.ts)
                                      │ parse (src/http/parse-webhook-request.ts)
                                      │   ├─ 401 on bad/missing signature
                                      │   └─ 400 on missing event header / invalid JSON
                                      │ route (src/webhooks/github/router.ts)
                                      │   └─ 200 on skip (self-comment, workflow_run success, …)
                                      ▼
                           env.CODER_TASK_WORKFLOW.create({ id, params })
                                      │ 202 Accepted
                                      ▼
                       CoderTaskWorkflow (src/workflows/coder-task-workflow.ts)
                                      │ dispatch on event.type
                                      ▼
                         src/workflows/steps/{create-task, close-task,
                                              comment, failed-check}.ts
                                      │ step.do / step.sleep
                                      ▼
                     CoderService (src/services/coder/service.ts)
                     GitHubClient  (src/services/github/client.ts)
                                      │
                                      ▼
                     Coder REST API · GitHub REST + GraphQL
```

The Worker does ~zero long-running work in the request path: signature verification, routing, and `workflow.create` are all sub-millisecond after the first isolate warms up. Durable processing — retries, waits on Coder task readiness, multi-step flows — all happens inside the Workflow.

## Event → workflow-step mapping

| Trigger | Workflow steps |
|---|---|
| `issues.assigned` | `check-github-permission` → `lookup-coder-user` → `create-coder-task` → `comment-on-issue` |
| `issues.closed` | `delete-coder-task` → `comment-on-issue` |
| `issue_comment` / `pull_request_review_comment` / `pull_request_review` | `locate-task` → `ensureTaskReady` (pre-poll + poll loop) → `send-task-input` → `react-to-comment` |
| `workflow_run.completed` (failure) | `fetch-pr-info` → `find-linked-issues` → `locate-task` → `fetch-failed-jobs` → `fetch-job-logs-<id>` × N → `ensureTaskReady` → `send-task-input` |

### Waiting for Coder tasks

`src/workflows/ensure-task-ready.ts` replaces what used to be a polling loop in a long-running Node server. It's a hand-rolled loop of `step.do("check-status-<n>", …)` + `step.sleep("wait-<n>", "30 seconds")` alternating up to `MAX_ATTEMPTS = 60` (≈ 30 min). Closure state (`nilStateStartAttempt`) tracks consecutive `active + null` observations to match Coder CLI semantics — **mutated only outside step callbacks, derived purely from cached step outputs** (replay-safe). See [spec §4](docs/plans/2026-04-17-cloudflare-workers-migration-design.md) for the full state machine.

## Identity model

Two GitHub identities operate in this system:

- **`@xmtp-coder-agent`** (configured via `AGENT_GITHUB_USERNAME`) — a regular GitHub User with a PAT. Forks repos, pushes code, opens pull requests.
- **App bot `@<app-slug>[bot]`** — the GitHub App installation identity. Posts status comments, reacts to comments. Resolved via `resolveAppBotLogin()` (`src/http/app-bot-login.ts`) on first request per isolate.

Both identities are suppressed in self-comment detection (`src/webhooks/github/guards.ts` — `isIgnoredLogin`): a comment from either never gets forwarded back to the Coder task.

## Key files

<details>
<summary><b>Expand source tree</b></summary>

```
src/
  main.ts                             Worker fetch handler — route + dispatch only
  main.test.ts

  config/
    app-config.ts                     loadConfig(env) — Zod-validated, error messages never contain secret values
    app-config.test.ts
    handler-config.ts                 HandlerConfig type passed to step factories

  events/
    types.ts                          Event discriminated union (TaskRequested / TaskClosed / CommentPosted / CheckFailed)

  http/
    app-bot-login.ts                  resolveAppBotLogin — cache + GET /app fetch
    parse-webhook-request.ts          parseWebhookRequest + typed errors (401 / 400)
    parse-webhook-request.test.ts

  infra/
    logger.ts                         console.log({...}) JSON logger (Cloudflare Workers Logs native) + TestLogger
    logger.test.ts

  services/
    task-runner.ts                    TaskRunner interface + branded TaskId / TaskName / Task types
    coder/
      service.ts                      CoderService (HTTP primitives — no polling; the workflow orchestrates)
      schemas.ts                      Zod schemas for Coder experimental tasks API
      errors.ts                       CoderAPIError
    github/
      client.ts                       GitHubClient (Octokit REST + GraphQL wrappers)
      types.ts

  webhooks/
    github/
      router.ts                       WebhookRouter — classifies, evaluates guards, produces Event or SkipResult
      guards.ts                       isAssigneeAgent, isPrAuthoredByAgent, isWorkflowFailure, isIgnoredLogin, …
      payload-types.ts                Narrow types for the GitHub webhook payloads we actually use

  workflows/
    coder-task-workflow.ts            CoderTaskWorkflow (WorkflowEntrypoint) — dispatches on event.type
    instance-id.ts                    buildInstanceId + isDuplicateInstanceError
    ensure-task-ready.ts              The step.sleep-based wait-for-idle loop
    steps/
      create-task.ts                  task_requested flow
      close-task.ts                   task_closed flow
      comment.ts                      comment_posted (PR + issue)
      failed-check.ts                 check_failed flow (linearized inside one instance)

  actions/                            Pure helpers — no class state
    task-naming.ts                    generateTaskName({prefix, repo, issueNumber}) → TaskName (branded)
    messages.ts                       formatPRCommentMessage / formatIssueCommentMessage / formatFailedCheckMessage

  testing/
    workflow-test-helpers.ts          buildSignedWebhookRequest, computeSignature
    helpers.ts                        MockTaskRunner, createMockGitHubClient, fixtures
    integration.test.ts               HTTP-surface status-code coverage (200 / 202 / 400 / 401 / 404 / 500)
    e2e.test.ts                       Signed webhook → worker → real env.CODER_TASK_WORKFLOW → instance.waitForStatus("complete")
    fixtures/                         Real GitHub webhook payload JSON (anonymized)
```

</details>

## Conventions

<details>
<summary><b>Deterministic task naming</b></summary>

Tasks are named `{prefix}-{repo}-{issueNumber}` (e.g. `gh-myrepo-42`). Use `generateTaskName()` from `src/actions/task-naming.ts` — never construct names manually. This is what lets any handler locate the correct task from just the repo name and issue number.

</details>

<details>
<summary><b>Branded types</b></summary>

`TaskId` and `TaskName` are Zod-branded in `src/services/task-runner.ts`. Produce them via `TaskNameSchema.parse(str)` / `TaskIdSchema.parse(uuid)` — never cast with `as`. (Arch check used to enforce this; the discipline is now convention-only.)

</details>

<details>
<summary><b>Step callback serialization (EARS-REQ-16a)</b></summary>

Every `step.do` callback returns plain JSON-serializable data — primitives, plain objects, or arrays of serializables. **Never return class instances** (Octokit, CoderService, GitHubClient), raw SDK response objects, `Request`/`Response`, or objects with methods. The Workflow engine throws on attempted persistence of non-structured-cloneable values.

When an external API call yields a rich object, extract the scalars you need into a plain object:

```ts
const summary = await step.do("fetch-pr-info", async () => {
  const pr = await github.getPR(owner, repo, number);
  return {
    number: pr.number,
    authorLogin: pr.user.login,
    headSha: pr.head.sha,
  };
});
```

</details>

<details>
<summary><b>Closure state in run() (EARS-REQ-16b)</b></summary>

The Workflow engine replays `run()` from the top on every resume. Completed `step.do` calls return their cached outputs; the function body between them re-executes. This is why:

1. Closure state **must not** be mutated inside a `step.do` callback — the callback doesn't re-execute on replay, so the mutation wouldn't happen again.
2. Closure state **must not** depend on `Date.now()`, `Math.random()`, or cross-request globals — replay sees different values.

Under those rules, closure state derived purely from cached step outputs is safe (see `ensure-task-ready.ts` `nilStateStartAttempt`). Anything that violates them is a latent correctness bug that only manifests after hibernation.

</details>

<details>
<summary><b>Signature verification before anything else</b></summary>

`parseWebhookRequest` verifies the HMAC-SHA256 signature via `@octokit/webhooks-methods#verify` (timing-safe) before reading headers or parsing JSON. The stage ordering is tested in `src/http/parse-webhook-request.test.ts` — unauthenticated callers get 401 without the parser ever revealing information about the body shape.

</details>

<details>
<summary><b>Dependency injection</b></summary>

Every step factory takes `{ step, coder, github, config, event }`. The workflow class (`CoderTaskWorkflow.run`) constructs clients once at the top of `run()` and passes them through. Tests swap in fakes without patching globals.

</details>

## Testing

All tests run inside `workerd` via `@cloudflare/vitest-pool-workers`. `vitest.config.ts` points at `wrangler.toml` for binding declarations and adds test-only secrets via `miniflare.bindings`.

<details>
<summary><b>Test layers</b></summary>

- **Unit** — each primitive/module has `*.test.ts` colocated (`parse-webhook-request.test.ts`, `ensure-task-ready.test.ts`, `instance-id.test.ts`, step-factory tests in `workflows/steps/`).
- **Integration** — `src/testing/integration.test.ts` exercises the full HTTP surface (signature verification, routing, workflow.create stubbing) with response-status assertions.
- **End-to-end** — `src/testing/e2e.test.ts` uses `introspectWorkflow` from `cloudflare:test` to drive a real workflow instance through signed-webhook → fetch handler → `instance.waitForStatus("complete")`.

</details>

<details>
<summary><b>Workflow introspection pattern</b></summary>

```ts
import { env, introspectWorkflowInstance } from "cloudflare:test";

test("task_requested runs to completion", async () => {
  await using instance = await introspectWorkflowInstance(
    env.CODER_TASK_WORKFLOW,
    "my-instance-id",
  );
  await instance.modify(async (m) => {
    await m.disableSleeps();
    await m.mockStepResult({ name: "lookup-coder-user" }, "coder-user");
    await m.mockStepResult({ name: "check-github-permission" }, true);
    // …
  });
  await env.CODER_TASK_WORKFLOW.create({ id: "my-instance-id", params: {…} });
  await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
});
```

**Always use `await using`** (or explicit `dispose()`) so introspector state doesn't leak across tests.

**Known limitation:** `mockStepResult` with falsy values (`false`, `null`) is treated by miniflare as "no mock set" — the callback runs for real. Tests that need to exercise early-return branches driven by falsy step outputs use unit-level fakes (`src/workflows/steps/*.test.ts`) instead.

</details>

<details>
<summary><b>Mocking outbound fetch</b></summary>

Pool-workers doesn't ship a built-in fetch mock. For tests that can't drive behavior purely through `mockStepResult`, override `globalThis.fetch` in a `beforeEach` — global mocks apply to the worker-under-test because it runs in the same isolate as the test.

</details>

## Operational notes

<details>
<summary><b>Instance ID scheme + dedupe</b></summary>

`buildInstanceId(event, deliveryId)` produces `{eventType}-{repo}-{issueOrPr}-{deliveryId}`, sanitized to the Workflow instance charset `[a-zA-Z0-9_-]{1,64}`. GitHub retries with the same `X-GitHub-Delivery` collapse to the same instance — `WORKFLOW.create()` throws "already exists", which the Worker catches via `isDuplicateInstanceError` and returns 200 for.

</details>

<details>
<summary><b>Uncaught workflow errors</b></summary>

We intentionally do NOT wrap the top-level dispatch `switch` in a catch-all. An uncaught exception transitions the instance to `errored` state, which surfaces in `wrangler workflows instances list` and Workers Logs. An operator can `instance.restart()` after fixing the underlying fault. Silent recovery would hide real production issues.

</details>

<details>
<summary><b>Workflows binding rename</b></summary>

If `CODER_TASK_WORKFLOW` is ever renamed in `wrangler.toml`, in-flight instances bound to the old name will be orphaned. Use [`migrateWorkflowBinding()`](https://developers.cloudflare.com/agents/api-reference/run-workflows/) as a dedicated step — don't bundle it with other changes.

</details>

<details>
<summary><b>Local webhook testing</b></summary>

`wrangler dev` binds the Worker locally on :8787. GitHub can't reach localhost, so pipe a public URL:

```bash
npx cloudflared tunnel --url http://localhost:8787
# Point the GitHub App webhook URL at the trycloudflare.com URL that prints.
```

Workflows are not supported as remote bindings, so `wrangler dev --remote` will not work for this project.

</details>

## Reference

- [Migration design doc](docs/plans/2026-04-17-cloudflare-workers-migration-design.md) — architecture, EARS requirements, state machines
- [Task list](docs/plans/2026-04-18-cloudflare-workers-migration-tasks.md) — requirement coverage matrix
- [GitHub App setup](docs/github-app-setup.md) — registration, installation, secrets
- [Coder API endpoints](docs/coder-api.md) — experimental tasks + stable endpoints we consume
- [Adding a new mode](docs/adding-a-new-mode.md) — pattern for adding a new event-type handler
