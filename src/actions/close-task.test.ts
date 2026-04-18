import { beforeEach, describe, expect, test } from "vitest";
import { TestLogger } from "../infra/logger";
import type { HandlerConfig } from "../config/handler-config";
import { MockTaskRunner, createMockGitHubClient } from "../testing/helpers";
import { CloseTaskAction } from "./close-task";
import type { CloseTaskContext } from "./close-task";

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

const closeContext: CloseTaskContext = {
	owner: "xmtp",
	repo: "libxmtp",
	issueNumber: 42,
};

describe("CloseTaskAction", () => {
	let runner: MockTaskRunner;
	let github: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;

	beforeEach(() => {
		runner = new MockTaskRunner();
		github = createMockGitHubClient();
		logger = new TestLogger();
	});

	// AC #7: Happy path — runner.delete called, comment posted
	test("calls runner.delete and posts completion comment when task exists", async () => {
		// MockTaskRunner.delete returns { deleted: true } by default
		const action = new CloseTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			closeContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(false);
		expect(result.taskName).toBe("gh-libxmtp-42");
		expect(result.taskStatus).toBe("deleted");
		expect(runner.delete).toHaveBeenCalledTimes(1);
		const deleteCall = runner.delete.mock.calls[0] as unknown as [
			{ taskName: string },
		];
		expect(String(deleteCall[0].taskName)).toBe("gh-libxmtp-42");
		expect(github.commentOnIssue).toHaveBeenCalledWith(
			closeContext.owner,
			closeContext.repo,
			closeContext.issueNumber,
			"Task completed.",
			"Task created:",
		);
	});

	// AC #8: Task not found — returns skipped with "task-not-found", no comment posted
	test("skips with task-not-found when task does not exist (no comment posted)", async () => {
		runner.delete.mockResolvedValue({ deleted: false });

		const action = new CloseTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			closeContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("task-not-found");
		expect(runner.delete).toHaveBeenCalledTimes(1);
		expect(github.commentOnIssue).not.toHaveBeenCalled();
	});

	// No workspace stop/delete calls — those are gone
	test("does not call any workspace-level operations", async () => {
		// runner.delete returns { deleted: true } by default — task exists
		const action = new CloseTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			closeContext,
			logger,
		);
		await action.run();

		// Verify only delete was called (not startWorkspace, sendInput, etc.)
		expect(runner.delete).toHaveBeenCalledTimes(1);
		expect(runner.sendInput).not.toHaveBeenCalled();
		expect(runner.create).not.toHaveBeenCalled();
	});
});
