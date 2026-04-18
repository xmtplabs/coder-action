import type { WebhookEventDefinition } from "@octokit/webhooks/types";

// ── Octokit webhook event types ──────────────────────────────────────────────
//
// Each type corresponds to a specific GitHub webhook event + action pair.
// After signature verification, payloads can be safely cast to these types
// based on the X-GitHub-Event header and the payload's action field.

export type IssuesAssignedPayload = WebhookEventDefinition<"issues-assigned">;
export type IssuesClosedPayload = WebhookEventDefinition<"issues-closed">;
export type IssueCommentCreatedPayload =
	WebhookEventDefinition<"issue-comment-created">;
export type IssueCommentEditedPayload =
	WebhookEventDefinition<"issue-comment-edited">;
export type PRReviewCommentCreatedPayload =
	WebhookEventDefinition<"pull-request-review-comment-created">;
export type PRReviewCommentEditedPayload =
	WebhookEventDefinition<"pull-request-review-comment-edited">;
export type PRReviewSubmittedPayload =
	WebhookEventDefinition<"pull-request-review-submitted">;
export type WorkflowRunCompletedPayload =
	WebhookEventDefinition<"workflow-run-completed">;
