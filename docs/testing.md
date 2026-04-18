# Testing

All tests run inside `workerd` via `@cloudflare/vitest-pool-workers`. `vitest.config.ts` points at `wrangler.toml` for binding declarations and injects test-only secrets (`APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET`, `CODER_TOKEN`) via `miniflare.bindings` so no `.dev.vars` is required in CI.

```bash
npm test             # one-shot
npm run test:watch   # hot reload
```

## Three test layers

| Layer | Lives in | What it covers |
|---|---|---|
| **Unit** | Colocated `*.test.ts` next to source | Pure helpers, step factories with fake `step`, parsers, guards, routers. Fast. No workflow engine. |
| **HTTP integration** | `src/testing/integration.test.ts` | Full worker fetch handler with the workflow binding stubbed. Exercises every HTTP status code path (200/202/400/401/404/500). |
| **End-to-end** | `src/testing/e2e.test.ts` | Signed webhook → real `env.CODER_TASK_WORKFLOW` → introspected instance → `waitForStatus("complete")`. The only tests that drive a real workflow instance from the fetch handler. |

## Workflow introspection pattern

Use for tests that need to drive a real Workflow instance through its step sequence. Every step result and sleep is mocked; no live Coder/GitHub calls fire.

```ts
import { env, introspectWorkflowInstance } from "cloudflare:test";

test("task_requested runs to completion", async () => {
  // 1. Register the introspector BEFORE creating the instance.
  await using instance = await introspectWorkflowInstance(
    env.CODER_TASK_WORKFLOW,
    "my-instance-id",
  );

  // 2. Register mocks.
  await instance.modify(async (m) => {
    await m.disableSleeps();
    await m.mockStepResult({ name: "check-github-permission" }, true);
    await m.mockStepResult({ name: "lookup-coder-user" }, "coder-user");
    await m.mockStepResult({ name: "create-coder-task" }, {
      taskName: "gh-repo-1", owner: "coder-user", taskId: "uuid",
      status: "ready", url: "https://coder/t",
    });
    await m.mockStepResult({ name: "comment-on-issue" }, {});  // void → {}, not null
  });

  // 3. Create the instance.
  await env.CODER_TASK_WORKFLOW.create({ id: "my-instance-id", params: {...} });

  // 4. Assert terminal status.
  await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
});
```

**Always use `await using`** (or explicit `dispose()`). See [gotchas.md](gotchas.md#test-isolation-with-await-using).

**Always `disableSleeps()`** unless you specifically want to exercise timing. Without it, `step.sleep("wait-N", "30 seconds")` actually waits 30 seconds and your test times out.

**For void returns use `{}`, not `null` or `undefined`.** Miniflare treats falsy values as "no mock set" — see [gotchas.md](gotchas.md#mockstepresult-with-falsy-values-is-treated-as-no-mock-set).

**For tests where instance IDs are unknown ahead of time** (e.g. the webhook handler creates them with a composite ID), use `introspectWorkflow(env.CODER_TASK_WORKFLOW)` instead and call `introspector.modifyAll(...)`. See `src/testing/e2e.test.ts`.

## Fake `WorkflowStep` for step-factory unit tests

Step factories don't need the real Workflow engine to be tested. `src/workflows/steps/*.test.ts` all use the same fake:

```ts
function makeStep() {
  const calls: string[] = [];
  return {
    calls,
    do: vi.fn(async (name: string, ...rest: unknown[]) => {
      calls.push(name);
      const fn = rest[rest.length - 1] as () => Promise<unknown>;
      return fn();  // execute the callback inline
    }),
    sleep: vi.fn(async () => {}),
  };
}
```

This is strictly faster than introspection-based tests and covers branches that falsy-mock limitations block at the engine layer (permission=false early-return, PR-not-found early-return).

Use `step.calls` to assert step ordering:

```ts
expect(step.calls).toEqual(["check-github-permission", "lookup-coder-user", "create-coder-task", "comment-on-issue"]);
```

Use `step.do.mock.results[idx].value` to assert step *return values* (serialization rule guard):

```ts
const idx = step.do.mock.calls.findIndex(c => c[0] === "create-coder-task");
const result = await step.do.mock.results[idx].value;
expect(result).toEqual({ taskName: "gh-repo-1", owner: "...", taskId: "...", url: "...", status: "..." });
// toEqual catches raw-SDK-field leakage; toHaveProperty does not.
```

## Fixture factories

For tests with shared mock-client boilerplate (e.g. `comment.test.ts` has four runs with near-identical `coder` / `github` stubs), extract `makeCoder` / `makeGithub` / `makeEvent` factories with `Partial<...>` overrides. The factories let each test focus on the one thing it's asserting. See `src/workflows/steps/comment.test.ts` for the canonical pattern.

## Outbound-fetch mocking

`@cloudflare/vitest-pool-workers` doesn't ship a built-in fetch mock. Two workable patterns:

1. **Drive behavior through `mockStepResult`** (preferred). Every external API call in our codebase happens inside a `step.do`, so mocking the step output is equivalent to mocking the fetch. Both the HTTP-surface integration tests and the e2e tests use this.

2. **Override `globalThis.fetch`** in `beforeEach`. Global mocks apply because the worker-under-test runs in the same isolate as the test. Use when you need to assert on the request shape (URL, body, headers):

   ```ts
   beforeEach(() => {
     vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
       if (String(url).includes("api.github.com")) return new Response("{}", { status: 200 });
       throw new Error(`Unexpected fetch: ${url}`);
     });
   });
   ```

## Integration vs. e2e env

- Integration tests (`src/testing/integration.test.ts`) use a **stub** `env.CODER_TASK_WORKFLOW` — a plain object with a `create` method. This lets each test control the workflow-create outcome (resolve with id, reject with "already exists", reject with generic error) to exercise response-status paths.

- E2E tests (`src/testing/e2e.test.ts`) use the **real** `env` from `cloudflare:test`, which includes the actual Workflow binding. Paired with `introspectWorkflow`, this drives the real workflow through to completion.

When adding a test, pick based on what you're asserting:
- Response status codes → integration.
- Workflow completion → e2e.
- Step factory internals → unit.

## Structured-message assertions

When asserting that `sendTaskInput` receives the structured `[INSTRUCTIONS]` / `[COMMENT]` wrapper (not raw body), destructure the mock call carefully — vitest types the calls tuple as `unknown[]`:

```ts
expect(coder.sendTaskInput).toHaveBeenCalledTimes(1);
const call = coder.sendTaskInput.mock.calls[0] as unknown as [unknown, unknown, string];
const body = call[2];
expect(body).toContain("New Comment on PR:");
expect(body).toContain("File: src/foo.ts:7");
```

## The `Env` type gap

`wrangler types` generates `Cloudflare.Env` from `[vars]` only — not from `miniflare.bindings`. Tests that need `env.WEBHOOK_SECRET` (a secret) must cast:

```ts
const testEnv = env as typeof env & { WEBHOOK_SECRET: string; APP_ID: string; PRIVATE_KEY: string; CODER_TOKEN: string };
```

See `src/testing/e2e.test.ts` for the canonical pattern.

## Test-only export in production code

`src/main.ts` exports `__setAppBotLoginForTests` to pre-seed the bot-login module cache (avoids a live `GET /app` call in integration tests). The underscored prefix flags it as test-only. If you ever add a similar seam, follow the same naming pattern — and remember it's technically reachable at runtime (Workers exports are immutable), so never put security-sensitive logic behind an underscore name.
