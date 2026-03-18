# AGENTS.md — Developer Guide for xmtp/coder-action

## Project Overview

**Purpose**: GitHub Action that manages the full lifecycle of Coder AI tasks driven by GitHub events.

**Five modes (`action` input)**:
| Mode | Trigger | What it does |
|---|---|---|
| `create_task` | Issue assigned to coder agent | Creates a Coder task workspace with the issue URL as input |
| `close_task` | Issue closed | Stops and deletes the task workspace |
| `pr_comment` | Comment on a PR authored by the agent | Forwards the comment as task input |
| `issue_comment` | Comment on an issue | Forwards the comment as task input |
| `failed_check` | CI workflow fails | Finds the linked PR/issue and forwards failure details |

**Tech stack**: Bun · TypeScript (strict) · Zod · Biome · `@actions/core` · `@actions/github`

---

## Architecture

```
GitHub Event
    ↓
src/index.ts  — reads inputs, validates via parseInputs(), builds clients, dispatches
    ↓
switch (inputs.action)
    ↓
handlers/{create-task,close-task,pr-comment,issue-comment,failed-check}.ts
    ↓
CoderClient (coder-client.ts)   GitHubClient (github-client.ts)
    ↓
Coder REST API                  GitHub REST + GraphQL APIs
```

All handlers receive injected `CoderClient` and `GitHubClient` instances — no globals, no direct `fetch` calls outside `RealCoderClient`.

---

## File Guide

```
src/
  index.ts              Entry point: parses inputs, builds clients, switch-dispatches to handlers
  schemas.ts            Zod discriminated union for ActionInputs; ActionOutputs type
  coder-client.ts       CoderClient interface + RealCoderClient impl + Zod API schemas + CoderAPIError
  github-client.ts      GitHubClient wrapping Octokit REST + GraphQL
  task-utils.ts         generateTaskName(), parseIssueURL(), lookupAndEnsureActiveTask()
  messages.ts           Pure functions that build comment/prompt message strings
  test-helpers.ts       MockCoderClient, createMockGitHubClient(), mock task/template data

  handlers/
    create-task.ts      Validates org membership, creates or finds existing task, comments on issue
    close-task.ts       Looks up task by name, stops then deletes the workspace
    pr-comment.ts       Resolves PR author and linked issue, forwards comment as task input
    issue-comment.ts    Finds active task for the issue, forwards comment as task input
    failed-check.ts     Fetches failed job logs, resolves linked issue, sends summary to task

  *.test.ts             One test file per source file, using Bun's built-in test runner
```

---

## Key Design Decisions

### Deterministic task naming

Tasks are named `{prefix}-{repo}-{issueNumber}` (e.g. `gh-myrepo-42`). This lets any handler look up the task for an issue without storing external state. `generateTaskName()` in `task-utils.ts` is the single source of truth.

### Branded types

`TaskId` and `TaskName` are Zod-branded string types. The compiler rejects passing a raw string where a `TaskName` is expected. Always produce them via `TaskNameSchema.parse(str)` or `TaskIdSchema.parse(uuid)` — never cast with `as`.

### Dependency injection

Every handler takes `(coder: CoderClient, github: GitHubClient, inputs, context)` in its constructor. Tests swap in `MockCoderClient` / `createMockGitHubClient()` without patching globals.

### Zod validation at boundaries

- Action inputs are validated by `parseInputs()` before any handler runs.
- Every Coder API response is validated by its schema in `coder-client.ts`.
- This means TypeScript types are trustworthy throughout — no `any` leakage from external data.

### Mode dispatch pattern

`index.ts` is a thin router: read inputs → validate → build clients → `switch(inputs.action)`. Handlers own all business logic. Adding a mode means touching the switch, not refactoring existing handlers.

---

## Development Workflow

```bash
bun install          # install deps
bun test             # run 75 tests
bun run typecheck    # tsc --noEmit
bun run lint         # Biome lint (fails on warnings)
bun run format       # Biome format (auto-fix)
bun run format:check # Biome format (check only, used in CI)
bun run build        # bundle to dist/index.js (commit this)
bun run check        # typecheck + lint + format:check + test in one shot
```

`dist/index.js` must be committed — GitHub Actions runs it directly at `node20` runtime.

---

## Testing Patterns

**MockCoderClient** (`test-helpers.ts`): Implements the `CoderClient` interface with `bun:test` mocks. Every method is a `mock()` returning a sensible default. Override per-test with `.mockImplementationOnce()`.

**createMockGitHubClient()** returns an object where every `GitHubClient` method is a `mock()`. Cast it to `GitHubClient` via `as unknown as GitHubClient`.

**Mock data factories**: Use the exported constants (`mockTask`, `mockTemplate`, `mockPreset`, `mockStoppedTask`, `mockErrorTask`) rather than constructing objects inline — they satisfy branded-type constraints because they were created via `.parse()`.

**Handler test structure**:
```typescript
describe("CreateTaskHandler", () => {
  let coder: MockCoderClient;
  let gh: ReturnType<typeof createMockGitHubClient>;

  beforeEach(() => {
    coder = new MockCoderClient();
    gh = createMockGitHubClient();
  });

  test("creates task and comments on issue", async () => {
    const handler = new CreateTaskHandler(coder, gh as unknown as GitHubClient, inputs, context);
    const result = await handler.run();
    expect(result.skipped).toBe(false);
    expect(coder.createTask).toHaveBeenCalledTimes(1);
  });
});
```

---

## Adding a New Mode

1. **`src/schemas.ts`** — Add a new `z.object({ action: z.literal("new_mode"), ... })` schema to the discriminated union and export its type.
2. **`src/handlers/new-mode.ts`** — Create handler class with `constructor(coder, github, inputs, context)` and `run(): Promise<ActionOutputs>`.
3. **`src/handlers/new-mode.test.ts`** — Cover happy path and key error paths.
4. **`src/index.ts`** — Add `case "new_mode":` to the switch, extract the relevant payload fields, instantiate and call the handler.
5. **`action.yml`** — Document the new value in the `action` input description; add any new inputs/outputs.
6. **Rebuild** — `bun run build` and commit `dist/index.js`.

---

## API Reference

### Coder experimental tasks endpoints

| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/experimental/tasks?q=owner:{username}` | List tasks; no dedicated single-lookup endpoint yet |
| `POST` | `/api/experimental/tasks/{owner}` | Create task |
| `GET` | `/api/experimental/tasks/{owner}/{taskId}` | Get task by ID |
| `POST` | `/api/experimental/tasks/{owner}/{taskId}/send` | Send input to task |

### Coder stable endpoints

| Method | Endpoint |
|---|---|
| `GET` | `/api/v2/users?q=github_com_user_id:{id}` |
| `GET` | `/api/v2/organizations/{org}/templates/{name}` |
| `GET` | `/api/v2/templateversions/{id}/presets` |
| `POST` | `/api/v2/workspaces/{id}/builds` (stop/delete via `transition`) |

### GitHub GraphQL — linked issues

`GitHubClient.findLinkedIssues()` uses:
```graphql
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      closingIssuesReferences(first: 10) {
        nodes { number title state url }
      }
    }
  }
}
```

---

## Common Issues

**"Branded type assignability error"** — You passed a plain `string` where `TaskName` or `TaskId` is required. Call `TaskNameSchema.parse(str)` / `TaskIdSchema.parse(uuid)` to produce the correct type.

**"biome lint --error-on-warnings" fails** — Biome treats warnings as errors in this repo. Fix the flagged line; don't add suppression comments unless necessary.

**Tabs vs spaces** — The project uses tab indentation (configured in `biome.json`). If your editor inserts spaces, run `bun run format` before committing.

**`dist/index.js` not updated** — The action runs the committed bundle. Always run `bun run build` after source changes and commit `dist/index.js` together with the source changes.

**`waitForTaskActive` timeout in tests** — The mock returns `Promise.resolve()` immediately. If you see timeout errors in tests, check that `MockCoderClient.waitForTaskActive` hasn't been replaced with a slow implementation.
