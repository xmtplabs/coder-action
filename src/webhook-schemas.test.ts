import { describe, expect, test } from "bun:test";
import {
	IssueCommentCreatedPayloadSchema,
	IssuesAssignedPayloadSchema,
	IssuesClosedPayloadSchema,
	PRReviewCommentCreatedPayloadSchema,
	PRReviewSubmittedPayloadSchema,
	WorkflowRunCompletedPayloadSchema,
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

describe("IssuesAssignedPayloadSchema", () => {
	test("parses issues-assigned fixture", () => {
		const result = IssuesAssignedPayloadSchema.parse(issuesAssigned);
		expect(result.action).toBe("assigned");
		expect(result.assignee.login).toBe("xmtp-coder-agent");
		expect(result.issue.number).toBe(65);
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation.id).toBe(118770088);
		expect(result.sender.login).toBe("neekolas");
	});

	test("rejects fixture with missing required field", () => {
		const { action: _action, ...withoutAction } = issuesAssigned;
		expect(() => IssuesAssignedPayloadSchema.parse(withoutAction)).toThrow();
	});

	test("accepts fixture with extra fields (passthrough)", () => {
		const withExtra = { ...issuesAssigned, extra_field: "should be allowed" };
		const result = IssuesAssignedPayloadSchema.parse(withExtra);
		expect((result as Record<string, unknown>).extra_field).toBe(
			"should be allowed",
		);
	});
});

describe("IssuesClosedPayloadSchema", () => {
	test("parses issues-closed fixture", () => {
		const result = IssuesClosedPayloadSchema.parse(issuesClosed);
		expect(result.action).toBe("closed");
		expect(result.issue.number).toBe(63);
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation.id).toBe(118770088);
	});

	test("rejects fixture with missing required field", () => {
		const { action: _action, ...withoutAction } = issuesClosed;
		expect(() => IssuesClosedPayloadSchema.parse(withoutAction)).toThrow();
	});
});

describe("IssueCommentCreatedPayloadSchema", () => {
	test("parses issue-comment-on-pr fixture", () => {
		const result = IssueCommentCreatedPayloadSchema.parse(issueCommentOnPr);
		expect(result.action).toBe("created");
		expect(result.issue.number).toBe(64);
		expect(result.comment.body).toBeTruthy();
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation.id).toBe(118770088);
	});

	test("issue-comment-on-pr has issue.pull_request truthy", () => {
		const result = IssueCommentCreatedPayloadSchema.parse(issueCommentOnPr);
		expect(result.issue.pull_request).toBeTruthy();
	});

	test("parses issue-comment-on-issue fixture", () => {
		const result = IssueCommentCreatedPayloadSchema.parse(issueCommentOnIssue);
		expect(result.action).toBe("created");
		expect(result.issue.number).toBe(65);
	});

	test("issue-comment-on-issue has issue.pull_request falsy", () => {
		const result = IssueCommentCreatedPayloadSchema.parse(issueCommentOnIssue);
		expect(result.issue.pull_request).toBeFalsy();
	});

	test("rejects fixture with missing required field", () => {
		const { action: _action, ...withoutAction } = issueCommentOnPr;
		expect(() =>
			IssueCommentCreatedPayloadSchema.parse(withoutAction),
		).toThrow();
	});

	test("accepts fixture with extra fields (passthrough)", () => {
		const withExtra = { ...issueCommentOnPr, extra_field: "allowed" };
		const result = IssueCommentCreatedPayloadSchema.parse(withExtra);
		expect((result as Record<string, unknown>).extra_field).toBe("allowed");
	});
});

describe("PRReviewCommentCreatedPayloadSchema", () => {
	test("parses pr-review-comment fixture", () => {
		const result = PRReviewCommentCreatedPayloadSchema.parse(prReviewComment);
		expect(result.action).toBe("created");
		expect(result.pull_request.number).toBe(64);
		expect(result.pull_request.user.login).toBe("xmtp-coder-agent");
		expect(result.comment.user.login).toBe("neekolas");
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation.id).toBe(118770088);
	});

	test("rejects fixture with missing required field", () => {
		const { action: _action, ...withoutAction } = prReviewComment;
		expect(() =>
			PRReviewCommentCreatedPayloadSchema.parse(withoutAction),
		).toThrow();
	});
});

describe("PRReviewSubmittedPayloadSchema", () => {
	test("parses pr-review-submitted fixture", () => {
		const result = PRReviewSubmittedPayloadSchema.parse(prReviewSubmitted);
		expect(result.action).toBe("submitted");
		expect(result.pull_request.number).toBe(64);
		expect(result.pull_request.user.login).toBe("xmtp-coder-agent");
		expect(result.review.body).toBe("Please fix the naming");
		expect(result.review.user.login).toBe("neekolas");
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation.id).toBe(118770088);
	});

	test("parses pr-review-submitted-empty fixture (null body)", () => {
		const result = PRReviewSubmittedPayloadSchema.parse(prReviewSubmittedEmpty);
		expect(result.action).toBe("submitted");
		expect(result.review.body).toBeNull();
	});

	test("rejects fixture with missing required field", () => {
		const { action: _action, ...withoutAction } = prReviewSubmitted;
		expect(() => PRReviewSubmittedPayloadSchema.parse(withoutAction)).toThrow();
	});
});

describe("WorkflowRunCompletedPayloadSchema", () => {
	test("parses workflow-run-failure fixture", () => {
		const result = WorkflowRunCompletedPayloadSchema.parse(workflowRunFailure);
		expect(result.action).toBe("completed");
		expect(result.workflow_run.conclusion).toBe("failure");
		expect(result.workflow_run.head_sha).toBe(
			"dbbd661d51e80fbbcfb1fcc2cd7446f661d08016",
		);
		expect(result.workflow_run.pull_requests[0]?.number).toBe(64);
		expect(result.repository.full_name).toBe("xmtplabs/coder-action");
		expect(result.installation.id).toBe(118770088);
	});

	test("workflow-run-failure has conclusion: failure", () => {
		const result = WorkflowRunCompletedPayloadSchema.parse(workflowRunFailure);
		expect(result.workflow_run.conclusion).toBe("failure");
	});

	test("parses workflow-run-success fixture", () => {
		const result = WorkflowRunCompletedPayloadSchema.parse(workflowRunSuccess);
		expect(result.workflow_run.conclusion).toBe("success");
	});

	test("workflow-run-success has conclusion: success", () => {
		const result = WorkflowRunCompletedPayloadSchema.parse(workflowRunSuccess);
		expect(result.workflow_run.conclusion).toBe("success");
	});

	test("rejects fixture with missing required field", () => {
		const { action: _action, ...withoutAction } = workflowRunFailure;
		expect(() =>
			WorkflowRunCompletedPayloadSchema.parse(withoutAction),
		).toThrow();
	});

	test("accepts fixture with extra fields (passthrough)", () => {
		const withExtra = { ...workflowRunFailure, extra_field: "allowed" };
		const result = WorkflowRunCompletedPayloadSchema.parse(withExtra);
		expect((result as Record<string, unknown>).extra_field).toBe("allowed");
	});
});
