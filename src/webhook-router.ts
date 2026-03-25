import type { Logger } from "./logger";
import {
	IssuesAssignedPayloadSchema,
	IssuesClosedPayloadSchema,
	IssueCommentCreatedPayloadSchema,
	PRReviewCommentCreatedPayloadSchema,
	PRReviewSubmittedPayloadSchema,
	WorkflowRunCompletedPayloadSchema,
} from "./webhook-schemas";

// ── Public types ──────────────────────────────────────────────────────────────

export type HandlerType =
	| "create_task"
	| "close_task"
	| "pr_comment"
	| "issue_comment"
	| "failed_check";

export type RouteResult =
	| {
			dispatched: true;
			handler: HandlerType;
			installationId: number;
			context: Record<string, unknown>;
	  }
	| {
			dispatched: false;
			reason: string;
			/** Set to true when the failure is due to a Zod schema validation error. */
			validationError?: boolean;
	  };

export interface WebhookRouterOptions {
	agentGithubUsername: string;
	appBotLogin: string;
	logger: Logger;
}

// ── Router ────────────────────────────────────────────────────────────────────

export class WebhookRouter {
	private readonly ignoredLogins: Set<string>;

	constructor(private readonly options: WebhookRouterOptions) {
		this.ignoredLogins = new Set([
			options.appBotLogin,
			options.agentGithubUsername,
		]);
	}

	async handleWebhook(
		eventName: string,
		deliveryId: string,
		payload: unknown,
	): Promise<RouteResult> {
		this.options.logger.debug("Routing webhook", { eventName, deliveryId });

		switch (eventName) {
			case "issues":
				return this.routeIssues(payload);
			case "issue_comment":
				return this.routeIssueComment(payload);
			case "pull_request_review_comment":
				return this.routePRReviewComment(payload);
			case "pull_request_review":
				return this.routePRReview(payload);
			case "workflow_run":
				return this.routeWorkflowRun(payload);
			default:
				return { dispatched: false, reason: `Unhandled event: ${eventName}` };
		}
	}

	// ── Private routing methods ──────────────────────────────────────────────

	private routeIssues(payload: unknown): RouteResult {
		// Try "assigned" first
		const assigned = IssuesAssignedPayloadSchema.safeParse(payload);
		if (assigned.success) {
			const { assignee, issue, repository, installation, sender } =
				assigned.data;
			if (assignee.login !== this.options.agentGithubUsername) {
				return {
					dispatched: false,
					reason: `Skipping: assignee login "${assignee.login}" does not match agent login`,
				};
			}
			return {
				dispatched: true,
				handler: "create_task",
				installationId: installation.id,
				context: {
					issueNumber: issue.number,
					issueUrl: issue.html_url,
					repoName: repository.name,
					repoOwner: repository.owner.login,
					senderLogin: sender.login,
					senderId: sender.id,
				},
			};
		}

		// Try "closed"
		const closed = IssuesClosedPayloadSchema.safeParse(payload);
		if (closed.success) {
			const { issue, repository, installation } = closed.data;
			return {
				dispatched: true,
				handler: "close_task",
				installationId: installation.id,
				context: {
					issueNumber: issue.number,
					repoName: repository.name,
					repoOwner: repository.owner.login,
				},
			};
		}

		return { dispatched: false, reason: "Unhandled issues action" };
	}

	private routeIssueComment(payload: unknown): RouteResult {
		const parsed = IssueCommentCreatedPayloadSchema.safeParse(payload);
		if (!parsed.success) {
			return {
				dispatched: false,
				reason: "Failed to parse issue_comment payload",
				validationError: true,
			};
		}

		const { action, issue, comment, repository, installation } = parsed.data;

		// Only handle created and edited actions
		if (action !== "created" && action !== "edited") {
			return {
				dispatched: false,
				reason: `Unhandled issue_comment action: ${action}`,
			};
		}

		if (this.ignoredLogins.has(comment.user.login)) {
			return {
				dispatched: false,
				reason: `Skipping: comment author "${comment.user.login}" is in ignored logins`,
			};
		}

		// Issue comment on a PR (issue.pull_request is present and non-null)
		// Guard: only forward comments on PRs opened by the agent
		if (issue.pull_request != null) {
			if (issue.user.login !== this.options.agentGithubUsername) {
				return {
					dispatched: false,
					reason: `Skipping: PR author "${issue.user.login}" does not match agent login`,
				};
			}
			return {
				dispatched: true,
				handler: "pr_comment",
				installationId: installation.id,
				context: {
					issueNumber: issue.number,
					commentBody: comment.body,
					commentUrl: comment.html_url,
					commentId: comment.id,
					commentCreatedAt: comment.created_at,
					repoName: repository.name,
					repoOwner: repository.owner.login,
					prAuthor: issue.user.login,
					commenterLogin: comment.user.login,
					isReviewComment: false,
					isReviewSubmission: false,
				},
			};
		}

		// Plain issue comment
		return {
			dispatched: true,
			handler: "issue_comment",
			installationId: installation.id,
			context: {
				issueNumber: issue.number,
				commentBody: comment.body,
				commentUrl: comment.html_url,
				commentId: comment.id,
				commentCreatedAt: comment.created_at,
				repoName: repository.name,
				repoOwner: repository.owner.login,
				commenterLogin: comment.user.login,
			},
		};
	}

	private routePRReviewComment(payload: unknown): RouteResult {
		const parsed = PRReviewCommentCreatedPayloadSchema.safeParse(payload);
		if (!parsed.success) {
			return {
				dispatched: false,
				reason: "Failed to parse pull_request_review_comment payload",
				validationError: true,
			};
		}

		const { action, pull_request, comment, repository, installation } =
			parsed.data;

		// Only handle created and edited actions
		if (action !== "created" && action !== "edited") {
			return {
				dispatched: false,
				reason: `Unhandled pull_request_review_comment action: ${action}`,
			};
		}

		if (pull_request.user.login !== this.options.agentGithubUsername) {
			return {
				dispatched: false,
				reason: `Skipping: pull_request.user login "${pull_request.user.login}" does not match agent login`,
			};
		}

		if (this.ignoredLogins.has(comment.user.login)) {
			return {
				dispatched: false,
				reason: `Skipping: comment author "${comment.user.login}" is in ignored logins`,
			};
		}

		return {
			dispatched: true,
			handler: "pr_comment",
			installationId: installation.id,
			context: {
				issueNumber: pull_request.number,
				commentBody: comment.body,
				commentUrl: comment.html_url,
				commentId: comment.id,
				commentCreatedAt: comment.created_at,
				repoName: repository.name,
				repoOwner: repository.owner.login,
				prAuthor: pull_request.user.login,
				commenterLogin: comment.user.login,
				isReviewComment: true,
				isReviewSubmission: false,
			},
		};
	}

	private routePRReview(payload: unknown): RouteResult {
		const parsed = PRReviewSubmittedPayloadSchema.safeParse(payload);
		if (!parsed.success) {
			return {
				dispatched: false,
				reason: "Failed to parse pull_request_review payload",
				validationError: true,
			};
		}

		const { pull_request, review, repository, installation } = parsed.data;

		if (pull_request.user.login !== this.options.agentGithubUsername) {
			return {
				dispatched: false,
				reason: `Skipping: pull_request.user login "${pull_request.user.login}" does not match agent login`,
			};
		}

		if (this.ignoredLogins.has(review.user.login)) {
			return {
				dispatched: false,
				reason: `Skipping: review author "${review.user.login}" is in ignored logins`,
			};
		}

		if (!review.body) {
			return {
				dispatched: false,
				reason: "Skipping: review body is empty or null",
			};
		}

		return {
			dispatched: true,
			handler: "pr_comment",
			installationId: installation.id,
			context: {
				issueNumber: pull_request.number,
				commentBody: review.body,
				commentUrl: review.html_url,
				commentId: review.id,
				commentCreatedAt: review.submitted_at,
				repoName: repository.name,
				repoOwner: repository.owner.login,
				prAuthor: pull_request.user.login,
				commenterLogin: review.user.login,
				isReviewComment: false,
				isReviewSubmission: true,
			},
		};
	}

	private routeWorkflowRun(payload: unknown): RouteResult {
		const parsed = WorkflowRunCompletedPayloadSchema.safeParse(payload);
		if (!parsed.success) {
			return {
				dispatched: false,
				reason: "Failed to parse workflow_run payload",
				validationError: true,
			};
		}

		const { workflow_run, repository, installation } = parsed.data;

		if (workflow_run.conclusion !== "failure") {
			return {
				dispatched: false,
				reason: `Skipping: workflow_run conclusion is "${workflow_run.conclusion}", not "failure"`,
			};
		}

		return {
			dispatched: true,
			handler: "failed_check",
			installationId: installation.id,
			context: {
				workflowRunId: workflow_run.id,
				workflowName: workflow_run.name,
				workflowPath: workflow_run.path ?? null,
				headSha: workflow_run.head_sha,
				workflowRunUrl: workflow_run.html_url,
				conclusion: workflow_run.conclusion,
				pullRequestNumbers: workflow_run.pull_requests.map((pr) => pr.number),
				repoName: repository.name,
				repoOwner: repository.owner.login,
			},
		};
	}
}
