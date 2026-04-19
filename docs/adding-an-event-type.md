# Adding a new event type

Checklist for wiring a new GitHub webhook event through router → workflow → step factory → tests. Use `runCloseTask` as the simplest reference (delete + comment).

## 1. Event shape — `src/events/types.ts`

Add a new variant to the `Event` discriminated union:

```ts
export type MyNewEvent = {
  type: "my_new_event";
  source: EventSource;
  repository: { owner: string; name: string };
  // …event-specific fields…
};

export type Event =
  | TaskRequestedEvent
  | TaskClosedEvent
  | CommentPostedEvent
  | CheckFailedEvent
  | MyNewEvent;  // ← add
```

Every field must be plain JSON-serializable (Workflow event payloads are structured-cloned).

## 2. Webhook routing — `src/webhooks/github/router.ts`

Add a `case` to the switch in `handleGithubWebhook` that extracts the fields you need from the GitHub payload and returns the new `Event` variant (or a `SkipResult`). Follow the pattern of `routeIssuesAssigned` / `routePRReviewSubmitted` — cast the payload to the narrow `*Payload` type, run any applicable guards from `src/webhooks/github/guards.ts`, then return.

If you need a new guard (e.g. "PR author is the agent"), add it to `guards.ts` and unit-test in `guards.test.ts`.

## 3. Workflow dispatch — `src/workflows/task-runner-workflow.ts`

Add a `case` to the `switch (payload.type)` in `run()` that calls a new step factory:

```ts
case "my_new_event":
  await runMyNewEvent({ step, coder, github, config, event: payload });
  break;
```

## 4. Step factory — `src/workflows/steps/my-new-event.ts`

Follow the existing factory shape:

```ts
import type { WorkflowStep } from "cloudflare:workers";
import type { AppConfig } from "../../config/app-config";
import type { MyNewEvent } from "../../events/types";
import type { CoderService } from "../../services/coder/service";
import type { GitHubClient } from "../../services/github/client";

export interface RunMyNewEventContext {
  step: WorkflowStep;
  coder: CoderService;
  github: GitHubClient;
  config: AppConfig;
  event: MyNewEvent;
}

export async function runMyNewEvent(ctx: RunMyNewEventContext): Promise<void> {
  const { step, coder, github, config, event } = ctx;

  // Each external side-effect in its own step.do.
  // Step callbacks return only plain scalars (see conventions.md §step-callback-serialization).
  const whatever = await step.do("some-step", async () => {
    const raw = await coder.someApi();
    return { id: raw.id, name: raw.name };  // narrow projection
  });
}
```

**If your event is PR-scoped and needs to key a task:** call `github.findLinkedIssues(owner, repo, prNumber)` first to get the linked issue number, then `generateTaskName(prefix, repo, issueNumber)`. Never key a task on a PR number. See [gotchas.md § PR number vs issue number](gotchas.md#pr-number-vs-issue-number-in-task-keys).

## 5. Instance ID — `src/workflows/instance-id.ts`

Add a branch to `buildInstanceId`:

```ts
case "my_new_event":
  return `${event.type}-${event.repository.name}-${someUniqueId}-${deliveryId}`;
```

The composite must be unique per logical event and match the Workflow instance charset `[a-zA-Z0-9_-]{1,64}` after the sanitizer. GitHub retries with the same `X-GitHub-Delivery` collapse to the same instance via this ID.

## 6. Tests

Three tests, in this order:

### Router test (`src/webhooks/github/router.test.ts`)

Post a fixture payload through `router.handleGithubWebhook` and assert the returned `Event` shape. Include self-comment / ignored-login / opt-out skip paths if applicable.

### Step factory unit test (`src/workflows/steps/my-new-event.test.ts`)

Use the fake-`WorkflowStep` pattern (`makeStep()` in existing step tests). Assert:

- Step sequence: `expect(step.calls).toEqual([...])`
- Deep equality on each step's return value (catches raw-SDK-field leakage):
  `expect(await step.do.mock.results[idx].value).toEqual({ ... })`
- Early-return branches (if your step has "not found" / permission-denied fast paths)
- Any `NonRetryableError` throw sites — use `rejects.toThrowError(NonRetryableError)`, not bare `rejects.toThrow()`

See [testing.md § fake WorkflowStep](testing.md#fake-workflowstep-for-step-factory-unit-tests).

### Workflow-level introspection test (`src/workflows/task-runner-workflow.test.ts`)

Add a test in the appropriate `describe` block that:

1. Acquires `introspectWorkflowInstance(env.TASK_RUNNER_WORKFLOW, id)` with `await using`.
2. Calls `instance.modify(async (m) => { await m.disableSleeps(); await m.mockStepResult({ name: "..." }, ...); })` for every step your factory emits.
3. Creates the instance with a representative `Event` payload.
4. Asserts `waitForStatus("complete")`.

**Void-return mocks must use `{}`**, not `null` — see [gotchas.md § mockStepResult falsy values](gotchas.md#mockstepresult-with-falsy-values-is-treated-as-no-mock-set).

### HTTP integration coverage (`src/testing/integration.test.ts`) — optional

If your event introduces a new HTTP status-code path (it probably doesn't — response codes are determined by `parseWebhookRequest` + router, not step factories), add a test here.

## 7. Fixtures

Drop a real anonymized GitHub webhook payload in `src/testing/fixtures/<event>.json` for the router test to consume.

## 8. Update the event→step mapping

Add your trigger → steps row to the table in `AGENTS.md` so the event surface is scannable.
