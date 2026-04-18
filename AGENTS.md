# AGENTS.md — coder-action

Cloudflare Worker + single Cloudflare Workflow that drives Coder AI task lifecycle from GitHub webhooks. The Worker signature-verifies and classifies each webhook, then enqueues a `CoderTaskWorkflow` instance that talks to the Coder and GitHub APIs durably (step-level retries, replay across isolate evictions).

**Tech stack:** Cloudflare Workers · Cloudflare Workflows · TypeScript (strict) · Zod · Biome · `@octokit/rest` · `@octokit/auth-app` · `@octokit/webhooks-methods` · `@cloudflare/vitest-pool-workers`

## Development loop

```bash
npm install
npm run dev          # wrangler dev on :8787 (Miniflare + Workflow emulation)
npm run deploy       # wrangler deploy
npm test             # vitest inside workerd (pool-workers)
npm run check        # typecheck + lint + format:check + test
```

After changing `wrangler.toml`, regenerate binding types: `npx wrangler types`.

## Architecture

```
GitHub  ───POST /api/webhooks───▶  Worker (src/main.ts)
                                      │ parseWebhookRequest → verify sig + parse
                                      │   (401 bad sig · 400 missing header/JSON)
                                      │ WebhookRouter → classify + guards
                                      │   (200 skip for self-comments, workflow_run success, …)
                                      ▼
                           env.CODER_TASK_WORKFLOW.create({ id, params })
                                      │  202 Accepted
                                      ▼
                       CoderTaskWorkflow (src/workflows/coder-task-workflow.ts)
                                      │  dispatch on event.type
                                      ▼
                         src/workflows/steps/{create-task, close-task,
                                              comment, failed-check}.ts
                                      │  step.do / step.sleep
                                      ▼
                     CoderService · GitHubClient (subrequests)
```

Worker does no long-running work in the request path; durable processing — retries, waits on Coder task readiness, multi-step flows — all happens inside the Workflow.

## Event → workflow-step mapping

| Trigger | Workflow steps |
|---|---|
| `issues.assigned` | `check-github-permission` → `lookup-coder-user` → `create-coder-task` → `comment-on-issue` |
| `issues.closed` | `delete-coder-task` → `comment-on-issue` |
| `issue_comment` on an issue | `locate-task` → `ensureTaskReady` → `send-task-input` → `react-to-comment` |
| `issue_comment` / `pull_request_review_comment` / `pull_request_review` on an agent PR | `find-linked-issues` → `locate-task` → `ensureTaskReady` → `send-task-input` → `react-to-comment` |
| `workflow_run.completed` (failure) | `fetch-pr-info` → `find-linked-issues` → `locate-task` → `fetch-failed-jobs` → `fetch-job-logs-<id>` × N → `ensureTaskReady` → `send-task-input` |

## Key files

```
src/
  main.ts                             Worker fetch handler — route + dispatch only
  http/
    parse-webhook-request.ts          Sig verify + header/JSON parse, typed errors
    app-bot-login.ts                  App bot login cache + GET /app resolver
  config/app-config.ts                loadConfig(env) — Zod-validated, no secret leakage
  events/types.ts                     Event discriminated union
  infra/logger.ts                     console.log({...}) JSON logger + TestLogger
  services/
    task-runner.ts                    TaskRunner interface + branded Task types
    coder/service.ts                  HTTP primitives (no polling — workflow orchestrates)
    github/client.ts                  Octokit REST + GraphQL wrappers
  webhooks/github/
    router.ts                         Event classification + guards → Event | SkipResult
    guards.ts                         Self-comment suppression, author checks, …
  workflows/
    coder-task-workflow.ts            WorkflowEntrypoint — dispatches on event.type
    instance-id.ts                    buildInstanceId + isDuplicateInstanceError
    ensure-task-ready.ts              step.sleep-based wait-for-idle loop
    steps/{create-task,close-task,comment,failed-check}.ts
  actions/                            Pure helpers (task naming, message formatting)
  testing/                            MockTaskRunner, integration.test.ts, e2e.test.ts
```

## Identity model

Two GitHub identities:

- **`@xmtp-coder-agent`** (configurable via `AGENT_GITHUB_USERNAME`) — regular GitHub User with a PAT; forks repos, pushes code, opens PRs.
- **App bot `@<app-slug>[bot]`** — GitHub App installation identity; posts status comments, reacts. Resolved via `resolveAppBotLogin()` on first request per isolate.

Both identities are suppressed in self-comment detection (`src/webhooks/github/guards.ts#isIgnoredLogin`) — a comment from either never gets forwarded back to the Coder task.

## Conventions and patterns (required reading)

- **[docs/conventions.md](docs/conventions.md)** — mandatory patterns: task naming, branded types, step-callback serialization rule, closure-state rule in `run()`, DI model, logger usage. Break these and things silently corrupt on replay.
- **[docs/gotchas.md](docs/gotchas.md)** — collected foot-guns with context. Read before making non-trivial changes. Examples: PR number vs. issue number in task keys, `mockStepResult` + falsy values, `failed` is terminal-ready in Coder semantics, step-name uniqueness per instance.
- **[docs/testing.md](docs/testing.md)** — test layers, `introspectWorkflow` patterns, fetch-mocking options, miniflare quirks.

## How to extend

- **[docs/adding-an-event-type.md](docs/adding-an-event-type.md)** — checklist for wiring a new GitHub event into the router + a new step factory + tests.

## Reference

- [GitHub App setup](docs/github-app-setup.md) — registration, installation, secrets
- [Coder API endpoints](docs/coder-api.md) — experimental tasks + stable endpoints we consume
