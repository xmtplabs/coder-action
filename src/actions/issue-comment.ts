import type { TaskRunner } from "../services/task-runner";
import type { GitHubClient } from "../services/github/client";
import type { Logger } from "../infra/logger";
import { formatIssueCommentMessage } from "./messages";
import type { ActionOutputs, HandlerConfig } from "../config/handler-config";
import { generateTaskName } from "./task-naming";

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

export class IssueCommentAction {
	constructor(
		private readonly runner: TaskRunner,
		private readonly github: GitHubClient,
		private readonly inputs: HandlerConfig,
		private readonly context: IssueCommentContext,
		private readonly logger: Logger,
	) {}

	async run(): Promise<ActionOutputs> {
		// 1. Guard: self-comment
		if (this.context.commenterLogin === this.inputs.agentGithubUsername) {
			this.logger.info("Ignoring self-comment from coder agent");
			return { skipped: true, skipReason: "self-comment" };
		}

		// 2. Compute task name
		const taskName = generateTaskName(
			this.inputs.coderTaskNamePrefix,
			this.context.repo,
			this.context.issueNumber,
		);

		// 3. Look up task status (owner omitted — resolve by name)
		const existing = await this.runner.getStatus({ taskName });

		// 4. Task not found or in error state
		if (!existing || existing.status === "error") {
			this.logger.info(`Task not found for issue #${this.context.issueNumber}`);
			return { skipped: true, skipReason: "task-not-found" };
		}

		// 5. Format message
		const message = formatIssueCommentMessage({
			commentUrl: this.context.commentUrl,
			commenter: this.context.commenterLogin,
			timestamp: this.context.commentCreatedAt,
			body: this.context.commentBody,
		});

		// 6. Send input
		await this.runner.sendInput({ taskName, input: message, timeout: 120_000 });
		this.logger.info(`Comment forwarded to task ${taskName}`);

		// 7. React
		await this.github.addReactionToComment(
			this.context.owner,
			this.context.repo,
			this.context.commentId,
		);

		// 8. Return
		return { taskName, taskStatus: existing.status, skipped: false };
	}
}
