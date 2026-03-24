import type { CoderClient } from "../coder-client";
import type { GitHubClient } from "../github-client";
import type { Logger } from "../logger";
import { formatPRCommentMessage } from "../messages";
import type { ActionOutputs, HandlerConfig } from "../schemas";
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
	isReviewComment?: boolean;
	isReviewSubmission?: boolean;
}

export class PRCommentHandler {
	constructor(
		private readonly coder: CoderClient,
		private readonly github: GitHubClient,
		private readonly inputs: HandlerConfig,
		private readonly context: PRCommentContext,
		private readonly logger: Logger,
	) {}

	async run(): Promise<ActionOutputs> {
		// Guard: PR author must be the coder agent
		if (this.context.prAuthor !== this.inputs.agentGithubUsername) {
			this.logger.info(
				`PR not authored by ${this.inputs.agentGithubUsername}, skipping`,
			);
			return { skipped: true, skipReason: "pr-not-by-coder-agent" };
		}

		// Guard: self-comment
		if (this.context.commenterLogin === this.inputs.agentGithubUsername) {
			this.logger.info("Ignoring self-comment from coder agent");
			return { skipped: true, skipReason: "self-comment" };
		}

		// Guard: empty review body (e.g. approval with no text)
		if (this.context.isReviewSubmission && !this.context.commentBody?.trim()) {
			this.logger.info("Ignoring review submission with empty body");
			return { skipped: true, skipReason: "empty-review-body" };
		}

		// Find linked issue
		const linkedIssues = await this.github.findLinkedIssues(
			this.context.owner,
			this.context.repo,
			this.context.prNumber,
		);
		if (linkedIssues.length === 0) {
			this.logger.info("No linked issue found");
			return { skipped: true, skipReason: "no-linked-issue" };
		}
		if (linkedIssues.length > 1) {
			this.logger.warning(
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
			this.logger,
		);
		if (!task) {
			this.logger.info(`Task not found: ${taskName}`);
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
		this.logger.info(`Comment forwarded to task ${taskName}`);

		if (this.context.isReviewSubmission) {
			// No reaction API for review submissions — skip silently
		} else if (this.context.isReviewComment) {
			await this.github.addReactionToReviewComment(
				this.context.owner,
				this.context.repo,
				this.context.commentId,
			);
		} else {
			await this.github.addReactionToComment(
				this.context.owner,
				this.context.repo,
				this.context.commentId,
			);
		}

		return { taskName, taskStatus: task.status, skipped: false };
	}
}
