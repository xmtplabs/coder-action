import type { ExperimentalCoderSDKTask } from "./schemas";
import type { TaskId } from "./schemas";

const POLL_INTERVAL_MS = 5_000;
const NIL_STATE_GRACE_MS = 30_000;
const ERROR_GRACE_MS = 5 * 60_000;

export async function waitForTaskIdle(params: {
	client: {
		getTaskById: (
			id: string,
			owner?: string,
		) => Promise<ExperimentalCoderSDKTask>;
	};
	taskId: TaskId;
	owner: string;
	log: (msg: string) => void;
	sleepFn?: (ms: number) => Promise<void>;
	now?: () => number;
	timeoutMs?: number;
}): Promise<void> {
	const {
		client,
		taskId,
		owner,
		log,
		sleepFn = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
		now = Date.now,
		timeoutMs = 120_000,
	} = params;

	const startedAt = now();
	let nilStateSince: number | null = null;
	let errorSince: number | null = null;

	for (;;) {
		const current = now();
		const task = await client.getTaskById(taskId, owner);

		log(
			`waitForTaskIdle: task_id: ${taskId} status: ${task.status} current_state: ${task.current_state?.state ?? "null"}`,
		);

		switch (task.status) {
			case "active": {
				errorSince = null;
				const state = task.current_state?.state ?? null;
				if (state === "idle" || state === "complete" || state === "failed") {
					return;
				}
				if (state === "working") {
					nilStateSince = null;
					break;
				}
				// current_state is null
				if (nilStateSince === null) {
					nilStateSince = current;
				}
				if (current - nilStateSince >= NIL_STATE_GRACE_MS) {
					return;
				}
				break;
			}
			case "initializing":
			case "pending": {
				nilStateSince = null;
				errorSince = null;
				break;
			}
			case "error": {
				if (errorSince === null) {
					errorSince = current;
				}
				if (current - errorSince >= ERROR_GRACE_MS) {
					throw new Error(
						`Task ${taskId} entered error state and did not recover within ${ERROR_GRACE_MS}ms`,
					);
				}
				break;
			}
			case "paused": {
				throw new Error(`Task ${taskId} is paused`);
			}
			case "unknown": {
				throw new Error(`Task ${taskId} has unknown status`);
			}
			default: {
				throw new Error(`Task ${taskId} has unexpected status: ${task.status}`);
			}
		}

		if (current - startedAt >= timeoutMs) {
			throw new Error(
				`Timeout waiting for task ${taskId} to become idle (waited ${timeoutMs}ms)`,
			);
		}

		await sleepFn(POLL_INTERVAL_MS);
	}
}
