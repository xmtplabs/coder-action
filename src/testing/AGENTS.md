# src/testing — agent rules

Shared test utilities + integration/e2e test suites.

## Every workflow introspector must be disposed

```ts
// ✅ await using disposes automatically at scope end
await using introspector = await introspectWorkflow(env.CODER_TASK_WORKFLOW);

// ✅ Explicit dispose also works
const introspector = await introspectWorkflow(env.CODER_TASK_WORKFLOW);
try { /* ... */ } finally { await introspector.dispose(); }
```

Forgetting either leaks storage into the next test — an instance that completed in this test will already be marked complete at the start of the next.

## Void-return step mocks use `{}`, not `null`/`undefined`

Miniflare's `mockStepResult` treats falsy values as "no mock set" — the real callback runs, hits live APIs, and probably times out. For steps that return `undefined` in production, mock with `{}`.

## Integration vs. e2e tests

- **`integration.test.ts`** — stubs `env.CODER_TASK_WORKFLOW` to assert HTTP status paths (200/202/400/401/404/500). Workflow never actually runs.
- **`e2e.test.ts`** — uses the real `env.CODER_TASK_WORKFLOW` binding + `introspectWorkflow` to drive a full signed-webhook → completed-workflow pipeline. Exactly one test per event type; happy paths only.

Pick integration for status-code coverage, e2e for "does the full pipeline actually wire up."

## The `Env` type gap

`wrangler types` generates `Cloudflare.Env` from `wrangler.toml`'s `[vars]` only — not from `miniflare.bindings` in `vitest.config.ts`. Tests that read injected secrets must cast:

```ts
const testEnv = env as typeof env & {
  APP_ID: string; PRIVATE_KEY: string; WEBHOOK_SECRET: string; CODER_TOKEN: string;
};
```

Don't try to extend `Cloudflare.Env` in a `.d.ts` — the binding shape is regenerated on every `wrangler types` call.

## Fixture factories over inline mocks

For tests with repeated client-stub boilerplate, extract `makeCoder` / `makeGithub` / `makeEvent` factories with `Partial<...>` overrides. `src/workflows/steps/comment.test.ts` is the reference pattern. Keeps each test focused on the one thing it's asserting.

## Bot-login cache must be pre-seeded

Integration + e2e tests call `__setAppBotLoginForTests("xmtp-coder-tasks[bot]")` in `beforeEach`. Without it, the handler calls `GET /app` with the fake private key and fails. Every test file that invokes `worker.fetch` needs this setup.
