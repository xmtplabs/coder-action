import * as core from "@actions/core";
import type { CoderClient } from "../coder-client";
import type { GitHubClient } from "../github-client";
import { formatIssueCommentMessage } from "../messages";
import type { ActionOutputs, IssueCommentInputs } from "../schemas";
import { generateTaskName, lookupAndEnsureActiveTask } from "../task-utils";

export interface IssueCommentContext {
	owner: string;
	repo: string;
	issueNumber: number;
	commenterLogin: string;
	commentUrl: string;
	commentBody: string;
	commentCreatedAt: string;
}

export class IssueCommentHandler {
	constructor(
		private readonly coder: CoderClient,
		_github: GitHubClient,
		private readonly inputs: IssueCommentInputs,
		private readonly context: IssueCommentContext,
	) {}

	async run(): Promise<ActionOutputs> {
		// Guard: self-comment
		if (this.context.commenterLogin === this.inputs.coderGithubUsername) {
			core.info("Ignoring self-comment from coder agent");
			return { skipped: true, skipReason: "self-comment" };
		}

		// Compute task name and look up
		const taskName = generateTaskName(
			this.inputs.coderTaskNamePrefix,
			this.context.repo,
			this.context.issueNumber,
		);
		const task = await lookupAndEnsureActiveTask(
			this.coder,
			this.inputs.coderUsername,
			taskName,
		);
		if (!task) {
			core.info(`Task not found for issue #${this.context.issueNumber}`);
			return { skipped: true, skipReason: "task-not-found" };
		}

		// Format and send
		const message = formatIssueCommentMessage({
			commentUrl: this.context.commentUrl,
			commenter: this.context.commenterLogin,
			timestamp: this.context.commentCreatedAt,
			body: this.context.commentBody,
		});
		await this.coder.sendTaskInput(task.owner_id, task.id, message);
		core.info(`Comment forwarded to task ${taskName}`);

		return { taskName, taskStatus: task.status, skipped: false };
	}
}
