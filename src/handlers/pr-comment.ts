import * as core from "@actions/core";
import type { CoderClient } from "../coder-client";
import type { GitHubClient } from "../github-client";
import { formatPRCommentMessage } from "../messages";
import type { ActionOutputs, PRCommentInputs } from "../schemas";
import { generateTaskName, lookupAndEnsureActiveTask } from "../task-utils";

export interface PRCommentContext {
	owner: string;
	repo: string;
	prNumber: number;
	prAuthor: string;
	commenterLogin: string;
	commentId: number;
	commentUrl: string;
	commentBody: string;
	commentCreatedAt: string;
}

export class PRCommentHandler {
	constructor(
		private readonly coder: CoderClient,
		private readonly github: GitHubClient,
		private readonly inputs: PRCommentInputs,
		private readonly context: PRCommentContext,
	) {}

	async run(): Promise<ActionOutputs> {
		// Guard: PR author must be the coder agent
		if (this.context.prAuthor !== this.inputs.coderGithubUsername) {
			core.info(
				`PR not authored by ${this.inputs.coderGithubUsername}, skipping`,
			);
			return { skipped: true, skipReason: "pr-not-by-coder-agent" };
		}

		// Guard: self-comment
		if (this.context.commenterLogin === this.inputs.coderGithubUsername) {
			core.info("Ignoring self-comment from coder agent");
			return { skipped: true, skipReason: "self-comment" };
		}

		// Find linked issue
		const linkedIssues = await this.github.findLinkedIssues(
			this.context.owner,
			this.context.repo,
			this.context.prNumber,
		);
		if (linkedIssues.length === 0) {
			core.info("No linked issue found");
			return { skipped: true, skipReason: "no-linked-issue" };
		}
		if (linkedIssues.length > 1) {
			core.warning(
				`Multiple linked issues found, using first: #${linkedIssues[0].number}`,
			);
		}
		const issue = linkedIssues[0];

		// Compute task name and look up
		const taskName = generateTaskName(
			this.inputs.coderTaskNamePrefix,
			this.context.repo,
			issue.number,
		);
		const task = await lookupAndEnsureActiveTask(
			this.coder,
			this.inputs.coderUsername,
			taskName,
		);
		if (!task) {
			core.info(`Task not found: ${taskName}`);
			return { skipped: true, skipReason: "task-not-found" };
		}

		// Format and send
		const message = formatPRCommentMessage({
			commentUrl: this.context.commentUrl,
			commenter: this.context.commenterLogin,
			timestamp: this.context.commentCreatedAt,
			body: this.context.commentBody,
		});
		await this.coder.sendTaskInput(task.owner_id, task.id, message);
		core.info(`Comment forwarded to task ${taskName}`);

		await this.github.addReactionToComment(
			this.context.owner,
			this.context.repo,
			this.context.commentId,
		);

		return { taskName, taskStatus: task.status, skipped: false };
	}
}
