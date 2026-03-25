import { describe, test, expect, beforeEach } from "bun:test";
import { WebhookRouter } from "./webhook-router";
import type { WebhookRouterOptions } from "./webhook-router";
import type { Logger } from "./logger";

import issuesAssigned from "./__fixtures__/issues-assigned.json";
import issuesClosed from "./__fixtures__/issues-closed.json";
import issueCommentOnIssue from "./__fixtures__/issue-comment-on-issue.json";
import issueCommentOnPr from "./__fixtures__/issue-comment-on-pr.json";
import issueCommentEditedOnIssue from "./__fixtures__/issue-comment-edited-on-issue.json";
import issueCommentEditedOnPr from "./__fixtures__/issue-comment-edited-on-pr.json";
import prReviewComment from "./__fixtures__/pr-review-comment.json";
import prReviewCommentEdited from "./__fixtures__/pr-review-comment-edited.json";
import prReviewSubmitted from "./__fixtures__/pr-review-submitted.json";
import prReviewSubmittedEmpty from "./__fixtures__/pr-review-submitted-empty.json";
import workflowRunFailure from "./__fixtures__/workflow-run-failure.json";
import workflowRunSuccess from "./__fixtures__/workflow-run-success.json";

// These constants must match the fixture data
const AGENT_USER_LOGIN = "xmtp-coder-agent";
const APP_BOT_LOGIN = "xmtp-coder-tasks[bot]";
const INSTALLATION_ID = 118770088;

const noopLogger: Logger = {
	info: () => {},
	debug: () => {},
	warn: () => {},
	error: () => {},
	child: () => noopLogger,
};

function makeRouter(overrides?: Partial<WebhookRouterOptions>): WebhookRouter {
	return new WebhookRouter({
		agentGithubUsername: AGENT_USER_LOGIN,
		appBotLogin: APP_BOT_LOGIN,
		logger: noopLogger,
		...overrides,
	});
}

describe("WebhookRouter", () => {
	let router: WebhookRouter;

	beforeEach(() => {
		router = makeRouter();
	});

	// ── issues.assigned ────────────────────────────────────────────────────────

	test("issues.assigned with matching agent login → dispatched as create_task", async () => {
		const result = await router.handleWebhook(
			"issues",
			"delivery-001",
			issuesAssigned,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("create_task");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.issueNumber).toBe(65);
		expect(result.context.issueUrl).toBe(
			"https://github.com/xmtplabs/coder-action/issues/65",
		);
		expect(result.context.repoName).toBe("coder-action");
		expect(result.context.repoOwner).toBe("xmtplabs");
		// senderLogin and senderId must be present for permission checks and
		// Coder username resolution
		expect(result.context.senderLogin).toBe("neekolas");
		expect(result.context.senderId).toBe(65710);
	});

	test("issues.assigned with non-matching assignee login → skipped", async () => {
		const payload = {
			...issuesAssigned,
			assignee: { login: "other-user", id: 99 },
		};
		const result = await router.handleWebhook(
			"issues",
			"delivery-002",
			payload,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/assignee/i);
	});

	// ── issues.closed ──────────────────────────────────────────────────────────

	test("issues.closed → dispatched as close_task", async () => {
		const result = await router.handleWebhook(
			"issues",
			"delivery-003",
			issuesClosed,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("close_task");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.issueNumber).toBe(63);
		expect(result.context.repoName).toBe("coder-action");
		expect(result.context.repoOwner).toBe("xmtplabs");
	});

	// ── issue_comment.created — self-comment suppression ──────────────────────

	test("issue_comment.created, comment from app bot → skipped", async () => {
		const payload = {
			...issueCommentOnIssue,
			comment: {
				...issueCommentOnIssue.comment,
				user: { login: APP_BOT_LOGIN },
			},
		};
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-004",
			payload,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/ignored/i);
	});

	test("issue_comment.created, comment from agent PAT user → skipped", async () => {
		const payload = {
			...issueCommentOnIssue,
			comment: {
				...issueCommentOnIssue.comment,
				user: { login: AGENT_USER_LOGIN },
			},
		};
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-005",
			payload,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/ignored/i);
	});

	// ── issue_comment.created — dispatch ──────────────────────────────────────

	test("issue_comment.created on issue from human → dispatched as issue_comment", async () => {
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-006",
			issueCommentOnIssue,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("issue_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.issueNumber).toBe(65);
		expect(result.context.commentBody).toBe(
			"Can you also handle the edge case for empty inputs?",
		);
		expect(result.context.commentUrl).toBe(
			"https://github.com/xmtplabs/coder-action/issues/65#issuecomment-4123912472",
		);
		expect(result.context.repoName).toBe("coder-action");
		expect(result.context.repoOwner).toBe("xmtplabs");
	});

	test("issue_comment.created on PR where PR author is not agent → skipped", async () => {
		const payload = {
			...issueCommentOnPr,
			issue: {
				...issueCommentOnPr.issue,
				user: { login: "some-other-user" },
			},
		};
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-007a",
			payload,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/PR author/i);
	});

	// ── issue_comment.edited — dispatch ─────────────────────────────────────

	test("issue_comment.edited on issue from human → dispatched as issue_comment", async () => {
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-006a",
			issueCommentEditedOnIssue,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("issue_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.issueNumber).toBe(42);
		expect(result.context.commentBody).toContain("(updated)");
	});

	test("issue_comment.edited on PR from human → dispatched as pr_comment", async () => {
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-006b",
			issueCommentEditedOnPr,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("pr_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.issueNumber).toBe(5);
		expect(result.context.commentBody).toContain("(updated)");
	});

	test("issue_comment.deleted → skipped without validation error", async () => {
		const payload = {
			...issueCommentOnIssue,
			action: "deleted",
		};
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-006c",
			payload,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/unhandled/i);
		expect(result.validationError).toBeUndefined();
	});

	test("issue_comment.created on PR from human → dispatched as pr_comment", async () => {
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-007",
			issueCommentOnPr,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("pr_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.issueNumber).toBe(64);
		expect(result.context.commentBody).toBe(
			"Looks good, but please fix the naming.",
		);
		expect(result.context.isReviewComment).toBe(false);
		expect(result.context.isReviewSubmission).toBe(false);
		expect(result.context.repoName).toBe("coder-action");
		expect(result.context.repoOwner).toBe("xmtplabs");
	});

	// ── pull_request_review_comment.created ───────────────────────────────────

	test("pull_request_review_comment.created, PR by agent, comment by human → dispatched as pr_comment with isReviewComment", async () => {
		const result = await router.handleWebhook(
			"pull_request_review_comment",
			"delivery-008",
			prReviewComment,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("pr_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.issueNumber).toBe(64);
		expect(result.context.commentBody).toBe("Why didn't you respond to this?");
		expect(result.context.isReviewComment).toBe(true);
		expect(result.context.isReviewSubmission).toBe(false);
		expect(result.context.repoName).toBe("coder-action");
		expect(result.context.repoOwner).toBe("xmtplabs");
	});

	test("pull_request_review_comment.edited, PR by agent, comment by human → dispatched as pr_comment", async () => {
		const result = await router.handleWebhook(
			"pull_request_review_comment",
			"delivery-008a",
			prReviewCommentEdited,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("pr_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.issueNumber).toBe(5);
		expect(result.context.commentBody).toContain("(updated)");
		expect(result.context.isReviewComment).toBe(true);
	});

	test("pull_request_review_comment.created, comment from app bot → skipped", async () => {
		const payload = {
			...prReviewComment,
			comment: { ...prReviewComment.comment, user: { login: APP_BOT_LOGIN } },
		};
		const result = await router.handleWebhook(
			"pull_request_review_comment",
			"delivery-009",
			payload,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/ignored/i);
	});

	test("pull_request_review_comment.created, PR not by agent → skipped", async () => {
		const payload = {
			...prReviewComment,
			pull_request: {
				...prReviewComment.pull_request,
				user: { login: "other-user" },
			},
		};
		const result = await router.handleWebhook(
			"pull_request_review_comment",
			"delivery-010",
			payload,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/pull_request\.user/i);
	});

	// ── pull_request_review.submitted ─────────────────────────────────────────

	test("pull_request_review.submitted with body, PR by agent, reviewer is human → dispatched as pr_comment with isReviewSubmission", async () => {
		const result = await router.handleWebhook(
			"pull_request_review",
			"delivery-011",
			prReviewSubmitted,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("pr_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.issueNumber).toBe(64);
		expect(result.context.commentBody).toBe("Please fix the naming");
		expect(result.context.isReviewComment).toBe(false);
		expect(result.context.isReviewSubmission).toBe(true);
		expect(result.context.repoName).toBe("coder-action");
		expect(result.context.repoOwner).toBe("xmtplabs");
	});

	test("pull_request_review.submitted, reviewer is agent → skipped", async () => {
		const payload = {
			...prReviewSubmitted,
			review: {
				...prReviewSubmitted.review,
				user: { login: AGENT_USER_LOGIN },
			},
		};
		const result = await router.handleWebhook(
			"pull_request_review",
			"delivery-012",
			payload,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/ignored/i);
	});

	test("pull_request_review.submitted with empty body → skipped", async () => {
		const result = await router.handleWebhook(
			"pull_request_review",
			"delivery-013",
			prReviewSubmittedEmpty,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/body/i);
	});

	// ── workflow_run.completed ─────────────────────────────────────────────────

	test("workflow_run.completed failure → dispatched as failed_check", async () => {
		const result = await router.handleWebhook(
			"workflow_run",
			"delivery-014",
			workflowRunFailure,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("failed_check");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect(result.context.repoName).toBe("coder-action");
		expect(result.context.repoOwner).toBe("xmtplabs");
		expect(result.context.workflowRunId).toBe(23526809052);
		expect(result.context.workflowName).toBe("CI");
		expect(result.context.conclusion).toBe("failure");
	});

	test("workflow_run.completed success → skipped", async () => {
		const result = await router.handleWebhook(
			"workflow_run",
			"delivery-015",
			workflowRunSuccess,
		);

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/conclusion/i);
	});

	// ── unknown event ─────────────────────────────────────────────────────────

	test("unknown event → skipped", async () => {
		const result = await router.handleWebhook("push", "delivery-016", {
			ref: "refs/heads/main",
		});

		expect(result.dispatched).toBe(false);
		if (result.dispatched) throw new Error("expected skipped");
		expect(result.reason).toMatch(/unhandled/i);
	});

	// ── installationId extraction ─────────────────────────────────────────────

	test("installationId is extracted from payload.installation.id", async () => {
		const payload = {
			...issuesAssigned,
			installation: { id: 77777 },
		};
		const result = await router.handleWebhook(
			"issues",
			"delivery-017",
			payload,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.installationId).toBe(77777);
	});
});
