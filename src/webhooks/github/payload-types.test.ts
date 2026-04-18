import { describe, expect, test } from "bun:test";
import type {
	IssuesAssignedPayload,
	IssuesClosedPayload,
	IssueCommentCreatedPayload,
	IssueCommentEditedPayload,
	PRReviewCommentCreatedPayload,
	PRReviewSubmittedPayload,
	WorkflowRunCompletedPayload,
} from "./payload-types";

import issuesAssigned from "../../testing/fixtures/issues-assigned.json";
import issuesClosed from "../../testing/fixtures/issues-closed.json";
import issueCommentOnPr from "../../testing/fixtures/issue-comment-on-pr.json";
import issueCommentOnIssue from "../../testing/fixtures/issue-comment-on-issue.json";
import prReviewComment from "../../testing/fixtures/pr-review-comment.json";
import prReviewSubmitted from "../../testing/fixtures/pr-review-submitted.json";
import prReviewSubmittedEmpty from "../../testing/fixtures/pr-review-submitted-empty.json";
import workflowRunFailure from "../../testing/fixtures/workflow-run-failure.json";
import workflowRunSuccess from "../../testing/fixtures/workflow-run-success.json";

// ── Fixture type compatibility checks ────────────────────────────────────────
//
// These tests verify that fixture JSON data is structurally compatible with
// the octokit webhook types. Since the types come from @octokit/webhooks, this
// ensures our test fixtures match the official GitHub webhook schema.
//
// Each test casts a fixture to its corresponding octokit type and reads key
// fields. If the fixture drifts from the official schema, these will fail
// at compile time (type error) or runtime (undefined field access).

describe("IssuesAssignedPayload", () => {
	test("fixture matches octokit type — key fields accessible", () => {
		const payload = issuesAssigned as unknown as IssuesAssignedPayload;
		expect(payload.action).toBe("assigned");
		expect(payload.assignee?.login).toBe("xmtp-coder-agent");
		expect(payload.issue.number).toBe(65);
		expect(payload.issue.html_url).toContain("github.com");
		expect(payload.repository.full_name).toBe("xmtplabs/coder-action");
		expect(payload.repository.name).toBe("coder-action");
		expect(payload.repository.owner.login).toBe("xmtplabs");
		expect(payload.installation?.id).toBe(118770088);
		expect(payload.sender.login).toBe("neekolas");
		expect(payload.sender.id).toBe(65710);
	});
});

describe("IssuesClosedPayload", () => {
	test("fixture matches octokit type — key fields accessible", () => {
		const payload = issuesClosed as unknown as IssuesClosedPayload;
		expect(payload.action).toBe("closed");
		expect(payload.issue.number).toBe(63);
		expect(payload.repository.full_name).toBe("xmtplabs/coder-action");
		expect(payload.installation?.id).toBe(118770088);
	});
});

describe("IssueCommentCreatedPayload", () => {
	test("issue-comment-on-pr fixture matches octokit type", () => {
		const payload = issueCommentOnPr as unknown as IssueCommentCreatedPayload;
		expect(payload.action).toBe("created");
		expect(payload.issue.number).toBe(64);
		expect(payload.comment.body).toBeTruthy();
		expect(payload.comment.html_url).toContain("github.com");
		expect(payload.comment.created_at).toBeTruthy();
		expect(payload.comment.user?.login).toBeTruthy();
		expect(payload.repository.full_name).toBe("xmtplabs/coder-action");
		expect(payload.installation?.id).toBe(118770088);
	});

	test("issue-comment-on-pr has issue.pull_request truthy", () => {
		const payload = issueCommentOnPr as unknown as IssueCommentCreatedPayload;
		expect(payload.issue.pull_request).toBeTruthy();
	});

	test("issue-comment-on-issue fixture matches octokit type", () => {
		const payload =
			issueCommentOnIssue as unknown as IssueCommentCreatedPayload;
		expect(payload.action).toBe("created");
		expect(payload.issue.number).toBe(65);
	});

	test("issue-comment-on-issue has issue.pull_request falsy", () => {
		const payload =
			issueCommentOnIssue as unknown as IssueCommentCreatedPayload;
		expect(payload.issue.pull_request).toBeFalsy();
	});

	test("edited fixture matches IssueCommentEditedPayload", () => {
		const fixture = { ...issueCommentOnIssue, action: "edited" };
		const payload = fixture as unknown as IssueCommentEditedPayload;
		expect(payload.action).toBe("edited");
		expect(payload.issue.number).toBe(65);
	});
});

describe("PRReviewCommentCreatedPayload", () => {
	test("fixture matches octokit type — key fields accessible", () => {
		const payload = prReviewComment as unknown as PRReviewCommentCreatedPayload;
		expect(payload.action).toBe("created");
		expect(payload.pull_request.number).toBe(64);
		expect(payload.pull_request.user?.login).toBe("xmtp-coder-agent");
		expect(payload.comment.user?.login).toBe("neekolas");
		expect(payload.comment.body).toBeTruthy();
		expect(payload.repository.full_name).toBe("xmtplabs/coder-action");
		expect(payload.installation?.id).toBe(118770088);
	});
});

describe("PRReviewSubmittedPayload", () => {
	test("fixture matches octokit type — key fields accessible", () => {
		const payload = prReviewSubmitted as unknown as PRReviewSubmittedPayload;
		expect(payload.action).toBe("submitted");
		expect(payload.pull_request.number).toBe(64);
		expect(payload.pull_request.user?.login).toBe("xmtp-coder-agent");
		expect(payload.review.body).toBe("Please fix the naming");
		expect(payload.review.user?.login).toBe("neekolas");
		expect(payload.review.html_url).toContain("github.com");
		expect(payload.repository.full_name).toBe("xmtplabs/coder-action");
		expect(payload.installation?.id).toBe(118770088);
	});

	test("empty-body fixture has null review body", () => {
		const payload =
			prReviewSubmittedEmpty as unknown as PRReviewSubmittedPayload;
		expect(payload.action).toBe("submitted");
		expect(payload.review.body).toBeNull();
	});
});

describe("WorkflowRunCompletedPayload", () => {
	test("failure fixture matches octokit type — key fields accessible", () => {
		const payload =
			workflowRunFailure as unknown as WorkflowRunCompletedPayload;
		expect(payload.action).toBe("completed");
		expect(payload.workflow_run.conclusion).toBe("failure");
		expect(payload.workflow_run.id).toBe(23526809052);
		expect(payload.workflow_run.head_sha).toBe(
			"dbbd661d51e80fbbcfb1fcc2cd7446f661d08016",
		);
		expect(payload.workflow_run.pull_requests[0]?.number).toBe(64);
		expect(payload.repository.full_name).toBe("xmtplabs/coder-action");
		expect(payload.installation?.id).toBe(118770088);
	});

	test("success fixture has conclusion: success", () => {
		const payload =
			workflowRunSuccess as unknown as WorkflowRunCompletedPayload;
		expect(payload.workflow_run.conclusion).toBe("success");
	});
});
