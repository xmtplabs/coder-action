import type { WebhookEventDefinition } from "@octokit/webhooks/types";

// ── Octokit webhook event types ──────────────────────────────────────────────

export type IssuesAssignedPayload = WebhookEventDefinition<"issues-assigned">;
export type IssuesClosedPayload = WebhookEventDefinition<"issues-closed">;
export type IssueCommentCreatedPayload =
	| WebhookEventDefinition<"issue-comment-created">
	| WebhookEventDefinition<"issue-comment-edited">;
export type PRReviewCommentCreatedPayload =
	| WebhookEventDefinition<"pull-request-review-comment-created">
	| WebhookEventDefinition<"pull-request-review-comment-edited">;
export type PRReviewSubmittedPayload =
	WebhookEventDefinition<"pull-request-review-submitted">;
export type WorkflowRunCompletedPayload =
	WebhookEventDefinition<"workflow-run-completed">;

// ── Type-narrowing helpers ───────────────────────────────────────────────────
//
// After webhook signature verification, the payload is guaranteed to come from
// GitHub. These functions check the `action` field to narrow to specific event
// types and verify that required fields (like `installation`) are present.

function hasFields(
	payload: unknown,
	action: string | string[],
): payload is Record<string, unknown> {
	if (typeof payload !== "object" || payload === null) return false;
	const obj = payload as Record<string, unknown>;
	const actions = Array.isArray(action) ? action : [action];
	if (!actions.includes(obj.action as string)) return false;
	if (
		typeof obj.installation !== "object" ||
		obj.installation === null ||
		typeof (obj.installation as Record<string, unknown>).id !== "number"
	) {
		return false;
	}
	return true;
}

export function parseIssuesAssigned(
	payload: unknown,
): IssuesAssignedPayload | null {
	if (!hasFields(payload, "assigned")) return null;
	return payload as IssuesAssignedPayload;
}

export function parseIssuesClosed(
	payload: unknown,
): IssuesClosedPayload | null {
	if (!hasFields(payload, "closed")) return null;
	return payload as IssuesClosedPayload;
}

export function parseIssueComment(
	payload: unknown,
): IssueCommentCreatedPayload | null {
	if (!hasFields(payload, ["created", "edited", "deleted"])) return null;
	return payload as IssueCommentCreatedPayload;
}

export function parsePRReviewComment(
	payload: unknown,
): PRReviewCommentCreatedPayload | null {
	if (!hasFields(payload, ["created", "edited", "deleted"])) return null;
	return payload as PRReviewCommentCreatedPayload;
}

export function parsePRReviewSubmitted(
	payload: unknown,
): PRReviewSubmittedPayload | null {
	if (!hasFields(payload, "submitted")) return null;
	return payload as PRReviewSubmittedPayload;
}

export function parseWorkflowRunCompleted(
	payload: unknown,
): WorkflowRunCompletedPayload | null {
	if (!hasFields(payload, "completed")) return null;
	return payload as WorkflowRunCompletedPayload;
}
