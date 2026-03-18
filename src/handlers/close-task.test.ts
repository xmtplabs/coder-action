import { beforeEach, describe, expect, test } from "bun:test";
import { CoderAPIError } from "../coder-client";
import type { CloseTaskInputs } from "../schemas";
import {
	MockCoderClient,
	createMockGitHubClient,
	mockTask,
} from "../test-helpers";
import { CloseTaskHandler } from "./close-task";
import type { CloseTaskContext } from "./close-task";

const baseInputs: CloseTaskInputs = {
	action: "close_task",
	coderURL: "https://coder.test",
	coderToken: "token",
	coderUsername: "coder-agent",
	coderTaskNamePrefix: "gh",
	githubToken: "ghp_123",
	githubOrg: "xmtp",
	coderGithubUsername: "xmtp-coder-agent",
};

const closeContext: CloseTaskContext = {
	owner: "xmtp",
	repo: "libxmtp",
	issueNumber: 42,
};

describe("CloseTaskHandler", () => {
	let coder: MockCoderClient;
	let github: ReturnType<typeof createMockGitHubClient>;

	beforeEach(() => {
		coder = new MockCoderClient();
		github = createMockGitHubClient();
	});

	// AC #7: Stop and delete workspace
	test("stops and deletes workspace when task exists", async () => {
		coder.getTask.mockResolvedValue({
			...mockTask,
			workspace_id: "ws-1",
		} as never);

		const handler = new CloseTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			closeContext,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.stopWorkspace).toHaveBeenCalledWith("ws-1");
		expect(coder.deleteWorkspace).toHaveBeenCalledWith("ws-1");
		expect(github.commentOnIssue).toHaveBeenCalledTimes(1);
	});

	// AC #8: No task found
	test("returns skipped when no task found", async () => {
		coder.getTask.mockResolvedValue(null);

		const handler = new CloseTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			closeContext,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(coder.stopWorkspace).not.toHaveBeenCalled();
		expect(coder.deleteWorkspace).not.toHaveBeenCalled();
	});

	// AC #9: Stop fails, still deletes
	test("attempts delete even when stop fails", async () => {
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
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.deleteWorkspace).toHaveBeenCalledWith("ws-1");
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
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
	});
});
