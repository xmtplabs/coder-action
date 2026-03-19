import * as core from "@actions/core";
import type { CoderClient } from "../coder-client";
import { TaskNameSchema } from "../coder-client";
import type { GitHubClient } from "../github-client";
import type { ActionOutputs, CloseTaskInputs } from "../schemas";
import { generateTaskName } from "../task-utils";

export interface CloseTaskContext {
	owner: string;
	repo: string;
	issueNumber: number;
}

export class CloseTaskHandler {
	constructor(
		private readonly coder: CoderClient,
		private readonly github: GitHubClient,
		private readonly inputs: CloseTaskInputs,
		private readonly context: CloseTaskContext,
	) {}

	async run(): Promise<ActionOutputs> {
		const taskName = generateTaskName(
			this.inputs.coderTaskNamePrefix,
			this.context.repo,
			this.context.issueNumber,
		);
		core.info(`Looking up task: ${taskName}`);

		const parsedName = TaskNameSchema.parse(taskName);
		const task = await this.coder.getTask(
			this.inputs.coderUsername,
			parsedName,
		);

		if (!task) {
			core.info(
				`No task found for issue #${this.context.issueNumber}, nothing to clean up`,
			);
			return { skipped: true, skipReason: "task-not-found" };
		}

		const workspaceId = task.workspace_id;
		core.info(`Stopping workspace ${workspaceId} for task ${taskName}`);

		// Stop workspace — continue even if this fails
		let stopSucceeded = false;
		try {
			await this.coder.stopWorkspace(workspaceId);
			stopSucceeded = true;
		} catch (error: unknown) {
			core.warning(`Failed to stop workspace: ${error}`);
		}

		// Wait for workspace to reach stopped state before deleting — continue even if this times out
		if (stopSucceeded) {
			try {
				await this.coder.waitForWorkspaceStopped(workspaceId, core.info);
			} catch (error: unknown) {
				core.warning(`Timed out waiting for workspace to stop: ${error}`);
			}
		}

		// Delete workspace — continue even if this fails
		try {
			await this.coder.deleteWorkspace(workspaceId);
		} catch (error: unknown) {
			core.warning(`Failed to delete workspace: ${error}`);
		}

		// Delete task — continue even if this fails
		try {
			await this.coder.deleteTask(this.inputs.coderUsername, task.id);
		} catch (error: unknown) {
			core.warning(`Failed to delete task: ${error}`);
		}

		await this.github.commentOnIssue(
			this.context.owner,
			this.context.repo,
			this.context.issueNumber,
			"Task completed.",
			"Task created:",
		);

		return { taskName, taskStatus: "deleted", skipped: false };
	}
}
