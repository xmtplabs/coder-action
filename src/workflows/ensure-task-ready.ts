import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { CoderService } from "../services/coder/service";
import type { TaskId } from "../services/task-runner";

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Shared retry policy for cheap idempotent status reads. The outer
 * `ensureTaskReady` loop already provides higher-level retry coverage; this
 * keeps individual step failures from bubbling to the instance on transient
 * network blips.
 */
const STATUS_RETRY: WorkflowStepConfig = {
	retries: {
		limit: 3,
		delay: "2 seconds",
		backoff: "exponential",
	},
};

// Attempt boundaries at a 30-second constant poll interval.
// MAX_ATTEMPTS = 60              → ≈ 30 min total budget
// ERROR_GRACE_ATTEMPTS = 10      → error/unknown beyond attempt 10 fails (5 min)
// NIL_STATE_GRACE_ATTEMPTS = 4   → 4 consecutive null observations → treat as idle (2 min)
const MAX_ATTEMPTS = 60;
const ERROR_GRACE_ATTEMPTS = 10;
const NIL_STATE_GRACE_ATTEMPTS = 4;
const POLL_INTERVAL = "30 seconds";

export interface EnsureTaskReadyOptions {
	step: WorkflowStep;
	coder: CoderService;
	taskId: TaskId;
	owner: string;
}

/**
 * Block the Workflow instance until the task's normalized status is "ready".
 *
 * Two phases: pre-poll dispatch (one lookup + optional resume) then a
 * hand-rolled loop alternating `step.do("check-status-<n>", ...)` and
 * `step.sleep("wait-<n>", "30 seconds")`. The `nilStateStartAttempt` closure
 * variable tracks consecutive `active+null` observations across iterations.
 *
 * **Replay safety (EARS-REQ-16b)**: the workflow engine replays run() from
 * the top on every resume. Completed step.do calls return cached outputs, so
 * the closure-state mutations (which live OUTSIDE step callbacks and depend
 * only on those cached outputs) reconstruct identically on replay. We never
 * mutate closure state inside a step.do callback and never read Date.now(),
 * Math.random(), or cross-request globals here.
 *
 * **Serialization (EARS-REQ-16a)**: step callbacks return only plain scalar
 * objects — never the raw Coder SDK task, never class instances.
 */
export async function ensureTaskReady(
	opts: EnsureTaskReadyOptions,
): Promise<void> {
	const { step, coder, taskId, owner } = opts;

	// ── Phase 1: pre-poll dispatch ──────────────────────────────────────────
	const initial = await step.do("lookup-task", STATUS_RETRY, async () => {
		const raw = await coder.getTaskById(taskId, owner);
		// Return only the scalars we need — never the raw SDK object.
		return {
			status: raw.status,
			state: raw.current_state?.state ?? null,
			workspaceId: raw.workspace_id,
		};
	});

	// Early-return if already ready at pre-poll time (common fast path).
	if (
		initial.status === "active" &&
		(initial.state === "idle" ||
			initial.state === "complete" ||
			initial.state === "failed")
	) {
		return;
	}

	if (initial.status === "paused") {
		await step.do("resume-paused-task", async () => {
			await coder.resumeWorkspace(initial.workspaceId);
		});
	}

	// ── Phase 2: hand-rolled poll loop ──────────────────────────────────────
	// Closure state — mutated only OUTSIDE step.do callbacks. Pure function of
	// the sequence of cached step outputs; replay-safe (EARS-REQ-16b).
	let nilStateStartAttempt: number | null = null;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const obs = await step.do(
			`check-status-${attempt}`,
			STATUS_RETRY,
			async () => {
				const raw = await coder.getTaskById(taskId, owner);
				return {
					status: raw.status,
					state: raw.current_state?.state ?? null,
				};
			},
		);

		switch (obs.status) {
			case "active":
				if (
					obs.state === "idle" ||
					obs.state === "complete" ||
					obs.state === "failed"
				) {
					return;
				}
				if (obs.state === null) {
					if (nilStateStartAttempt === null) nilStateStartAttempt = attempt;
					if (attempt - nilStateStartAttempt >= NIL_STATE_GRACE_ATTEMPTS) {
						// Treat persistent nil-state as idle per spec §4.
						return;
					}
				} else {
					// Non-null state observed → reset the grace window.
					nilStateStartAttempt = null;
				}
				break;
			case "initializing":
			case "pending":
				// New/starting-up states. Also resets nil-state grace (we're no
				// longer in active+null territory).
				nilStateStartAttempt = null;
				break;
			case "error":
			case "unknown":
				// Both may be transient during startup. Allow up to 5 minutes from
				// loop entry.
				nilStateStartAttempt = null;
				if (attempt > ERROR_GRACE_ATTEMPTS) {
					throw new NonRetryableError(
						`task ${taskId} remained in ${obs.status} beyond 5-minute grace`,
					);
				}
				break;
			case "paused":
				// Paused DURING polling is terminal. Pre-poll dispatch already
				// handled the legitimate resume case; re-entering paused mid-wait
				// indicates the workspace is unstable and continuing won't help.
				throw new NonRetryableError(
					`task ${taskId} was paused while waiting for idle`,
				);
			default:
				throw new NonRetryableError(
					`task ${taskId} entered unexpected status ${obs.status}`,
				);
		}

		await step.sleep(`wait-${attempt}`, POLL_INTERVAL);
	}

	// Timeout — plain Error (NOT NonRetryableError) so an operator can restart.
	throw new Error(
		`task ${taskId} did not become ready within ${MAX_ATTEMPTS} polls (30 minutes)`,
	);
}
