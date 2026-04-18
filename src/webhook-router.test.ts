import { describe, test, expect, beforeEach } from "bun:test";
import { WebhookRouter } from "./webhook-router";
import type {
	WebhookRouterOptions,
	CreateTaskContext,
	CloseTaskContext,
	PRCommentContext,
	IssueCommentContext,
	FailedCheckContext,
} from "./webhook-router";
import type { Logger } from "./infra/logger";

import issuesAssigned from "./testing/fixtures/issues-assigned.json";
import issuesClosed from "./testing/fixtures/issues-closed.json";
import issueCommentOnIssue from "./testing/fixtures/issue-comment-on-issue.json";
import issueCommentOnPr from "./testing/fixtures/issue-comment-on-pr.json";
import prReviewComment from "./testing/fixtures/pr-review-comment.json";
import prReviewSubmitted from "./testing/fixtures/pr-review-submitted.json";
import prReviewSubmittedEmpty from "./testing/fixtures/pr-review-submitted-empty.json";
import workflowRunFailure from "./testing/fixtures/workflow-run-failure.json";
import workflowRunSuccess from "./testing/fixtures/workflow-run-success.json";

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
		const ctx = result.context as CreateTaskContext;
		expect(ctx.issueNumber).toBe(65);
		expect(ctx.issueUrl).toBe(
			"https://github.com/xmtplabs/coder-action/issues/65",
		);
		expect(ctx.repoName).toBe("coder-action");
		expect(ctx.repoOwner).toBe("xmtplabs");
		// senderLogin and senderId must be present for permission checks and
		// Coder username resolution
		expect(ctx.senderLogin).toBe("neekolas");
		expect(ctx.senderId).toBe(65710);
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
		const ctx = result.context as CloseTaskContext;
		expect(ctx.issueNumber).toBe(63);
		expect(ctx.repoName).toBe("coder-action");
		expect(ctx.repoOwner).toBe("xmtplabs");
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
		const ctx = result.context as IssueCommentContext;
		expect(ctx.issueNumber).toBe(65);
		expect(ctx.commentBody).toBe(
			"Can you also handle the edge case for empty inputs?",
		);
		expect(ctx.commentUrl).toBe(
			"https://github.com/xmtplabs/coder-action/issues/65#issuecomment-4123912472",
		);
		expect(ctx.repoName).toBe("coder-action");
		expect(ctx.repoOwner).toBe("xmtplabs");
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
		const payload = { ...issueCommentOnIssue, action: "edited" };
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-006a",
			payload,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("issue_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect((result.context as IssueCommentContext).issueNumber).toBe(65);
	});

	test("issue_comment.edited on PR from human → dispatched as pr_comment", async () => {
		const payload = { ...issueCommentOnPr, action: "edited" };
		const result = await router.handleWebhook(
			"issue_comment",
			"delivery-006b",
			payload,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("pr_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		expect((result.context as PRCommentContext).issueNumber).toBe(64);
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
		const ctx = result.context as PRCommentContext;
		expect(ctx.issueNumber).toBe(64);
		expect(ctx.commentBody).toBe("Looks good, but please fix the naming.");
		expect(ctx.isReviewComment).toBe(false);
		expect(ctx.isReviewSubmission).toBe(false);
		expect(ctx.repoName).toBe("coder-action");
		expect(ctx.repoOwner).toBe("xmtplabs");
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
		const ctx = result.context as PRCommentContext;
		expect(ctx.issueNumber).toBe(64);
		expect(ctx.commentBody).toBe("Why didn't you respond to this?");
		expect(ctx.isReviewComment).toBe(true);
		expect(ctx.isReviewSubmission).toBe(false);
		expect(ctx.repoName).toBe("coder-action");
		expect(ctx.repoOwner).toBe("xmtplabs");
		expect(ctx.filePath).toBe("dist/server.js");
		expect(ctx.lineNumber).toBe(1);
	});

	test("pull_request_review_comment.edited, PR by agent, comment by human → dispatched as pr_comment", async () => {
		const payload = { ...prReviewComment, action: "edited" };
		const result = await router.handleWebhook(
			"pull_request_review_comment",
			"delivery-008a",
			payload,
		);

		expect(result.dispatched).toBe(true);
		if (!result.dispatched) throw new Error("expected dispatched");
		expect(result.handler).toBe("pr_comment");
		expect(result.installationId).toBe(INSTALLATION_ID);
		const ctx = result.context as PRCommentContext;
		expect(ctx.issueNumber).toBe(64);
		expect(ctx.isReviewComment).toBe(true);
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
		const ctx = result.context as PRCommentContext;
		expect(ctx.issueNumber).toBe(64);
		expect(ctx.commentBody).toBe("Please fix the naming");
		expect(ctx.isReviewComment).toBe(false);
		expect(ctx.isReviewSubmission).toBe(true);
		expect(ctx.repoName).toBe("coder-action");
		expect(ctx.repoOwner).toBe("xmtplabs");
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
		const ctx = result.context as FailedCheckContext;
		expect(ctx.repoName).toBe("coder-action");
		expect(ctx.repoOwner).toBe("xmtplabs");
		expect(ctx.workflowRunId).toBe(23526809052);
		expect(ctx.workflowName).toBe("CI");
		expect(ctx.conclusion).toBe("failure");
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
