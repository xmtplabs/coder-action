import type { Logger } from "./logger";
import type {
	IssuesAssignedPayload,
	IssuesClosedPayload,
	IssueCommentCreatedPayload,
	IssueCommentEditedPayload,
	PRReviewCommentCreatedPayload,
	PRReviewCommentEditedPayload,
	PRReviewSubmittedPayload,
	WorkflowRunCompletedPayload,
} from "./webhook-schemas";

// ── Public types ──────────────────────────────────────────────────────────────

export type HandlerType =
	| "create_task"
	| "close_task"
	| "pr_comment"
	| "issue_comment"
	| "failed_check";

export type CreateTaskContext = {
	issueNumber: number;
	issueUrl: string;
	repoName: string;
	repoOwner: string;
	senderLogin: string;
	senderId: number;
};

export type CloseTaskContext = {
	issueNumber: number;
	repoName: string;
	repoOwner: string;
};

export type PRCommentContext = {
	issueNumber: number;
	commentBody: string;
	commentUrl: string;
	commentId: number;
	commentCreatedAt: string;
	repoName: string;
	repoOwner: string;
	prAuthor: string;
	commenterLogin: string;
	isReviewComment: boolean;
	isReviewSubmission: boolean;
};

export type IssueCommentContext = {
	issueNumber: number;
	commentBody: string;
	commentUrl: string;
	commentId: number;
	commentCreatedAt: string;
	repoName: string;
	repoOwner: string;
	commenterLogin: string;
};

export type FailedCheckContext = {
	workflowRunId: number;
	workflowName: string | null;
	workflowPath: string | null;
	headSha: string;
	workflowRunUrl: string;
	conclusion: string | null;
	pullRequestNumbers: number[];
	repoName: string;
	repoOwner: string;
};

export type RouteResult =
	| {
			dispatched: true;
			handler: "create_task";
			installationId: number;
			context: CreateTaskContext;
	  }
	| {
			dispatched: true;
			handler: "close_task";
			installationId: number;
			context: CloseTaskContext;
	  }
	| {
			dispatched: true;
			handler: "pr_comment";
			installationId: number;
			context: PRCommentContext;
	  }
	| {
			dispatched: true;
			handler: "issue_comment";
			installationId: number;
			context: IssueCommentContext;
	  }
	| {
			dispatched: true;
			handler: "failed_check";
			installationId: number;
			context: FailedCheckContext;
	  }
	| {
			dispatched: false;
			reason: string;
			/** Set to true when the failure is due to a payload validation error. */
			validationError?: boolean;
	  };

export interface WebhookRouterOptions {
	agentGithubUsername: string;
	appBotLogin: string;
	logger: Logger;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the `action` field from a webhook payload.
 * Returns null if the payload is not an object or has no string `action`.
 */
function getAction(payload: unknown): string | null {
	if (typeof payload !== "object" || payload === null) return null;
	const action = (payload as Record<string, unknown>).action;
	return typeof action === "string" ? action : null;
}

/**
 * Extracts installation.id from a webhook payload.
 * Returns 0 if installation is missing (should not happen for valid payloads).
 */
function getInstallationId(payload: unknown): number {
	if (typeof payload !== "object" || payload === null) return 0;
	const inst = (payload as Record<string, unknown>).installation;
	if (typeof inst !== "object" || inst === null) return 0;
	const id = (inst as Record<string, unknown>).id;
	return typeof id === "number" ? id : 0;
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

	/**
	 * Routes a webhook payload to the appropriate handler based on the
	 * event name and action. Each event.action pair maps directly to a
	 * strongly-typed octokit payload type via type assertion.
	 */
	async handleWebhook(
		eventName: string,
		deliveryId: string,
		payload: unknown,
	): Promise<RouteResult> {
		this.options.logger.debug("Routing webhook", { eventName, deliveryId });

		const action = getAction(payload);
		const instId = getInstallationId(payload);
		const eventAction = action ? `${eventName}.${action}` : eventName;

		switch (eventAction) {
			case "issues.assigned":
				return this.routeIssuesAssigned(
					payload as IssuesAssignedPayload,
					instId,
				);

			case "issues.closed":
				return this.routeIssuesClosed(payload as IssuesClosedPayload, instId);

			case "issue_comment.created":
				return this.routeIssueComment(
					payload as IssueCommentCreatedPayload,
					instId,
				);

			case "issue_comment.edited":
				return this.routeIssueComment(
					payload as IssueCommentEditedPayload,
					instId,
				);

			case "pull_request_review_comment.created":
				return this.routePRReviewComment(
					payload as PRReviewCommentCreatedPayload,
					instId,
				);

			case "pull_request_review_comment.edited":
				return this.routePRReviewComment(
					payload as PRReviewCommentEditedPayload,
					instId,
				);

			case "pull_request_review.submitted":
				return this.routePRReviewSubmitted(
					payload as PRReviewSubmittedPayload,
					instId,
				);

			case "workflow_run.completed":
				return this.routeWorkflowRunCompleted(
					payload as WorkflowRunCompletedPayload,
					instId,
				);

			default:
				return {
					dispatched: false,
					reason: `Unhandled event: ${eventAction}`,
				};
		}
	}

	// ── Typed route handlers ────────────────────────────────────────────────

	private routeIssuesAssigned(
		payload: IssuesAssignedPayload,
		instId: number,
	): RouteResult {
		const assignee = payload.assignee;
		if (!assignee || assignee.login !== this.options.agentGithubUsername) {
			return {
				dispatched: false,
				reason: `Skipping: assignee login "${assignee?.login}" does not match agent login`,
			};
		}
		return {
			dispatched: true,
			handler: "create_task",
			installationId: instId,
			context: {
				issueNumber: payload.issue.number,
				issueUrl: payload.issue.html_url,
				repoName: payload.repository.name,
				repoOwner: payload.repository.owner.login,
				senderLogin: payload.sender.login,
				senderId: payload.sender.id,
			},
		};
	}

	private routeIssuesClosed(
		payload: IssuesClosedPayload,
		instId: number,
	): RouteResult {
		return {
			dispatched: true,
			handler: "close_task",
			installationId: instId,
			context: {
				issueNumber: payload.issue.number,
				repoName: payload.repository.name,
				repoOwner: payload.repository.owner.login,
			},
		};
	}

	private routeIssueComment(
		payload: IssueCommentCreatedPayload | IssueCommentEditedPayload,
		instId: number,
	): RouteResult {
		const commentUserLogin = payload.comment.user?.login ?? "";
		const issueUserLogin = payload.issue.user?.login ?? "";

		if (this.ignoredLogins.has(commentUserLogin)) {
			return {
				dispatched: false,
				reason: `Skipping: comment author "${commentUserLogin}" is in ignored logins`,
			};
		}

		// Issue comment on a PR (issue.pull_request is present and non-null)
		// Guard: only forward comments on PRs opened by the agent
		if (payload.issue.pull_request != null) {
			if (issueUserLogin !== this.options.agentGithubUsername) {
				return {
					dispatched: false,
					reason: `Skipping: PR author "${issueUserLogin}" does not match agent login`,
				};
			}
			return {
				dispatched: true,
				handler: "pr_comment",
				installationId: instId,
				context: {
					issueNumber: payload.issue.number,
					commentBody: payload.comment.body,
					commentUrl: payload.comment.html_url,
					commentId: payload.comment.id,
					commentCreatedAt: payload.comment.created_at,
					repoName: payload.repository.name,
					repoOwner: payload.repository.owner.login,
					prAuthor: issueUserLogin,
					commenterLogin: commentUserLogin,
					isReviewComment: false,
					isReviewSubmission: false,
				},
			};
		}

		// Plain issue comment
		return {
			dispatched: true,
			handler: "issue_comment",
			installationId: instId,
			context: {
				issueNumber: payload.issue.number,
				commentBody: payload.comment.body,
				commentUrl: payload.comment.html_url,
				commentId: payload.comment.id,
				commentCreatedAt: payload.comment.created_at,
				repoName: payload.repository.name,
				repoOwner: payload.repository.owner.login,
				commenterLogin: commentUserLogin,
			},
		};
	}

	private routePRReviewComment(
		payload: PRReviewCommentCreatedPayload | PRReviewCommentEditedPayload,
		instId: number,
	): RouteResult {
		const prUserLogin = payload.pull_request.user?.login ?? "";
		const commentUserLogin = payload.comment.user?.login ?? "";

		if (prUserLogin !== this.options.agentGithubUsername) {
			return {
				dispatched: false,
				reason: `Skipping: pull_request.user login "${prUserLogin}" does not match agent login`,
			};
		}

		if (this.ignoredLogins.has(commentUserLogin)) {
			return {
				dispatched: false,
				reason: `Skipping: comment author "${commentUserLogin}" is in ignored logins`,
			};
		}

		return {
			dispatched: true,
			handler: "pr_comment",
			installationId: instId,
			context: {
				issueNumber: payload.pull_request.number,
				commentBody: payload.comment.body,
				commentUrl: payload.comment.html_url,
				commentId: payload.comment.id,
				commentCreatedAt: payload.comment.created_at,
				repoName: payload.repository.name,
				repoOwner: payload.repository.owner.login,
				prAuthor: prUserLogin,
				commenterLogin: commentUserLogin,
				isReviewComment: true,
				isReviewSubmission: false,
			},
		};
	}

	private routePRReviewSubmitted(
		payload: PRReviewSubmittedPayload,
		instId: number,
	): RouteResult {
		const prUserLogin = payload.pull_request.user?.login ?? "";
		const reviewUserLogin = payload.review.user?.login ?? "";

		if (prUserLogin !== this.options.agentGithubUsername) {
			return {
				dispatched: false,
				reason: `Skipping: pull_request.user login "${prUserLogin}" does not match agent login`,
			};
		}

		if (this.ignoredLogins.has(reviewUserLogin)) {
			return {
				dispatched: false,
				reason: `Skipping: review author "${reviewUserLogin}" is in ignored logins`,
			};
		}

		if (!payload.review.body) {
			return {
				dispatched: false,
				reason: "Skipping: review body is empty or null",
			};
		}

		return {
			dispatched: true,
			handler: "pr_comment",
			installationId: instId,
			context: {
				issueNumber: payload.pull_request.number,
				commentBody: payload.review.body,
				commentUrl: payload.review.html_url,
				commentId: payload.review.id,
				commentCreatedAt: payload.review.submitted_at ?? "",
				repoName: payload.repository.name,
				repoOwner: payload.repository.owner.login,
				prAuthor: prUserLogin,
				commenterLogin: reviewUserLogin,
				isReviewComment: false,
				isReviewSubmission: true,
			},
		};
	}

	private routeWorkflowRunCompleted(
		payload: WorkflowRunCompletedPayload,
		instId: number,
	): RouteResult {
		if (payload.workflow_run.conclusion !== "failure") {
			return {
				dispatched: false,
				reason: `Skipping: workflow_run conclusion is "${payload.workflow_run.conclusion}", not "failure"`,
			};
		}

		return {
			dispatched: true,
			handler: "failed_check",
			installationId: instId,
			context: {
				workflowRunId: payload.workflow_run.id,
				workflowName: payload.workflow_run.name,
				workflowPath: payload.workflow_run.path ?? null,
				headSha: payload.workflow_run.head_sha,
				workflowRunUrl: payload.workflow_run.html_url,
				conclusion: payload.workflow_run.conclusion,
				pullRequestNumbers: payload.workflow_run.pull_requests
					.filter((pr): pr is NonNullable<typeof pr> => pr !== null)
					.map((pr) => pr.number),
				repoName: payload.repository.name,
				repoOwner: payload.repository.owner.login,
			},
		};
	}
}
