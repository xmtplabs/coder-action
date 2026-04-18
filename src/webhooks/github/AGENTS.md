# src/webhooks/github — agent rules

Converts raw GitHub webhook payloads into the app's `Event` discriminated union (or a `SkipResult`). No side effects, no I/O — pure classification.

## Output is always `Event` or `SkipResult`

`WebhookRouter.handleWebhook()` returns one of two shapes:

- **`Event`** — the webhook is actionable; Worker creates a Workflow instance.
- **`SkipResult`** — deliberately not actionable (self-comment, non-assignee, success workflow_run, …). Worker returns 200 with no Workflow.

Never return raw payload data or exceptions. A malformed payload that we can't classify flows to the default `"Unhandled event: <name>.<action>"` SkipResult.

## Self-comment suppression is non-negotiable

Comments from `agentGithubUsername` (the agent user) OR `appBotLogin` (the App bot) are always filtered out via `isIgnoredLogin`. Without this filter, the agent would respond to its own comments in a feedback loop. Both identities are injected into `WebhookRouter`'s constructor; the guard checks both.

If you add a new identity (e.g. a second bot), route it through `isIgnoredLogin`, not through per-handler ad-hoc checks.

## Guards are pure boolean functions

`src/webhooks/github/guards.ts` holds small predicates: `isAssigneeAgent`, `isPrAuthoredByAgent`, `isWorkflowFailure`, `isIgnoredLogin`, `isEmptyReviewBody`. Each one:

- Takes a payload + optional identity args
- Returns `boolean`
- Has no side effects

When adding a new skip condition, add a named guard — don't inline logic in a route handler. Guards are tested in `guards.test.ts`; inline logic isn't.

## Payload shape narrowing uses `as`, not Zod

Router case arms cast with `as IssuesAssignedPayload` etc. and rely on null-checks on sub-fields (`payload.assignee?.login`) rather than running a Zod schema. Trade-off: fast, minimal dependency footprint; the cost is that a malformed payload throws `TypeError` inside the handler rather than a clean 400.

The `SkipResult.validationError` flag exists for a future Zod pass (see `docs/gotchas.md`). Don't add Zod to individual case arms piecemeal — if you need validation, do the whole router at once.

## Installation ID is mandatory for dispatch

`getInstallationId(payload)` returns `0` when `payload.installation.id` is missing or malformed. A returned `Event` with `installationId: 0` is a bug — the workflow can't authenticate. Every case arm must either set a real installation ID or return `SkipResult`.
