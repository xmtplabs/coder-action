import { describe, test, expect, beforeEach } from "vitest";
import { WebhookRouter } from "./router";
import type { WebhookRouterOptions, SkipResult } from "./router";
import type {
	TaskRequestedEvent,
	TaskClosedEvent,
	CommentPostedEvent,
	CheckFailedEvent,
	Event,
} from "../../events/types";
import type { Logger } from "../../utils/logger";

import issuesAssigned from "../../testing/fixtures/issues-assigned.json";
import issuesClosed from "../../testing/fixtures/issues-closed.json";
import issueCommentOnIssue from "../../testing/fixtures/issue-comment-on-issue.json";
import issueCommentOnPr from "../../testing/fixtures/issue-comment-on-pr.json";
import prReviewComment from "../../testing/fixtures/pr-review-comment.json";
import prReviewSubmitted from "../../testing/fixtures/pr-review-submitted.json";
import prReviewSubmittedEmpty from "../../testing/fixtures/pr-review-submitted-empty.json";
import workflowRunFailure from "../../testing/fixtures/workflow-run-failure.json";
import workflowRunSuccess from "../../testing/fixtures/workflow-run-success.json";

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

function isEvent(r: Event | SkipResult): r is Event {
	return !("dispatched" in r);
}

function isSkip(r: Event | SkipResult): r is SkipResult {
	return "dispatched" in r && r.dispatched === false;
}

describe("WebhookRouter", () => {
	let router: WebhookRouter;

	beforeEach(() => {
		router = makeRouter();
	});

	// ── issues.assigned ────────────────────────────────────────────────────────

	test("issues.assigned with matching agent login → task_requested event", async () => {
		const result = await router.handleGithubWebhook(
			"issues",
			"delivery-001",
			issuesAssigned,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as TaskRequestedEvent;
		expect(event.type).toBe("task_requested");
		expect(event.source.type).toBe("github");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.repository.owner).toBe("xmtplabs");
		expect(event.repository.name).toBe("coder-action");
		expect(event.issue.number).toBe(65);
		expect(event.issue.url).toBe(
			"https://github.com/xmtplabs/coder-action/issues/65",
		);
		// requester is sender (the human who triggered the assignment)
		expect(event.requester.login).toBe("neekolas");
		expect(event.requester.externalId).toBe(65710);
	});

	test("issues.assigned with non-matching assignee login → skipped", async () => {
		const payload = {
			...issuesAssigned,
			assignee: { login: "other-user", id: 99 },
		};
		const result = await router.handleGithubWebhook(
			"issues",
			"delivery-002",
			payload,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
		expect(result.reason).toMatch(/assignee/i);
	});

	// ── issues.closed ──────────────────────────────────────────────────────────

	test("issues.closed → task_closed event", async () => {
		const result = await router.handleGithubWebhook(
			"issues",
			"delivery-003",
			issuesClosed,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as TaskClosedEvent;
		expect(event.type).toBe("task_closed");
		expect(event.source.type).toBe("github");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.repository.owner).toBe("xmtplabs");
		expect(event.repository.name).toBe("coder-action");
		expect(event.issue.number).toBe(63);
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
		const result = await router.handleGithubWebhook(
			"issue_comment",
			"delivery-004",
			payload,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
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
		const result = await router.handleGithubWebhook(
			"issue_comment",
			"delivery-005",
			payload,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
		expect(result.reason).toMatch(/ignored/i);
	});

	// ── issue_comment.created — dispatch ──────────────────────────────────────

	test("issue_comment.created on issue from human → comment_posted event (kind: issue)", async () => {
		const result = await router.handleGithubWebhook(
			"issue_comment",
			"delivery-006",
			issueCommentOnIssue,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as CommentPostedEvent;
		expect(event.type).toBe("comment_posted");
		expect(event.source.type).toBe("github");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.repository.owner).toBe("xmtplabs");
		expect(event.repository.name).toBe("coder-action");
		expect(event.target.kind).toBe("issue");
		expect(event.target.number).toBe(65);
		expect(event.comment.body).toBe(
			"Can you also handle the edge case for empty inputs?",
		);
		expect(event.comment.url).toBe(
			"https://github.com/xmtplabs/coder-action/issues/65#issuecomment-4123912472",
		);
		expect(event.comment.isReviewComment).toBe(false);
		expect(event.comment.isReviewSubmission).toBe(false);
	});

	test("issue_comment.created on PR where PR author is not agent → skipped", async () => {
		const payload = {
			...issueCommentOnPr,
			issue: {
				...issueCommentOnPr.issue,
				user: { login: "some-other-user" },
			},
		};
		const result = await router.handleGithubWebhook(
			"issue_comment",
			"delivery-007a",
			payload,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
		expect(result.reason).toMatch(/PR author/i);
	});

	// ── issue_comment.edited — dispatch ─────────────────────────────────────

	test("issue_comment.edited on issue from human → comment_posted event (kind: issue)", async () => {
		const payload = { ...issueCommentOnIssue, action: "edited" };
		const result = await router.handleGithubWebhook(
			"issue_comment",
			"delivery-006a",
			payload,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as CommentPostedEvent;
		expect(event.type).toBe("comment_posted");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.target.kind).toBe("issue");
		expect(event.target.number).toBe(65);
	});

	test("issue_comment.edited on PR from human → comment_posted event (kind: pull_request)", async () => {
		const payload = { ...issueCommentOnPr, action: "edited" };
		const result = await router.handleGithubWebhook(
			"issue_comment",
			"delivery-006b",
			payload,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as CommentPostedEvent;
		expect(event.type).toBe("comment_posted");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.target.kind).toBe("pull_request");
		expect(event.target.number).toBe(64);
	});

	test("issue_comment.deleted → skipped without validation error", async () => {
		const payload = {
			...issueCommentOnIssue,
			action: "deleted",
		};
		const result = await router.handleGithubWebhook(
			"issue_comment",
			"delivery-006c",
			payload,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
		expect(result.reason).toMatch(/unhandled/i);
		expect(result.validationError).toBeUndefined();
	});

	test("issue_comment.created on PR from human → comment_posted event (kind: pull_request)", async () => {
		const result = await router.handleGithubWebhook(
			"issue_comment",
			"delivery-007",
			issueCommentOnPr,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as CommentPostedEvent;
		expect(event.type).toBe("comment_posted");
		expect(event.source.type).toBe("github");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.repository.owner).toBe("xmtplabs");
		expect(event.repository.name).toBe("coder-action");
		expect(event.target.kind).toBe("pull_request");
		expect(event.target.number).toBe(64);
		expect(event.comment.body).toBe("Looks good, but please fix the naming.");
		expect(event.comment.isReviewComment).toBe(false);
		expect(event.comment.isReviewSubmission).toBe(false);
	});

	// ── pull_request_review_comment.created ───────────────────────────────────

	test("pull_request_review_comment.created, PR by agent, comment by human → comment_posted with isReviewComment", async () => {
		const result = await router.handleGithubWebhook(
			"pull_request_review_comment",
			"delivery-008",
			prReviewComment,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as CommentPostedEvent;
		expect(event.type).toBe("comment_posted");
		expect(event.source.type).toBe("github");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.repository.owner).toBe("xmtplabs");
		expect(event.repository.name).toBe("coder-action");
		expect(event.target.kind).toBe("pull_request");
		expect(event.target.number).toBe(64);
		expect(event.comment.body).toBe("Why didn't you respond to this?");
		expect(event.comment.isReviewComment).toBe(true);
		expect(event.comment.isReviewSubmission).toBe(false);
	});

	test("pull_request_review_comment.created populates comment.filePath and comment.lineNumber from payload", async () => {
		const result = await router.handleGithubWebhook(
			"pull_request_review_comment",
			"delivery-008b",
			prReviewComment,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as CommentPostedEvent;
		// Fixture has path="dist/server.js", line=1, position=1
		expect(event.comment.filePath).toBe("dist/server.js");
		expect(event.comment.lineNumber).toBe(1);
	});

	test("pull_request_review_comment.edited, PR by agent, comment by human → comment_posted event", async () => {
		const payload = { ...prReviewComment, action: "edited" };
		const result = await router.handleGithubWebhook(
			"pull_request_review_comment",
			"delivery-008a",
			payload,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as CommentPostedEvent;
		expect(event.type).toBe("comment_posted");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.target.number).toBe(64);
		expect(event.comment.isReviewComment).toBe(true);
	});

	test("pull_request_review_comment.created, comment from app bot → skipped", async () => {
		const payload = {
			...prReviewComment,
			comment: { ...prReviewComment.comment, user: { login: APP_BOT_LOGIN } },
		};
		const result = await router.handleGithubWebhook(
			"pull_request_review_comment",
			"delivery-009",
			payload,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
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
		const result = await router.handleGithubWebhook(
			"pull_request_review_comment",
			"delivery-010",
			payload,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
		expect(result.reason).toMatch(/pull_request\.user/i);
	});

	// ── pull_request_review.submitted ─────────────────────────────────────────

	test("pull_request_review.submitted with body, PR by agent, reviewer is human → comment_posted with isReviewSubmission", async () => {
		const result = await router.handleGithubWebhook(
			"pull_request_review",
			"delivery-011",
			prReviewSubmitted,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as CommentPostedEvent;
		expect(event.type).toBe("comment_posted");
		expect(event.source.type).toBe("github");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.repository.owner).toBe("xmtplabs");
		expect(event.repository.name).toBe("coder-action");
		expect(event.target.kind).toBe("pull_request");
		expect(event.target.number).toBe(64);
		expect(event.comment.body).toBe("Please fix the naming");
		expect(event.comment.isReviewComment).toBe(false);
		expect(event.comment.isReviewSubmission).toBe(true);
	});

	test("pull_request_review.submitted, reviewer is agent → skipped", async () => {
		const payload = {
			...prReviewSubmitted,
			review: {
				...prReviewSubmitted.review,
				user: { login: AGENT_USER_LOGIN },
			},
		};
		const result = await router.handleGithubWebhook(
			"pull_request_review",
			"delivery-012",
			payload,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
		expect(result.reason).toMatch(/ignored/i);
	});

	test("pull_request_review.submitted with empty body → skipped", async () => {
		const result = await router.handleGithubWebhook(
			"pull_request_review",
			"delivery-013",
			prReviewSubmittedEmpty,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
		expect(result.reason).toMatch(/body/i);
	});

	// ── workflow_run.completed ─────────────────────────────────────────────────

	test("workflow_run.completed failure → check_failed event", async () => {
		const result = await router.handleGithubWebhook(
			"workflow_run",
			"delivery-014",
			workflowRunFailure,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as CheckFailedEvent;
		expect(event.type).toBe("check_failed");
		expect(event.source.type).toBe("github");
		expect(event.source.installationId).toBe(INSTALLATION_ID);
		expect(event.repository.owner).toBe("xmtplabs");
		expect(event.repository.name).toBe("coder-action");
		expect(event.run.id).toBe(23526809052);
		expect(event.run.workflowName).toBe("CI");
		expect(event.run.workflowFile).toBe("ci.yml");
	});

	test("workflow_run.completed success → skipped", async () => {
		const result = await router.handleGithubWebhook(
			"workflow_run",
			"delivery-015",
			workflowRunSuccess,
		);

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
		expect(result.reason).toMatch(/conclusion/i);
	});

	// ── unknown event ─────────────────────────────────────────────────────────

	test("unknown event → skipped", async () => {
		const result = await router.handleGithubWebhook("push", "delivery-016", {
			ref: "refs/heads/main",
		});

		expect(isSkip(result)).toBe(true);
		if (!isSkip(result)) throw new Error("expected skipped");
		expect(result.reason).toMatch(/unhandled/i);
	});

	// ── installationId extraction ─────────────────────────────────────────────

	test("installationId is extracted from payload.installation.id", async () => {
		const payload = {
			...issuesAssigned,
			installation: { id: 77777 },
		};
		const result = await router.handleGithubWebhook(
			"issues",
			"delivery-017",
			payload,
		);

		expect(isEvent(result)).toBe(true);
		if (!isEvent(result)) throw new Error("expected event");

		const event = result as TaskRequestedEvent;
		expect(event.source.installationId).toBe(77777);
	});
});
