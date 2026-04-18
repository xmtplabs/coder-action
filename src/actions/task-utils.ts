import type {
	CoderClient,
	ExperimentalCoderSDKTask,
} from "../services/coder/client";
import { CoderAPIError, TaskNameSchema } from "../services/coder/client";
import type { Logger } from "../infra/logger";

const DEFAULT_MAX_RETRIES = 5;

export async function lookupAndEnsureActiveTask(
	coder: CoderClient,
	coderUsername: string | undefined,
	taskName: string,
	logger: Logger,
): Promise<ExperimentalCoderSDKTask | null> {
	const parsedName = TaskNameSchema.parse(taskName);
	const task = await coder.getTask(coderUsername, parsedName);
	if (!task) {
		return null;
	}

	if (task.status === "error") {
		logger.warn(`Task ${taskName} is in error state, skipping`);
		return null;
	}

	if (task.status === "active" && task.current_state?.state === "idle") {
		return task;
	}

	// Use task.owner_id (UUID) as the owner identifier — Coder accepts both
	// usernames and UUIDs for user-scoped API paths.
	logger.info(
		`Task ${taskName} is ${task.status}, waiting for active state...`,
	);
	if (task.status === "paused") {
		logger.info(`Resuming paused task ${taskName}...`);
		await coder.startWorkspace(task.workspace_id);
	}
	await coder.waitForTaskActive(task.owner_id, task.id, (msg) =>
		logger.debug(msg),
	);
	return task;
}

/**
 * sendInputWithRetry sends input to a task, retrying if the task is not ready.
 * On CoderAPIError, it waits for the task to return to active+idle and retries.
 * Non-CoderAPIError exceptions are thrown immediately without retry.
 */
export async function sendInputWithRetry(
	coder: CoderClient,
	task: ExperimentalCoderSDKTask,
	input: string,
	logger: Logger,
	maxRetries = DEFAULT_MAX_RETRIES,
): Promise<void> {
	for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
		try {
			await coder.sendTaskInput(task.owner_id, task.id, input);
			return;
		} catch (error) {
			if (!(error instanceof CoderAPIError) || attempt > maxRetries) {
				throw error;
			}
			logger.info(
				`sendTaskInput failed (attempt ${attempt}/${maxRetries + 1}), waiting for task to be ready...`,
			);
			await coder.waitForTaskActive(task.owner_id, task.id, (msg) =>
				logger.debug(msg),
			);
		}
	}
}
