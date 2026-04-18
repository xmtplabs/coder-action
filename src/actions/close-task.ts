import type { TaskRunner } from "../services/task-runner";
import type { GitHubClient } from "../services/github/client";
import type { Logger } from "../infra/logger";
import type { ActionOutputs, HandlerConfig } from "../config/handler-config";
import { generateTaskName } from "./task-naming";

export interface CloseTaskContext {
	owner: string;
	repo: string;
	issueNumber: number;
}

export class CloseTaskAction {
	constructor(
		private readonly runner: TaskRunner,
		private readonly github: GitHubClient,
		private readonly inputs: HandlerConfig,
		private readonly context: CloseTaskContext,
		private readonly logger: Logger,
	) {}

	async run(): Promise<ActionOutputs> {
		// 1. Compute task name
		const taskName = generateTaskName(
			this.inputs.coderTaskNamePrefix,
			this.context.repo,
			this.context.issueNumber,
		);
		this.logger.info(`Deleting task: ${taskName}`);

		// 2. Delete task (idempotent — no-op if missing)
		const result = await this.runner.delete({ taskName });

		// 3. Skip without comment if no task existed
		if (!result.deleted) {
			this.logger.info(`Task not found (no-op): ${taskName}`);
			return { skipped: true, skipReason: "task-not-found" };
		}

		// 4. Comment on issue
		await this.github.commentOnIssue(
			this.context.owner,
			this.context.repo,
			this.context.issueNumber,
			"Task completed.",
			"Task created:",
		);

		// 5. Return
		return { taskName, taskStatus: "deleted" as const, skipped: false };
	}
}
