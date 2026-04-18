import { beforeEach, describe, expect, test } from "bun:test";
import { CoderAPIError } from "../coder-client";
import { TestLogger } from "../infra/logger";
import type { HandlerConfig } from "../config/handler-config";
import {
	MockCoderClient,
	createMockGitHubClient,
	mockTask,
} from "../test-helpers";
import { CloseTaskHandler } from "./close-task";
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

describe("CloseTaskHandler", () => {
	let coder: MockCoderClient;
	let github: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;

	beforeEach(() => {
		coder = new MockCoderClient();
		github = createMockGitHubClient();
		logger = new TestLogger();
	});

	// AC #7: Stop and delete workspace, then delete task
	test("stops, waits for stop, deletes workspace and task when task exists", async () => {
		coder.getTask.mockResolvedValue({
			...mockTask,
			workspace_id: "ws-1",
		} as never);

		const handler = new CloseTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			closeContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.stopWorkspace).toHaveBeenCalledWith("ws-1");
		expect(coder.waitForWorkspaceStopped).toHaveBeenCalledWith(
			"ws-1",
			expect.any(Function),
		);
		expect(coder.deleteWorkspace).toHaveBeenCalledWith("ws-1");
		expect(coder.deleteTask).toHaveBeenCalledWith(
			mockTask.owner_id,
			mockTask.id,
		);
		expect(github.commentOnIssue).toHaveBeenCalledWith(
			closeContext.owner,
			closeContext.repo,
			closeContext.issueNumber,
			"Task completed.",
			"Task created:",
		);
	});

	// AC #8: No task found
	test("returns skipped when no task found", async () => {
		coder.getTask.mockResolvedValue(null);

		const handler = new CloseTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			closeContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(coder.stopWorkspace).not.toHaveBeenCalled();
		expect(coder.waitForWorkspaceStopped).not.toHaveBeenCalled();
		expect(coder.deleteWorkspace).not.toHaveBeenCalled();
	});

	// AC #9: Stop fails — skip wait, still delete workspace and task
	test("skips wait and attempts delete even when stop fails", async () => {
		coder.getTask.mockResolvedValue({
			...mockTask,
			workspace_id: "ws-1",
		} as never);
		coder.stopWorkspace.mockRejectedValue(new Error("stop failed"));

		const handler = new CloseTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			closeContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.waitForWorkspaceStopped).not.toHaveBeenCalled();
		expect(coder.deleteWorkspace).toHaveBeenCalledWith("ws-1");
		expect(coder.deleteTask).toHaveBeenCalledWith(
			mockTask.owner_id,
			mockTask.id,
		);
	});

	// waitForWorkspaceStopped times out — still delete workspace and task
	test("attempts delete even when waitForWorkspaceStopped times out", async () => {
		coder.getTask.mockResolvedValue({
			...mockTask,
			workspace_id: "ws-1",
		} as never);
		coder.waitForWorkspaceStopped.mockRejectedValue(
			new CoderAPIError("Timeout waiting for workspace to stop", 408),
		);

		const handler = new CloseTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			closeContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.deleteWorkspace).toHaveBeenCalledWith("ws-1");
		expect(coder.deleteTask).toHaveBeenCalledWith(
			mockTask.owner_id,
			mockTask.id,
		);
	});

	// Edge case: deleteTask fails, still completes
	test("completes successfully even when deleteTask fails", async () => {
		coder.getTask.mockResolvedValue({
			...mockTask,
			workspace_id: "ws-1",
		} as never);
		coder.deleteTask.mockRejectedValue(new CoderAPIError("Not found", 404));

		const handler = new CloseTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			closeContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.deleteTask).toHaveBeenCalledWith(
			mockTask.owner_id,
			mockTask.id,
		);
	});

	// Regression: coderUsername is undefined in production for close_task (issue #70)
	test("uses task.owner_id for deleteTask even when coderUsername is undefined", async () => {
		const inputsWithoutUsername: HandlerConfig = {
			...baseInputs,
			coderUsername: undefined,
		};
		coder.getTask.mockResolvedValue({
			...mockTask,
			workspace_id: "ws-1",
		} as never);

		const handler = new CloseTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			inputsWithoutUsername,
			closeContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.deleteTask).toHaveBeenCalledWith(
			mockTask.owner_id,
			mockTask.id,
		);
	});

	// Edge case: already-deleted workspace
	test("handles 404 from Coder gracefully", async () => {
		coder.getTask.mockResolvedValue({
			...mockTask,
			workspace_id: "ws-1",
		} as never);
		coder.stopWorkspace.mockRejectedValue(new CoderAPIError("Not found", 404));
		coder.deleteWorkspace.mockRejectedValue(
			new CoderAPIError("Not found", 404),
		);

		const handler = new CloseTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			closeContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
	});
});
