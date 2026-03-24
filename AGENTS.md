# AGENTS.md — coder-action

GitHub App webhook server that manages the full lifecycle of Coder AI tasks driven by GitHub events. The app receives webhook payloads from GitHub, routes them to the appropriate handler, and interacts with the Coder API to create, resume, or stop task workspaces.

## Modes

| Mode | Trigger | What it does |
|---|---|---|
| `create_task` | `issues.assigned` — assignee is the coder agent | Creates a Coder task workspace with the issue URL as input |
| `close_task` | `issues.closed` | Stops and deletes the task workspace |
| `pr_comment` | `issue_comment`, `pull_request_review_comment`, or `pull_request_review` on a PR authored by the agent | Forwards the comment as task input |
| `issue_comment` | `issue_comment` on a plain issue | Forwards the comment as task input |
| `failed_check` | `workflow_run` completed with failure | Finds the linked PR/issue and forwards failure details |

**Tech stack**: Bun · TypeScript (strict) · Zod · Biome · Hono · `@octokit/auth-app` · `@octokit/webhooks`

## Architecture

```
GitHub Webhook (POST /api/webhooks)
    ↓
src/server.ts — Hono HTTP server, signature verification
    ↓
src/webhook-router.ts — event routing, guard evaluation, payload extraction
    ↓
src/handlers/{create-task,close-task,pr-comment,issue-comment,failed-check}.ts
    ↓
CoderClient (coder-client.ts)   GitHubClient (github-client.ts)
    ↓                               ↓
Coder REST API                  GitHub REST + GraphQL APIs
```

Every handler receives injected `CoderClient` and `GitHubClient` instances — no globals.

## Key Files

```
src/
  main.ts               Entry point: loads config, authenticates GitHub App, starts Hono server
  server.ts             Hono app with webhook endpoint and health check
  webhook-router.ts     Maps webhook events to handler types with guard evaluation
  webhook-schemas.ts    Zod schemas for all webhook payload types
  config.ts             AppConfig Zod schema, loaded from env vars
  logger.ts             Logger interface with Console and Test implementations
  schemas.ts            HandlerConfig and ActionOutputs types
  coder-client.ts       CoderClient interface + RealCoderClient impl + Zod API schemas
  github-client.ts      GitHubClient wrapping Octokit REST + GraphQL
  task-utils.ts         generateTaskName(), parseIssueURL(), lookupAndEnsureActiveTask()
  messages.ts           Pure functions that build comment/prompt message strings
  test-helpers.ts       MockCoderClient, createMockGitHubClient(), fixtures
  __fixtures__/         Webhook payload JSON fixtures for testing
  handlers/             One handler per event type + one test file per handler
```

## Development Commands

```bash
bun install          # install deps
bun test             # run tests
bun run typecheck    # tsc --noEmit
bun run lint         # Biome lint (fails on warnings)
bun run format       # Biome format (auto-fix)
bun run build        # bundle to dist/server.js
bun run dev          # run with watch mode
bun run start        # run production server
bun run check        # typecheck + lint + format:check + test
```

## Key Conventions

- **Deterministic task naming**: Tasks are named `{prefix}-{repo}-{issueNumber}` (e.g. `gh-myrepo-42`). Use `generateTaskName()` in `task-utils.ts` — never construct names manually.
- **Branded types**: `TaskId` and `TaskName` are Zod-branded. Always produce them via `TaskNameSchema.parse(str)` / `TaskIdSchema.parse(uuid)` — never cast with `as`.
- **Dependency injection**: Every handler takes `(coder, github, config, context)`. Tests swap in mocks without patching globals.
- **Dual identity model**: Two GitHub identities are in play — the agent user and the app bot. Both are suppressed in self-comment detection (see Identity Model below).
- **Webhook signature verification**: All incoming webhook requests are verified using the GitHub App webhook secret before any payload is processed.
- **Per-installation GitHub API tokens**: The app authenticates as the GitHub App installation to obtain short-lived tokens scoped to the target repository.

## Identity Model

Two GitHub identities operate in this system:

- **`@xmtp-coder-agent`** — A regular GitHub User with a Personal Access Token. This identity forks repositories, creates branches, opens pull requests, and pushes code. It is the "agent" that does the actual work.
- **App bot (e.g. `@your-app[bot]`)** — The GitHub App installation identity. This identity posts status comments (task created, task closed, errors), reacts to comments, and performs API operations on behalf of the app.

Both identities are suppressed in self-comment detection: a comment from either `@xmtp-coder-agent` or the app bot will not be forwarded back to the Coder task.

## Testing

```typescript
describe("CreateTaskHandler", () => {
  let coder: MockCoderClient;
  let gh: ReturnType<typeof createMockGitHubClient>;
  const logger = new TestLogger();

  beforeEach(() => {
    coder = new MockCoderClient();
    gh = createMockGitHubClient();
  });

  test("creates task and comments on issue", async () => {
    const handler = new CreateTaskHandler(coder, gh, config, context, logger);
    const result = await handler.run();
    expect(result.skipped).toBe(false);
  });
});
```

Use `mockTask`, `mockTemplate`, `mockPreset`, `mockStoppedTask`, `mockErrorTask` from `test-helpers.ts` rather than constructing objects inline.

## Reference

- [GitHub App setup](docs/github-app-setup.md)
- [Coder API endpoints](docs/coder-api.md)
