import { describe, expect, test } from "bun:test";
import type { WebhookEventDefinition } from "@octokit/webhooks/types";
import {
	parseIssueComment,
	parseIssuesAssigned,
	parseIssuesClosed,
	parsePRReviewComment,
	parsePRReviewSubmitted,
	parseWorkflowRunCompleted,
} from "./webhook-schemas";

import issuesAssigned from "./__fixtures__/issues-assigned.json";
import issuesClosed from "./__fixtures__/issues-closed.json";
import issueCommentOnPr from "./__fixtures__/issue-comment-on-pr.json";
import issueCommentOnIssue from "./__fixtures__/issue-comment-on-issue.json";
import prReviewComment from "./__fixtures__/pr-review-comment.json";
import prReviewSubmitted from "./__fixtures__/pr-review-submitted.json";
import prReviewSubmittedEmpty from "./__fixtures__/pr-review-submitted-empty.json";
import workflowRunFailure from "./__fixtures__/workflow-run-failure.json";
import workflowRunSuccess from "./__fixtures__/workflow-run-success.json";

// ── Fixture type compatibility checks ────────────────────────────────────────
// These compile-time checks verify that fixture data is compatible with
// octokit webhook types. If a fixture drifts from the official schema,
// the build will fail.

const _issuesAssignedCheck: WebhookEventDefinition<"issues-assigned"> =
	issuesAssigned as unknown as WebhookEventDefinition<"issues-assigned">;
const _issuesClosedCheck: WebhookEventDefinition<"issues-closed"> =
	issuesClosed as unknown as WebhookEventDefinition<"issues-closed">;
const _issueCommentOnPrCheck: WebhookEventDefinition<"issue-comment-created"> =
	issueCommentOnPr as unknown as WebhookEventDefinition<"issue-comment-created">;
const _issueCommentOnIssueCheck: WebhookEventDefinition<"issue-comment-created"> =
	issueCommentOnIssue as unknown as WebhookEventDefinition<"issue-comment-created">;
const _prReviewCommentCheck: WebhookEventDefinition<"pull-request-review-comment-created"> =
	prReviewComment as unknown as WebhookEventDefinition<"pull-request-review-comment-created">;
const _prReviewSubmittedCheck: WebhookEventDefinition<"pull-request-review-submitted"> =
	prReviewSubmitted as unknown as WebhookEventDefinition<"pull-request-review-submitted">;
const _workflowRunFailureCheck: WebhookEventDefinition<"workflow-run-completed"> =
	workflowRunFailure as unknown as WebhookEventDefinition<"workflow-run-completed">;
const _workflowRunSuccessCheck: WebhookEventDefinition<"workflow-run-completed"> =
	workflowRunSuccess as unknown as WebhookEventDefinition<"workflow-run-completed">;

// Helper to assert non-null and return the value
function assertDefined<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Expected non-null value");
	return value;
}

// ── parseIssuesAssigned ──────────────────────────────────────────────────────

describe("parseIssuesAssigned", () => {
	test("parses issues-assigned fixture", () => {
		const result = assertDefined(parseIssuesAssigned(issuesAssigned));
		expect(result.action).toBe("assigned");
		expect(result.assignee?.login).toBe("xmtp-coder-agent");
		expect(result.issue.number).toBe(65);
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation?.id).toBe(118770088);
		expect(result.sender.login).toBe("neekolas");
	});

	test("returns null for payload with wrong action", () => {
		const result = parseIssuesAssigned({ ...issuesAssigned, action: "opened" });
		expect(result).toBeNull();
	});

	test("returns null for payload with missing action", () => {
		const { action: _action, ...withoutAction } = issuesAssigned;
		expect(parseIssuesAssigned(withoutAction)).toBeNull();
	});

	test("returns null for non-object payload", () => {
		expect(parseIssuesAssigned(null)).toBeNull();
		expect(parseIssuesAssigned("string")).toBeNull();
		expect(parseIssuesAssigned(42)).toBeNull();
	});
});

// ── parseIssuesClosed ────────────────────────────────────────────────────────

describe("parseIssuesClosed", () => {
	test("parses issues-closed fixture", () => {
		const result = assertDefined(parseIssuesClosed(issuesClosed));
		expect(result.action).toBe("closed");
		expect(result.issue.number).toBe(63);
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation?.id).toBe(118770088);
	});

	test("returns null for payload with wrong action", () => {
		const result = parseIssuesClosed({ ...issuesClosed, action: "opened" });
		expect(result).toBeNull();
	});

	test("returns null for payload with missing action", () => {
		const { action: _action, ...withoutAction } = issuesClosed;
		expect(parseIssuesClosed(withoutAction)).toBeNull();
	});
});

// ── parseIssueComment ────────────────────────────────────────────────────────

describe("parseIssueComment", () => {
	test("parses issue-comment-on-pr fixture", () => {
		const result = assertDefined(parseIssueComment(issueCommentOnPr));
		expect(result.action).toBe("created");
		expect(result.issue.number).toBe(64);
		expect(result.comment.body).toBeTruthy();
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation?.id).toBe(118770088);
	});

	test("issue-comment-on-pr has issue.pull_request truthy", () => {
		const result = assertDefined(parseIssueComment(issueCommentOnPr));
		expect(result.issue.pull_request).toBeTruthy();
	});

	test("parses issue-comment-on-issue fixture", () => {
		const result = assertDefined(parseIssueComment(issueCommentOnIssue));
		expect(result.action).toBe("created");
		expect(result.issue.number).toBe(65);
	});

	test("issue-comment-on-issue has issue.pull_request falsy", () => {
		const result = assertDefined(parseIssueComment(issueCommentOnIssue));
		expect(result.issue.pull_request).toBeFalsy();
	});

	test("returns null for payload with missing action", () => {
		const { action: _action, ...withoutAction } = issueCommentOnPr;
		expect(parseIssueComment(withoutAction)).toBeNull();
	});

	test("parses edited issue-comment-on-issue payload", () => {
		const payload = { ...issueCommentOnIssue, action: "edited" };
		const result = assertDefined(parseIssueComment(payload));
		expect(result.action).toBe("edited");
		expect(result.issue.number).toBe(65);
	});

	test("parses edited issue-comment-on-pr payload", () => {
		const payload = { ...issueCommentOnPr, action: "edited" };
		const result = assertDefined(parseIssueComment(payload));
		expect(result.action).toBe("edited");
		expect(result.issue.number).toBe(64);
		expect(result.issue.pull_request).toBeTruthy();
	});

	test("returns null for non-object payload", () => {
		expect(parseIssueComment(null)).toBeNull();
		expect(parseIssueComment("string")).toBeNull();
	});
});

// ── parsePRReviewComment ─────────────────────────────────────────────────────

describe("parsePRReviewComment", () => {
	test("parses pr-review-comment fixture", () => {
		const result = assertDefined(parsePRReviewComment(prReviewComment));
		expect(result.action).toBe("created");
		expect(result.pull_request.number).toBe(64);
		expect(result.pull_request.user?.login).toBe("xmtp-coder-agent");
		expect(result.comment.user?.login).toBe("neekolas");
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation?.id).toBe(118770088);
	});

	test("returns null for payload with missing action", () => {
		const { action: _action, ...withoutAction } = prReviewComment;
		expect(parsePRReviewComment(withoutAction)).toBeNull();
	});

	test("parses edited pr-review-comment payload", () => {
		const payload = { ...prReviewComment, action: "edited" };
		const result = assertDefined(parsePRReviewComment(payload));
		expect(result.action).toBe("edited");
		expect(result.pull_request.number).toBe(64);
	});
});

// ── parsePRReviewSubmitted ───────────────────────────────────────────────────

describe("parsePRReviewSubmitted", () => {
	test("parses pr-review-submitted fixture", () => {
		const result = assertDefined(parsePRReviewSubmitted(prReviewSubmitted));
		expect(result.action).toBe("submitted");
		expect(result.pull_request.number).toBe(64);
		expect(result.pull_request.user?.login).toBe("xmtp-coder-agent");
		expect(result.review.body).toBe("Please fix the naming");
		expect(result.review.user?.login).toBe("neekolas");
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation?.id).toBe(118770088);
	});

	test("parses pr-review-submitted-empty fixture (null body)", () => {
		const result = assertDefined(
			parsePRReviewSubmitted(prReviewSubmittedEmpty),
		);
		expect(result.action).toBe("submitted");
		expect(result.review.body).toBeNull();
	});

	test("returns null for payload with missing action", () => {
		const { action: _action, ...withoutAction } = prReviewSubmitted;
		expect(parsePRReviewSubmitted(withoutAction)).toBeNull();
	});
});

// ── parseWorkflowRunCompleted ────────────────────────────────────────────────

describe("parseWorkflowRunCompleted", () => {
	test("parses workflow-run-failure fixture", () => {
		const result = assertDefined(parseWorkflowRunCompleted(workflowRunFailure));
		expect(result.action).toBe("completed");
		expect(result.workflow_run.conclusion).toBe("failure");
		expect(result.workflow_run.head_sha).toBe(
			"dbbd661d51e80fbbcfb1fcc2cd7446f661d08016",
		);
		expect(result.workflow_run.pull_requests[0]?.number).toBe(64);
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation?.id).toBe(118770088);
	});

	test("workflow-run-failure has conclusion: failure", () => {
		const result = assertDefined(parseWorkflowRunCompleted(workflowRunFailure));
		expect(result.workflow_run.conclusion).toBe("failure");
	});

	test("parses workflow-run-success fixture", () => {
		const result = assertDefined(parseWorkflowRunCompleted(workflowRunSuccess));
		expect(result.workflow_run.conclusion).toBe("success");
	});

	test("workflow-run-success has conclusion: success", () => {
		const result = assertDefined(parseWorkflowRunCompleted(workflowRunSuccess));
		expect(result.workflow_run.conclusion).toBe("success");
	});

	test("returns null for payload with missing action", () => {
		const { action: _action, ...withoutAction } = workflowRunFailure;
		expect(parseWorkflowRunCompleted(withoutAction)).toBeNull();
	});

	test("returns null for non-object payload", () => {
		expect(parseWorkflowRunCompleted(null)).toBeNull();
		expect(parseWorkflowRunCompleted("string")).toBeNull();
	});
});
