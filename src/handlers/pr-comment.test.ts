import { beforeEach, describe, expect, test } from "bun:test";
import { TestLogger } from "../logger";
import type { HandlerConfig } from "../schemas";
import {
	MockCoderClient,
	createMockGitHubClient,
	mockStoppedTask,
	mockTask,
} from "../test-helpers";
import { PRCommentHandler } from "./pr-comment";
import type { PRCommentContext } from "./pr-comment";

const baseInputs: HandlerConfig = {
	coderURL: "https://coder.test",
	coderToken: "token",
	coderUsername: "coder-agent",
	coderTaskNamePrefix: "gh",
	coderTemplateName: "task-template",
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

describe("PRCommentHandler", () => {
	let coder: MockCoderClient;
	let github: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;

	beforeEach(() => {
		coder = new MockCoderClient();
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
		coder.getTask.mockResolvedValue(mockTask as never);
	});

	// AC #10: Forward comment to task
	test("sends formatted message to task for valid PR comment", async () => {
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.sendTaskInput).toHaveBeenCalledTimes(1);
		const sentMessage = (
			coder.sendTaskInput.mock.calls[0] as unknown as [string, unknown, string]
		)[2];
		expect(sentMessage).toContain("New Comment on PR:");
		expect(sentMessage).toContain("Please fix the typo");
	});

	// Issue #23: React with 👀 when comment is forwarded to agent
	test("adds 👀 reaction when comment is forwarded to agent", async () => {
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		await handler.run();

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
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		await handler.run();

		expect(github.addReactionToComment).not.toHaveBeenCalled();
	});

	// AC #11: PR not by agent
	test("skips when PR not authored by coder agent", async () => {
		const ctx = { ...validContext, prAuthor: "other-user" };
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("pr-not-by-coder-agent");
		expect(coder.sendTaskInput).not.toHaveBeenCalled();
	});

	// AC #12: Self-comment
	test("skips self-comments from coder agent", async () => {
		const ctx = { ...validContext, commenterLogin: "xmtp-coder-agent" };
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("self-comment");
	});

	test("skips self-comment using agentGithubUsername", async () => {
		const ctx = { ...validContext, commenterLogin: "xmtp-coder-agent" };
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await handler.run();
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("self-comment");
	});

	// AC #13: No linked issue
	test("skips when no linked issue found", async () => {
		github.findLinkedIssues.mockResolvedValue([]);
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain("no-linked-issue");
	});

	// AC #14: Task not found
	test("skips when task not found", async () => {
		coder.getTask.mockResolvedValue(null);
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain("task-not-found");
	});

	// AC #15: Restart stopped (paused) task
	test("resumes paused task before sending", async () => {
		coder.getTask.mockResolvedValue(mockStoppedTask as never);
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.startWorkspace).toHaveBeenCalledTimes(1);
		expect(coder.startWorkspace).toHaveBeenCalledWith(
			mockStoppedTask.workspace_id,
		);
		expect(coder.waitForTaskActive).toHaveBeenCalledTimes(1);
		expect(coder.sendTaskInput).toHaveBeenCalledTimes(1);
	});

	// Edge: multiple linked issues — use first
	test("uses first linked issue when multiple exist", async () => {
		github.findLinkedIssues.mockResolvedValue([
			{ number: 42, title: "Bug 1", state: "OPEN", url: "url1" },
			{ number: 43, title: "Bug 2", state: "OPEN", url: "url2" },
		]);
		const handler = new PRCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		await handler.run();

		// Task name should use issue 42, not 43
		const taskNameArg = (
			coder.getTask.mock.calls[0] as unknown as [string, unknown]
		)[1];
		expect(String(taskNameArg)).toBe("gh-libxmtp-42");
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
			const handler = new PRCommentHandler(
				coder,
				github as unknown as import("../github-client").GitHubClient,
				baseInputs,
				reviewSubmissionContext,
				logger,
			);
			const result = await handler.run();

			expect(result.skipped).toBe(false);
			expect(coder.sendTaskInput).toHaveBeenCalledTimes(1);
			const sentMessage = (
				coder.sendTaskInput.mock.calls[0] as unknown as [
					string,
					unknown,
					string,
				]
			)[2];
			expect(sentMessage).toContain("Please address the naming conventions");
		});

		test("skips review submission with empty body", async () => {
			const ctx = { ...reviewSubmissionContext, commentBody: "" };
			const handler = new PRCommentHandler(
				coder,
				github as unknown as import("../github-client").GitHubClient,
				baseInputs,
				ctx,
				logger,
			);
			const result = await handler.run();

			expect(result.skipped).toBe(true);
			expect(result.skipReason).toBe("empty-review-body");
			expect(coder.sendTaskInput).not.toHaveBeenCalled();
		});

		test("skips review submission with whitespace-only body", async () => {
			const ctx = { ...reviewSubmissionContext, commentBody: "   \n  " };
			const handler = new PRCommentHandler(
				coder,
				github as unknown as import("../github-client").GitHubClient,
				baseInputs,
				ctx,
				logger,
			);
			const result = await handler.run();

			expect(result.skipped).toBe(true);
			expect(result.skipReason).toBe("empty-review-body");
		});

		test("does not add reaction for review submissions", async () => {
			const handler = new PRCommentHandler(
				coder,
				github as unknown as import("../github-client").GitHubClient,
				baseInputs,
				reviewSubmissionContext,
				logger,
			);
			await handler.run();

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
			const handler = new PRCommentHandler(
				coder,
				github as unknown as import("../github-client").GitHubClient,
				baseInputs,
				reviewContext,
				logger,
			);
			const result = await handler.run();

			expect(result.skipped).toBe(false);
			expect(coder.sendTaskInput).toHaveBeenCalledTimes(1);
		});

		test("adds 👀 reaction via review comment endpoint", async () => {
			const handler = new PRCommentHandler(
				coder,
				github as unknown as import("../github-client").GitHubClient,
				baseInputs,
				reviewContext,
				logger,
			);
			await handler.run();

			expect(github.addReactionToReviewComment).toHaveBeenCalledTimes(1);
			expect(github.addReactionToReviewComment).toHaveBeenCalledWith(
				"xmtp",
				"libxmtp",
				1,
			);
			expect(github.addReactionToComment).not.toHaveBeenCalled();
		});

		test("uses issue comment endpoint for regular PR comments", async () => {
			const handler = new PRCommentHandler(
				coder,
				github as unknown as import("../github-client").GitHubClient,
				baseInputs,
				validContext,
				logger,
			);
			await handler.run();

			expect(github.addReactionToComment).toHaveBeenCalledTimes(1);
			expect(github.addReactionToReviewComment).not.toHaveBeenCalled();
		});
	});
});
