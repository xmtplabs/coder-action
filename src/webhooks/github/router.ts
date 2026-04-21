import type { Logger } from "../../utils/logger";
import type {
	IssuesAssignedPayload,
	IssuesClosedPayload,
	IssueCommentCreatedPayload,
	IssueCommentEditedPayload,
	PRReviewCommentCreatedPayload,
	PRReviewCommentEditedPayload,
	PRReviewSubmittedPayload,
	PushPayload,
	WorkflowRunCompletedPayload,
} from "./payload-types";
import {
	isIgnoredLogin,
	isAssigneeAgent,
	isPrAuthoredByAgent,
	isWorkflowFailure,
	isEmptyReviewBody,
} from "./guards";
import type {
	Event,
	TaskRequestedEvent,
	TaskClosedEvent,
	CommentPostedEvent,
	CheckFailedEvent,
	ConfigPushEvent,
} from "../../events/types";

// ── Public types ──────────────────────────────────────────────────────────────

export type SkipResult = {
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
	constructor(private readonly options: WebhookRouterOptions) {}

	/**
	 * Routes a webhook payload to the appropriate handler based on the
	 * event name and action. Each event.action pair maps directly to a
	 * strongly-typed octokit payload type via type assertion.
	 */
	async handleGithubWebhook(
		eventName: string,
		deliveryId: string,
		payload: unknown,
	): Promise<Event | SkipResult> {
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

			case "push":
				return this.routePush(payload as unknown as PushPayload, instId);

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
	): TaskRequestedEvent | SkipResult {
		const assignee = payload.assignee;
		if (!isAssigneeAgent(payload, this.options.agentGithubUsername)) {
			return {
				dispatched: false,
				reason: `Skipping: assignee login "${assignee?.login}" does not match agent login`,
			};
		}
		const event: TaskRequestedEvent = {
			type: "task_requested",
			source: { type: "github", installationId: instId },
			repository: {
				owner: payload.repository.owner.login,
				name: payload.repository.name,
			},
			issue: {
				id: payload.issue.id,
				number: payload.issue.number,
				url: payload.issue.html_url,
			},
			requester: {
				login: payload.sender.login,
				externalId: payload.sender.id,
			},
		};
		return event;
	}

	private routeIssuesClosed(
		payload: IssuesClosedPayload,
		instId: number,
	): TaskClosedEvent | SkipResult {
		const event: TaskClosedEvent = {
			type: "task_closed",
			source: { type: "github", installationId: instId },
			repository: {
				owner: payload.repository.owner.login,
				name: payload.repository.name,
			},
			issue: {
				number: payload.issue.number,
			},
		};
		return event;
	}

	private routeIssueComment(
		payload: IssueCommentCreatedPayload | IssueCommentEditedPayload,
		instId: number,
	): CommentPostedEvent | SkipResult {
		const commentUserLogin = payload.comment.user?.login ?? "";
		const issueUserLogin = payload.issue.user?.login ?? "";

		if (
			isIgnoredLogin(commentUserLogin, {
				agentLogin: this.options.agentGithubUsername,
				appBotLogin: this.options.appBotLogin,
			})
		) {
			return {
				dispatched: false,
				reason: `Skipping: comment author "${commentUserLogin}" is in ignored logins`,
			};
		}

		// Issue comment on a PR (issue.pull_request is present and non-null)
		// Guard: only forward comments on PRs opened by the agent
		if (payload.issue.pull_request != null) {
			if (
				!isPrAuthoredByAgent(issueUserLogin, this.options.agentGithubUsername)
			) {
				return {
					dispatched: false,
					reason: `Skipping: PR author "${issueUserLogin}" does not match agent login`,
				};
			}
			const event: CommentPostedEvent = {
				type: "comment_posted",
				source: { type: "github", installationId: instId },
				repository: {
					owner: payload.repository.owner.login,
					name: payload.repository.name,
				},
				target: {
					kind: "pull_request",
					number: payload.issue.number,
					authorLogin: issueUserLogin,
				},
				comment: {
					id: payload.comment.id,
					body: payload.comment.body,
					url: payload.comment.html_url,
					createdAt: payload.comment.created_at,
					authorLogin: commentUserLogin,
					isReviewComment: false,
					isReviewSubmission: false,
				},
			};
			return event;
		}

		// Plain issue comment
		const event: CommentPostedEvent = {
			type: "comment_posted",
			source: { type: "github", installationId: instId },
			repository: {
				owner: payload.repository.owner.login,
				name: payload.repository.name,
			},
			target: {
				kind: "issue",
				number: payload.issue.number,
				authorLogin: issueUserLogin,
			},
			comment: {
				id: payload.comment.id,
				body: payload.comment.body,
				url: payload.comment.html_url,
				createdAt: payload.comment.created_at,
				authorLogin: commentUserLogin,
				isReviewComment: false,
				isReviewSubmission: false,
			},
		};
		return event;
	}

	private routePRReviewComment(
		payload: PRReviewCommentCreatedPayload | PRReviewCommentEditedPayload,
		instId: number,
	): CommentPostedEvent | SkipResult {
		const prUserLogin = payload.pull_request.user?.login ?? "";
		const commentUserLogin = payload.comment.user?.login ?? "";

		if (!isPrAuthoredByAgent(prUserLogin, this.options.agentGithubUsername)) {
			return {
				dispatched: false,
				reason: `Skipping: pull_request.user login "${prUserLogin}" does not match agent login`,
			};
		}

		if (
			isIgnoredLogin(commentUserLogin, {
				agentLogin: this.options.agentGithubUsername,
				appBotLogin: this.options.appBotLogin,
			})
		) {
			return {
				dispatched: false,
				reason: `Skipping: comment author "${commentUserLogin}" is in ignored logins`,
			};
		}

		const event: CommentPostedEvent = {
			type: "comment_posted",
			source: { type: "github", installationId: instId },
			repository: {
				owner: payload.repository.owner.login,
				name: payload.repository.name,
			},
			target: {
				kind: "pull_request",
				number: payload.pull_request.number,
				authorLogin: prUserLogin,
			},
			comment: {
				id: payload.comment.id,
				body: payload.comment.body,
				url: payload.comment.html_url,
				createdAt: payload.comment.created_at,
				authorLogin: commentUserLogin,
				isReviewComment: true,
				isReviewSubmission: false,
				filePath: payload.comment.path ?? undefined,
				lineNumber:
					payload.comment.line != null
						? payload.comment.line
						: payload.comment.position != null
							? payload.comment.position
							: undefined,
			},
		};
		return event;
	}

	private routePRReviewSubmitted(
		payload: PRReviewSubmittedPayload,
		instId: number,
	): CommentPostedEvent | SkipResult {
		const prUserLogin = payload.pull_request.user?.login ?? "";
		const reviewUserLogin = payload.review.user?.login ?? "";

		if (!isPrAuthoredByAgent(prUserLogin, this.options.agentGithubUsername)) {
			return {
				dispatched: false,
				reason: `Skipping: pull_request.user login "${prUserLogin}" does not match agent login`,
			};
		}

		if (
			isIgnoredLogin(reviewUserLogin, {
				agentLogin: this.options.agentGithubUsername,
				appBotLogin: this.options.appBotLogin,
			})
		) {
			return {
				dispatched: false,
				reason: `Skipping: review author "${reviewUserLogin}" is in ignored logins`,
			};
		}

		if (isEmptyReviewBody(payload)) {
			return {
				dispatched: false,
				reason: "Skipping: review body is empty or null",
			};
		}

		const event: CommentPostedEvent = {
			type: "comment_posted",
			source: { type: "github", installationId: instId },
			repository: {
				owner: payload.repository.owner.login,
				name: payload.repository.name,
			},
			target: {
				kind: "pull_request",
				number: payload.pull_request.number,
				authorLogin: prUserLogin,
			},
			comment: {
				id: payload.review.id,
				body: payload.review.body ?? "",
				url: payload.review.html_url,
				createdAt: payload.review.submitted_at ?? "",
				authorLogin: reviewUserLogin,
				isReviewComment: false,
				isReviewSubmission: true,
			},
		};
		return event;
	}

	private routeWorkflowRunCompleted(
		payload: WorkflowRunCompletedPayload,
		instId: number,
	): CheckFailedEvent | SkipResult {
		if (!isWorkflowFailure(payload)) {
			return {
				dispatched: false,
				reason: `Skipping: workflow_run conclusion is "${payload.workflow_run.conclusion}", not "failure"`,
			};
		}

		const workflowPath = payload.workflow_run.path ?? null;
		const workflowFile =
			workflowPath != null
				? (workflowPath.split("/").pop() ?? "unknown")
				: "unknown";

		const event: CheckFailedEvent = {
			type: "check_failed",
			source: { type: "github", installationId: instId },
			repository: {
				owner: payload.repository.owner.login,
				name: payload.repository.name,
			},
			run: {
				id: payload.workflow_run.id,
				url: payload.workflow_run.html_url,
				headSha: payload.workflow_run.head_sha,
				workflowName: payload.workflow_run.name ?? "unknown",
				workflowFile,
			},
			pullRequestNumbers: payload.workflow_run.pull_requests
				.filter((pr): pr is NonNullable<typeof pr> => pr !== null)
				.map((pr) => pr.number),
		};
		return event;
	}

	private routePush(
		payload: PushPayload,
		instId: number,
	): ConfigPushEvent | SkipResult {
		const defaultBranch = payload.repository.default_branch;
		const expectedRef = `refs/heads/${defaultBranch}`;
		if (payload.ref !== expectedRef) {
			return {
				dispatched: false,
				reason: `Skipping push: ref "${payload.ref}" is not default branch "${expectedRef}"`,
			};
		}
		const owner = payload.repository.owner;
		const ownerLogin =
			(owner != null && "login" in owner ? owner.login : undefined) ??
			(owner != null && "name" in owner ? owner.name : undefined) ??
			"";
		const event: ConfigPushEvent = {
			type: "config_push",
			source: { type: "github", installationId: instId },
			repository: {
				id: payload.repository.id,
				owner: ownerLogin,
				name: payload.repository.name,
				fullName: payload.repository.full_name,
				defaultBranch,
			},
			head: {
				sha: payload.after,
				ref: payload.ref,
			},
		};
		return event;
	}
}
