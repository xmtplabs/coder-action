# AGENTS.md — coder-action

GitHub Action that manages the full lifecycle of Coder AI tasks driven by GitHub events. See [`action.yml`](action.yml) for all inputs/outputs.

## Modes (`action` input)

| Mode | Trigger | What it does |
|---|---|---|
| `create_task` | Issue assigned to coder agent | Creates a Coder task workspace with the issue URL as input |
| `close_task` | Issue closed | Stops and deletes the task workspace |
| `pr_comment` | Comment on a PR authored by the agent | Forwards the comment as task input |
| `issue_comment` | Comment on an issue | Forwards the comment as task input |
| `failed_check` | CI workflow fails | Finds the linked PR/issue and forwards failure details |

**Tech stack**: Bun · TypeScript (strict) · Zod · Biome · `@actions/core` · `@actions/github`

## Architecture

```
GitHub Event
    ↓
src/index.ts  — reads inputs, validates via parseInputs(), builds clients, dispatches
    ↓
src/handlers/{create-task,close-task,pr-comment,issue-comment,failed-check}.ts
    ↓
CoderClient (coder-client.ts)   GitHubClient (github-client.ts)
    ↓
Coder REST API                  GitHub REST + GraphQL APIs
```

Every handler receives injected `CoderClient` and `GitHubClient` instances — no globals.

## Key Files

```
src/
  index.ts          Entry point: parses inputs, builds clients, switch-dispatches to handlers
  schemas.ts        Zod discriminated union for ActionInputs; ActionOutputs type
  coder-client.ts   CoderClient interface + RealCoderClient impl + Zod API schemas
  github-client.ts  GitHubClient wrapping Octokit REST + GraphQL
  task-utils.ts     generateTaskName(), parseIssueURL(), lookupAndEnsureActiveTask()
  messages.ts       Pure functions that build comment/prompt message strings
  test-helpers.ts   MockCoderClient, createMockGitHubClient(), mock task/template data
  handlers/         One file per mode + one test file per handler
```

## Development Commands

```bash
bun install          # install deps
bun test             # run tests
bun run typecheck    # tsc --noEmit
bun run lint         # Biome lint (fails on warnings)
bun run format       # Biome format (auto-fix)
bun run build        # bundle to dist/index.js (must be committed)
bun run check        # typecheck + lint + format:check + test
```

`dist/index.js` must be committed — GitHub Actions runs it directly at `node20` runtime.

## Key Conventions

- **Deterministic task naming**: Tasks are named `{prefix}-{repo}-{issueNumber}` (e.g. `gh-myrepo-42`). Use `generateTaskName()` in `task-utils.ts` — never construct names manually.
- **Branded types**: `TaskId` and `TaskName` are Zod-branded. Always produce them via `TaskNameSchema.parse(str)` / `TaskIdSchema.parse(uuid)` — never cast with `as`.
- **Dependency injection**: Every handler takes `(coder, github, inputs, context)`. Tests swap in mocks without patching globals.

## Testing

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
  });
});
```

Use `mockTask`, `mockTemplate`, `mockPreset`, `mockStoppedTask`, `mockErrorTask` from `test-helpers.ts` rather than constructing objects inline.

## Reference

- [Coder API endpoints](docs/coder-api.md)
- [Adding a new mode](docs/adding-a-new-mode.md)
