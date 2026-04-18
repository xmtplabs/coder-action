import { beforeEach, describe, expect, test } from "bun:test";
import { TestLogger } from "../infra/logger";
import type { HandlerConfig } from "../config/handler-config";
import {
	MockTaskRunner,
	mockTaskNeutral,
	mockTaskNeutralError,
	createMockGitHubClient,
} from "../testing/helpers";
import { PRCommentAction } from "./pr-comment";
import type { PRCommentContext } from "./pr-comment";

const baseInputs: HandlerConfig = {
	coderURL: "https://coder.test",
	coderToken: "token",
	coderUsername: "coder-agent",
	coderTaskNamePrefix: "gh",
	coderTemplateName: "task-template",
	coderTemplateNameCodex: "task-template-codex",
	coderOrganization: "default",
	agentGithubUsername: "xmtp-coder-agent",
};

const validContext: PRCommentContext = {
	owner: "xmtp",
	repo: "libxmtp",
	prNumber: 5,
	prAuthor: "xmtp-coder-agent",
	commenterLogin: "reviewer",
	commentId: 1,
	commentUrl: "https://github.com/xmtp/libxmtp/pull/5#issuecomment-1",
	commentBody: "Please fix the typo",
	commentCreatedAt: "2026-03-17T12:00:00Z",
};

describe("PRCommentAction", () => {
	let runner: MockTaskRunner;
	let github: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;

	beforeEach(() => {
		runner = new MockTaskRunner();
		github = createMockGitHubClient();
		logger = new TestLogger();
		// Default: linked issue exists, task exists
		github.findLinkedIssues.mockResolvedValue([
			{
				number: 42,
				title: "Bug",
				state: "OPEN",
				url: "https://github.com/xmtp/libxmtp/issues/42",
			},
		]);
		runner.getStatus.mockResolvedValue(mockTaskNeutral);
	});

	// AC #10: Forward comment to task — sendInput called exactly once with correct timeout
	test("sends formatted message to task for valid PR comment", async () => {
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(false);
		expect(runner.sendInput).toHaveBeenCalledTimes(1);
		const sendArgs = runner.sendInput.mock.calls[0] as unknown as [
			{ taskName: string; input: string; timeout: number },
		];
		expect(sendArgs[0].input).toContain("New Comment on PR:");
		expect(sendArgs[0].input).toContain("Please fix the typo");
		expect(sendArgs[0].timeout).toBe(120_000);
	});

	// Issue #23: React with 👀 when comment is forwarded to agent
	test("adds 👀 reaction when comment is forwarded to agent", async () => {
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		await action.run();

		expect(github.addReactionToComment).toHaveBeenCalledTimes(1);
		expect(github.addReactionToComment).toHaveBeenCalledWith(
			"xmtp",
			"libxmtp",
			1,
		);
	});

	// Issue #23: No reaction when comment is skipped
	test("does not add reaction when PR not by coder agent", async () => {
		const ctx = { ...validContext, prAuthor: "other-user" };
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		await action.run();

		expect(github.addReactionToComment).not.toHaveBeenCalled();
	});

	// AC #11: PR not by agent
	test("skips when PR not authored by coder agent", async () => {
		const ctx = { ...validContext, prAuthor: "other-user" };
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("pr-not-by-coder-agent");
		expect(runner.sendInput).not.toHaveBeenCalled();
	});

	// AC #12: Self-comment
	test("skips self-comments from coder agent", async () => {
		const ctx = { ...validContext, commenterLogin: "xmtp-coder-agent" };
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("self-comment");
	});

	test("skips self-comment using agentGithubUsername", async () => {
		const ctx = { ...validContext, commenterLogin: "xmtp-coder-agent" };
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await action.run();
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("self-comment");
	});

	// AC #13: No linked issue
	test("skips when no linked issue found", async () => {
		github.findLinkedIssues.mockResolvedValue([]);
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain("no-linked-issue");
	});

	// AC #14: Task not found
	test("skips when task not found (null)", async () => {
		runner.getStatus.mockResolvedValue(null);
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain("task-not-found");
	});

	// AC #14: Task in error state — skip
	test("skips when task is in error state", async () => {
		runner.getStatus.mockResolvedValue(mockTaskNeutralError);
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("task-not-found");
	});

	// Edge: multiple linked issues — use first
	test("uses first linked issue when multiple exist", async () => {
		github.findLinkedIssues.mockResolvedValue([
			{ number: 42, title: "Bug 1", state: "OPEN", url: "url1" },
			{ number: 43, title: "Bug 2", state: "OPEN", url: "url2" },
		]);
		const action = new PRCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		await action.run();

		const getStatusCall = runner.getStatus.mock.calls[0] as unknown as [
			{ taskName: string; owner?: string },
		];
		expect(String(getStatusCall[0].taskName)).toBe("gh-libxmtp-42");
	});

	// Issue #58: PR review submissions (approve/request changes/comment body)
	describe("review submissions (isReviewSubmission: true)", () => {
		const reviewSubmissionContext: PRCommentContext = {
			...validContext,
			commentUrl:
				"https://github.com/xmtp/libxmtp/pull/5#pullrequestreview-123",
			commentBody: "Please address the naming conventions",
			isReviewSubmission: true,
		};

		test("forwards review submission body to task", async () => {
			const action = new PRCommentAction(
				runner,
				github as unknown as import("../services/github/client").GitHubClient,
				baseInputs,
				reviewSubmissionContext,
				logger,
			);
			const result = await action.run();

			expect(result.skipped).toBe(false);
			expect(runner.sendInput).toHaveBeenCalledTimes(1);
			const sendArgs = runner.sendInput.mock.calls[0] as unknown as [
				{ taskName: string; input: string; timeout: number },
			];
			expect(sendArgs[0].input).toContain(
				"Please address the naming conventions",
			);
		});

		test("skips review submission with empty body", async () => {
			const ctx = { ...reviewSubmissionContext, commentBody: "" };
			const action = new PRCommentAction(
				runner,
				github as unknown as import("../services/github/client").GitHubClient,
				baseInputs,
				ctx,
				logger,
			);
			const result = await action.run();

			expect(result.skipped).toBe(true);
			expect(result.skipReason).toBe("empty-review-body");
			expect(runner.sendInput).not.toHaveBeenCalled();
		});

		test("skips review submission with whitespace-only body", async () => {
			const ctx = { ...reviewSubmissionContext, commentBody: "   \n  " };
			const action = new PRCommentAction(
				runner,
				github as unknown as import("../services/github/client").GitHubClient,
				baseInputs,
				ctx,
				logger,
			);
			const result = await action.run();

			expect(result.skipped).toBe(true);
			expect(result.skipReason).toBe("empty-review-body");
		});

		test("does not add reaction for review submissions", async () => {
			const action = new PRCommentAction(
				runner,
				github as unknown as import("../services/github/client").GitHubClient,
				baseInputs,
				reviewSubmissionContext,
				logger,
			);
			await action.run();

			expect(github.addReactionToComment).not.toHaveBeenCalled();
			expect(github.addReactionToReviewComment).not.toHaveBeenCalled();
		});
	});

	// Issue #46: PR review comments (inline code comments)
	describe("review comments (isReviewComment: true)", () => {
		const reviewContext: PRCommentContext = {
			...validContext,
			commentUrl: "https://github.com/xmtp/libxmtp/pull/5/changes#r2962833476",
			isReviewComment: true,
		};

		test("forwards review comment to task", async () => {
			const action = new PRCommentAction(
				runner,
				github as unknown as import("../services/github/client").GitHubClient,
				baseInputs,
				reviewContext,
				logger,
			);
			const result = await action.run();

			expect(result.skipped).toBe(false);
			expect(runner.sendInput).toHaveBeenCalledTimes(1);
		});

		test("includes file path and line number in forwarded message", async () => {
			const ctx: PRCommentContext = {
				...validContext,
				commentUrl:
					"https://github.com/xmtp/libxmtp/pull/5/changes#r2962833476",
				commentBody: "This variable name is unclear",
				isReviewComment: true,
				filePath: "src/handlers/pr-comment.ts",
				lineNumber: 42,
			};
			const action = new PRCommentAction(
				runner,
				github as unknown as import("../services/github/client").GitHubClient,
				baseInputs,
				ctx,
				logger,
			);
			await action.run();

			const sendArgs = runner.sendInput.mock.calls[0] as unknown as [
				{ taskName: string; input: string; timeout: number },
			];
			expect(sendArgs[0].input).toContain(
				"File: src/handlers/pr-comment.ts:42",
			);
		});

		test("adds 👀 reaction via review comment endpoint", async () => {
			const action = new PRCommentAction(
				runner,
				github as unknown as import("../services/github/client").GitHubClient,
				baseInputs,
				reviewContext,
				logger,
			);
			await action.run();

			expect(github.addReactionToReviewComment).toHaveBeenCalledTimes(1);
			expect(github.addReactionToReviewComment).toHaveBeenCalledWith(
				"xmtp",
				"libxmtp",
				1,
			);
			expect(github.addReactionToComment).not.toHaveBeenCalled();
		});

		test("uses issue comment endpoint for regular PR comments", async () => {
			const action = new PRCommentAction(
				runner,
				github as unknown as import("../services/github/client").GitHubClient,
				baseInputs,
				validContext,
				logger,
			);
			await action.run();

			expect(github.addReactionToComment).toHaveBeenCalledTimes(1);
			expect(github.addReactionToReviewComment).not.toHaveBeenCalled();
		});
	});
});
