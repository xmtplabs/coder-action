import { beforeEach, describe, expect, test } from "bun:test";
import type { IssueCommentInputs } from "../schemas";
import {
	MockCoderClient,
	createMockGitHubClient,
	mockStoppedTask,
	mockTask,
} from "../test-helpers";
import { IssueCommentHandler } from "./issue-comment";
import type { IssueCommentContext } from "./issue-comment";

const baseInputs: IssueCommentInputs = {
	action: "issue_comment",
	coderURL: "https://coder.test",
	coderToken: "token",
	coderUsername: "coder-agent",
	coderTaskNamePrefix: "gh",
	githubToken: "ghp_123",
	coderGithubUsername: "xmtp-coder-agent",
};

const validContext: IssueCommentContext = {
	owner: "xmtp",
	repo: "libxmtp",
	issueNumber: 42,
	commentId: 1,
	commenterLogin: "author",
	commentUrl: "https://github.com/xmtp/libxmtp/issues/42#issuecomment-1",
	commentBody: "Actually, the requirement changed",
	commentCreatedAt: "2026-03-17T12:00:00Z",
};

describe("IssueCommentHandler", () => {
	let coder: MockCoderClient;
	let github: ReturnType<typeof createMockGitHubClient>;

	beforeEach(() => {
		coder = new MockCoderClient();
		github = createMockGitHubClient();
		coder.getTask.mockResolvedValue(mockTask as never);
	});

	// AC #20: Forward comment to task
	test("sends formatted message to task for valid issue comment", async () => {
		const handler = new IssueCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.sendTaskInput).toHaveBeenCalledTimes(1);
		const sentMessage = (
			coder.sendTaskInput.mock.calls[0] as unknown as [string, unknown, string]
		)[2];
		expect(sentMessage).toContain("New Comment on Issue:");
		expect(sentMessage).toContain("Actually, the requirement changed");
	});

	// Issue #23: React with 👀 when comment is forwarded to agent
	test("adds 👀 reaction when comment is forwarded to agent", async () => {
		const handler = new IssueCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
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
	test("does not add reaction when comment is skipped (self-comment)", async () => {
		const ctx = { ...validContext, commenterLogin: "xmtp-coder-agent" };
		const handler = new IssueCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
		);
		await handler.run();

		expect(github.addReactionToComment).not.toHaveBeenCalled();
	});

	// Issue #23: No reaction when task not found
	test("does not add reaction when task is not found", async () => {
		coder.getTask.mockResolvedValue(null);
		const handler = new IssueCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
		);
		await handler.run();

		expect(github.addReactionToComment).not.toHaveBeenCalled();
	});

	// AC #21: Self-comment
	test("skips self-comments from coder agent", async () => {
		const ctx = { ...validContext, commenterLogin: "xmtp-coder-agent" };
		const handler = new IssueCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("self-comment");
		expect(coder.sendTaskInput).not.toHaveBeenCalled();
	});

	// AC #22: Task not found
	test("skips when no task found for issue", async () => {
		coder.getTask.mockResolvedValue(null);
		const handler = new IssueCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain("task-not-found");
	});

	// Edge: restart stopped (paused) task
	test("resumes paused task before sending", async () => {
		coder.getTask.mockResolvedValue(mockStoppedTask as never);
		const handler = new IssueCommentHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
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
});
