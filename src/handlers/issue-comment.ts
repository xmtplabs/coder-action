import type { CoderClient } from "../coder-client";
import type { GitHubClient } from "../github-client";
import type { Logger } from "../logger";
import { formatIssueCommentMessage } from "../messages";
import type { ActionOutputs, HandlerConfig } from "../schemas";
import { generateTaskName, lookupAndEnsureActiveTask } from "../task-utils";

export interface IssueCommentContext {
	owner: string;
	repo: string;
	issueNumber: number;
	commentId: number;
	commenterLogin: string;
	commentUrl: string;
	commentBody: string;
	commentCreatedAt: string;
}

export class IssueCommentHandler {
	constructor(
		private readonly coder: CoderClient,
		private readonly github: GitHubClient,
		private readonly inputs: HandlerConfig,
		private readonly context: IssueCommentContext,
		private readonly logger: Logger,
	) {}

	async run(): Promise<ActionOutputs> {
		// Guard: self-comment
		if (this.context.commenterLogin === this.inputs.agentGithubUsername) {
			this.logger.info("Ignoring self-comment from coder agent");
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
			this.logger,
		);
		if (!task) {
			this.logger.info(`Task not found for issue #${this.context.issueNumber}`);
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
		this.logger.info(`Comment forwarded to task ${taskName}`);

		await this.github.addReactionToComment(
			this.context.owner,
			this.context.repo,
			this.context.commentId,
		);

		return { taskName, taskStatus: task.status, skipped: false };
	}
}
