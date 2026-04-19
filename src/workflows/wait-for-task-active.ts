import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import type { CoderService } from "../services/coder/service";
import type { TaskId } from "../services/task-runner";

/**
 * Shared retry policy for cheap idempotent status reads. Mirrors
 * `ensureTaskReady`'s config so transient network blips are absorbed inside a
 * single `step.do` rather than bubbling to the instance.
 */
const STATUS_RETRY: WorkflowStepConfig = {
	retries: {
		limit: 3,
		delay: "2 seconds",
		backoff: "exponential",
	},
};

// Attempt boundaries at a 30-second constant poll interval.
// MAX_ATTEMPTS = 60           → ≈ 30 min total budget
// ERROR_GRACE_ATTEMPTS = 10   → error/unknown beyond attempt 10 → "error" (5 min)
const MAX_ATTEMPTS = 60;
const ERROR_GRACE_ATTEMPTS = 10;
const POLL_INTERVAL = "30 seconds";

export type WaitForTaskActiveResult = "active" | "error";

export interface WaitForTaskActiveOptions {
	step: WorkflowStep;
	coder: CoderService;
	taskId: TaskId;
	owner: string;
}

/**
 * Wait for the raw Coder task status to reach `"active"` OR a terminal error.
 *
 * Looser than `ensureTaskReady`: we only care about `status === "active"` and
 * do NOT inspect `current_state`. Intended for post-create sandbox-boot
 * polling where the caller wants to surface "running" vs "failed" to the user
 * ASAP, without waiting for the agent to settle into idle.
 *
 * Returns:
 *  - `"active"` on first observation of `status === "active"`.
 *  - `"error"` when `status` is `error`/`unknown` past `ERROR_GRACE_ATTEMPTS`,
 *    when `paused` is observed, when the status is an unexpected value, or
 *    when the `MAX_ATTEMPTS` budget is exhausted.
 *
 * Never throws for task-state reasons. Transient network errors inside a
 * single `step.do` are absorbed by `STATUS_RETRY`; if those retries are
 * exhausted the instance errors per standard Workflow semantics.
 *
 * Step naming is distinct from `ensureTaskReady` (`wait-lookup-task`,
 * `wait-check-status-${n}`, `wait-sleep-${n}`) so both helpers can compose in
 * one instance without cache collisions.
 */
export async function waitForTaskActive(
	opts: WaitForTaskActiveOptions,
): Promise<WaitForTaskActiveResult> {
	const { step, coder, taskId, owner } = opts;

	const initial = await step.do("wait-lookup-task", STATUS_RETRY, async () => {
		const raw = await coder.getTaskById(taskId, owner);
		return { status: raw.status };
	});

	const preResult = classify(initial.status, 0);
	if (preResult === "active") return "active";
	if (preResult === "error") return "error";

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const obs = await step.do(
			`wait-check-status-${attempt}`,
			STATUS_RETRY,
			async () => {
				const raw = await coder.getTaskById(taskId, owner);
				return { status: raw.status };
			},
		);

		const result = classify(obs.status, attempt);
		if (result === "active") return "active";
		if (result === "error") return "error";

		await step.sleep(`wait-sleep-${attempt}`, POLL_INTERVAL);
	}

	return "error";
}

/**
 * Map an observed raw status to a terminal result, "continue" to keep polling,
 * or "error" when the error-grace window is exhausted. Pure function of the
 * observation and the attempt counter — safe to call across replays.
 */
function classify(
	status: string,
	attempt: number,
): WaitForTaskActiveResult | "continue" {
	switch (status) {
		case "active":
			return "active";
		case "pending":
		case "initializing":
			return "continue";
		case "error":
		case "unknown":
			return attempt > ERROR_GRACE_ATTEMPTS ? "error" : "continue";
		case "paused":
			return "error";
		default:
			return "error";
	}
}
