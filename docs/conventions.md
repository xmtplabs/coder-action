# Conventions (app-wide)

Patterns that apply across every folder. Folder-scoped rules live next to the
code they govern — see the `AGENTS.md` file in each `src/*` subdirectory:

- [`src/workflows/AGENTS.md`](../src/workflows/AGENTS.md) — workflow + step-factory rules
- [`src/services/coder/AGENTS.md`](../src/services/coder/AGENTS.md) — Coder API client
- [`src/http/AGENTS.md`](../src/http/AGENTS.md) — webhook request parsing + app-bot login
- [`src/webhooks/github/AGENTS.md`](../src/webhooks/github/AGENTS.md) — event routing + guards
- [`src/testing/AGENTS.md`](../src/testing/AGENTS.md) — integration + e2e test conventions

## Branded types

`TaskId` and `TaskName` are Zod-branded types declared in `src/services/task-runner.ts`. Produce them via:

```ts
const taskName = TaskNameSchema.parse(raw);
const taskId   = TaskIdSchema.parse(raw);  // UUID
```

Never cast with `as TaskName` / `as TaskId` — the brand has no runtime representation, and a bad cast will produce a corrupt value that passes all type checks.

## Logger

`src/infra/logger.ts` exports `createLogger` (production) and `TestLogger` (tests). Log structured objects:

```ts
logger.info("Webhook received", { deliveryId, eventName });
// emits: console.log(JSON.stringify({level: "info", msg: "Webhook received", deliveryId, eventName, ...bindings}))
```

Workers Logs ingests stdout JSON natively; every field becomes an indexed queryable dimension. Don't interpolate structured values into the `msg` string (`` `user ${id} logged in` ``) — the dashboard can't filter on them.

`TestLogger` captures `.messages` for assertion. Never invent a local `noopLogger` — accept an optional `logger` parameter and default it to a single shared no-op if omitted. *(There is one historical inline `noopLogger` in `src/services/coder/service.ts` that should migrate — see [gotchas.md](gotchas.md#inline-nooplogger-in-coderservice).)*

## Secrets handling

- `wrangler.toml` `[vars]` — non-secret config only (repo URLs, prefixes, template names).
- `wrangler secret put` (production) / `.dev.vars` (local) — `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET`, `CODER_TOKEN`.
- `loadConfig()` error messages use `issue.path` + `issue.message` from Zod; they **never** include raw values. Keep that invariant if you edit the loader.
- `.dev.vars` is gitignored via `.gitignore`. `.dev.vars.example` is committed as a template.
