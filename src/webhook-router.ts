import type { Logger } from "./logger";
import {
	parseIssuesAssigned,
	parseIssuesClosed,
	parseIssueComment,
	parsePRReviewComment,
	parsePRReviewSubmitted,
	parseWorkflowRunCompleted,
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

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Extracts installation.id from a parsed webhook payload.
 * The parse functions already verify installation.id exists, so this
 * provides a safe accessor without non-null assertions.
 */
function installationId(payload: {
	installation?: { id: number } | null;
}): number {
	return payload.installation?.id ?? 0;
}

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
		const assigned = parseIssuesAssigned(payload);
		if (assigned) {
			const assignee = assigned.assignee;
			if (!assignee || assignee.login !== this.options.agentGithubUsername) {
				return {
					dispatched: false,
					reason: `Skipping: assignee login "${assignee?.login}" does not match agent login`,
				};
			}
			return {
				dispatched: true,
				handler: "create_task",
				installationId: installationId(assigned),
				context: {
					issueNumber: assigned.issue.number,
					issueUrl: assigned.issue.html_url,
					repoName: assigned.repository.name,
					repoOwner: assigned.repository.owner.login,
					senderLogin: assigned.sender.login,
					senderId: assigned.sender.id,
				},
			};
		}

		// Try "closed"
		const closed = parseIssuesClosed(payload);
		if (closed) {
			return {
				dispatched: true,
				handler: "close_task",
				installationId: installationId(closed),
				context: {
					issueNumber: closed.issue.number,
					repoName: closed.repository.name,
					repoOwner: closed.repository.owner.login,
				},
			};
		}

		return { dispatched: false, reason: "Unhandled issues action" };
	}

	private routeIssueComment(payload: unknown): RouteResult {
		const parsed = parseIssueComment(payload);
		if (!parsed) {
			return {
				dispatched: false,
				reason: "Failed to parse issue_comment payload",
				validationError: true,
			};
		}

		const { action, issue, comment, repository } = parsed;
		const instId = installationId(parsed);
		const commentUserLogin = comment.user?.login ?? "";
		const issueUserLogin = issue.user?.login ?? "";

		// Only handle created and edited actions
		if (action !== "created" && action !== "edited") {
			return {
				dispatched: false,
				reason: `Unhandled issue_comment action: ${action}`,
			};
		}

		if (this.ignoredLogins.has(commentUserLogin)) {
			return {
				dispatched: false,
				reason: `Skipping: comment author "${commentUserLogin}" is in ignored logins`,
			};
		}

		// Issue comment on a PR (issue.pull_request is present and non-null)
		// Guard: only forward comments on PRs opened by the agent
		if (issue.pull_request != null) {
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
					issueNumber: issue.number,
					commentBody: comment.body,
					commentUrl: comment.html_url,
					commentId: comment.id,
					commentCreatedAt: comment.created_at,
					repoName: repository.name,
					repoOwner: repository.owner.login,
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
				issueNumber: issue.number,
				commentBody: comment.body,
				commentUrl: comment.html_url,
				commentId: comment.id,
				commentCreatedAt: comment.created_at,
				repoName: repository.name,
				repoOwner: repository.owner.login,
				commenterLogin: commentUserLogin,
			},
		};
	}

	private routePRReviewComment(payload: unknown): RouteResult {
		const parsed = parsePRReviewComment(payload);
		if (!parsed) {
			return {
				dispatched: false,
				reason: "Failed to parse pull_request_review_comment payload",
				validationError: true,
			};
		}

		const { action, pull_request, comment, repository } = parsed;
		const instId = installationId(parsed);
		const prUserLogin = pull_request.user?.login ?? "";
		const commentUserLogin = comment.user?.login ?? "";

		// Only handle created and edited actions
		if (action !== "created" && action !== "edited") {
			return {
				dispatched: false,
				reason: `Unhandled pull_request_review_comment action: ${action}`,
			};
		}

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
				issueNumber: pull_request.number,
				commentBody: comment.body,
				commentUrl: comment.html_url,
				commentId: comment.id,
				commentCreatedAt: comment.created_at,
				repoName: repository.name,
				repoOwner: repository.owner.login,
				prAuthor: prUserLogin,
				commenterLogin: commentUserLogin,
				isReviewComment: true,
				isReviewSubmission: false,
			},
		};
	}

	private routePRReview(payload: unknown): RouteResult {
		const parsed = parsePRReviewSubmitted(payload);
		if (!parsed) {
			return {
				dispatched: false,
				reason: "Failed to parse pull_request_review payload",
				validationError: true,
			};
		}

		const { pull_request, review, repository } = parsed;
		const instId = installationId(parsed);
		const prUserLogin = pull_request.user?.login ?? "";
		const reviewUserLogin = review.user?.login ?? "";

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

		if (!review.body) {
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
				issueNumber: pull_request.number,
				commentBody: review.body,
				commentUrl: review.html_url,
				commentId: review.id,
				commentCreatedAt: review.submitted_at ?? "",
				repoName: repository.name,
				repoOwner: repository.owner.login,
				prAuthor: prUserLogin,
				commenterLogin: reviewUserLogin,
				isReviewComment: false,
				isReviewSubmission: true,
			},
		};
	}

	private routeWorkflowRun(payload: unknown): RouteResult {
		const parsed = parseWorkflowRunCompleted(payload);
		if (!parsed) {
			return {
				dispatched: false,
				reason: "Failed to parse workflow_run payload",
				validationError: true,
			};
		}

		const { workflow_run, repository } = parsed;
		const instId = installationId(parsed);

		if (workflow_run.conclusion !== "failure") {
			return {
				dispatched: false,
				reason: `Skipping: workflow_run conclusion is "${workflow_run.conclusion}", not "failure"`,
			};
		}

		return {
			dispatched: true,
			handler: "failed_check",
			installationId: instId,
			context: {
				workflowRunId: workflow_run.id,
				workflowName: workflow_run.name,
				workflowPath: workflow_run.path ?? null,
				headSha: workflow_run.head_sha,
				workflowRunUrl: workflow_run.html_url,
				conclusion: workflow_run.conclusion,
				pullRequestNumbers: workflow_run.pull_requests
					.filter((pr): pr is NonNullable<typeof pr> => pr !== null)
					.map((pr) => pr.number),
				repoName: repository.name,
				repoOwner: repository.owner.login,
			},
		};
	}
}
