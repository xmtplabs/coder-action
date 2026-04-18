import { beforeEach, describe, expect, test } from "bun:test";
import { TestLogger } from "../infra/logger";
import type { HandlerConfig } from "../config/handler-config";
import {
	MockTaskRunner,
	mockTaskNeutral,
	mockTaskNeutralError,
	createMockGitHubClient,
} from "../testing/helpers";
import { IssueCommentAction } from "./issue-comment";
import type { IssueCommentContext } from "./issue-comment";

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

describe("IssueCommentAction", () => {
	let runner: MockTaskRunner;
	let github: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;

	beforeEach(() => {
		runner = new MockTaskRunner();
		github = createMockGitHubClient();
		logger = new TestLogger();
		runner.getStatus.mockResolvedValue(mockTaskNeutral);
	});

	// AC #20: Happy path — sendInput called once with timeout; reaction added
	test("sends formatted message to task for valid issue comment", async () => {
		const action = new IssueCommentAction(
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
		expect(sendArgs[0].input).toContain("New Comment on Issue:");
		expect(sendArgs[0].input).toContain("Actually, the requirement changed");
		expect(sendArgs[0].timeout).toBe(120_000);
	});

	// Issue #23: React with 👀 when comment is forwarded to agent
	test("adds 👀 reaction when comment is forwarded to agent", async () => {
		const action = new IssueCommentAction(
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

	// Issue #23: No reaction when comment is skipped (self-comment)
	test("does not add reaction when comment is skipped (self-comment)", async () => {
		const ctx = { ...validContext, commenterLogin: "xmtp-coder-agent" };
		const action = new IssueCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		await action.run();

		expect(github.addReactionToComment).not.toHaveBeenCalled();
	});

	// Issue #23: No reaction when task not found
	test("does not add reaction when task is not found", async () => {
		runner.getStatus.mockResolvedValue(null);
		const action = new IssueCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		await action.run();

		expect(github.addReactionToComment).not.toHaveBeenCalled();
	});

	// AC #21: Self-comment
	test("skips self-comments from coder agent", async () => {
		const ctx = { ...validContext, commenterLogin: "xmtp-coder-agent" };
		const action = new IssueCommentAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("self-comment");
		expect(runner.sendInput).not.toHaveBeenCalled();
	});

	// AC #22: Task not found
	test("skips when no task found for issue", async () => {
		runner.getStatus.mockResolvedValue(null);
		const action = new IssueCommentAction(
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

	// Task in error state — skip
	test("skips when task is in error state", async () => {
		runner.getStatus.mockResolvedValue(mockTaskNeutralError);
		const action = new IssueCommentAction(
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
});
