import { beforeEach, describe, expect, test } from "bun:test";
import {
	MockTaskRunner,
	mockTask,
	createMockGitHubClient,
} from "../testing/helpers";
import type { HandlerConfig } from "../config/handler-config";
import { TestLogger } from "../infra/logger";
import { CreateTaskAction } from "./create-task";

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

const issueContext = {
	owner: "xmtp",
	repo: "libxmtp",
	issueNumber: 42,
	issueUrl: "https://github.com/xmtp/libxmtp/issues/42",
	issueTitle: "Fix some bug",
	issueLabels: [],
	senderLogin: "human-dev",
	senderId: 12345,
};

describe("CreateTaskAction", () => {
	let runner: MockTaskRunner;
	let github: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;

	beforeEach(() => {
		runner = new MockTaskRunner();
		github = createMockGitHubClient();
		logger = new TestLogger();
	});

	// AC #1: Happy path — checkActorPermission → lookupUser → getStatus (null) → create → commentOnIssue
	test("creates task and comments on issue for org member", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		runner.getStatus.mockResolvedValue(null);
		runner.create.mockResolvedValue(mockTask);

		const action = new CreateTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(false);
		expect(result.taskName).toBe("gh-libxmtp-42");
		expect(runner.lookupUser).toHaveBeenCalledTimes(1);
		expect(runner.getStatus).toHaveBeenCalledTimes(1);
		expect(runner.create).toHaveBeenCalledTimes(1);
		expect(github.commentOnIssue).toHaveBeenCalledTimes(1);
		// Comment body includes task URL
		const commentArgs = github.commentOnIssue.mock.calls[0] as unknown as [
			string,
			string,
			number,
			string,
			string,
		];
		expect(commentArgs[3]).toContain(mockTask.url);
	});

	// AC #2: Permission denied — runner methods NOT called
	test("skips for actor without write access", async () => {
		github.checkActorPermission.mockResolvedValue(false);

		const action = new CreateTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("insufficient-permissions");
		expect(runner.lookupUser).not.toHaveBeenCalled();
		expect(runner.create).not.toHaveBeenCalled();
	});

	// AC #3: Existing task path — no create call
	test("returns existing task without creating when task already exists", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		runner.getStatus.mockResolvedValue(mockTask);

		const action = new CreateTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(false);
		expect(result.taskName).toBe("gh-libxmtp-42");
		expect(result.taskUrl).toBe(mockTask.url);
		expect(result.taskStatus).toBe(mockTask.status);
		expect(runner.create).not.toHaveBeenCalled();
		expect(github.commentOnIssue).not.toHaveBeenCalled();
	});

	// AC #4: Issue URL appended to prompt
	test("appends issue URL to prompt", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		runner.getStatus.mockResolvedValue(null);
		runner.create.mockResolvedValue(mockTask);

		const inputs = { ...baseInputs, prompt: "Fix the bug" };
		const action = new CreateTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			inputs,
			issueContext,
			logger,
		);
		await action.run();

		const createCall = runner.create.mock.calls[0] as unknown as [
			{ taskName: string; owner: string; input: string },
		];
		const taskInput = createCall[0].input;
		expect(taskInput).toContain("Fix the bug");
		expect(taskInput).toEndWith(
			"\n\nhttps://github.com/xmtp/libxmtp/issues/42",
		);
	});

	// AC #4: Only issue URL when no prompt provided
	test("uses only issue URL when no prompt provided", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		runner.getStatus.mockResolvedValue(null);
		runner.create.mockResolvedValue(mockTask);

		const action = new CreateTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		await action.run();

		const createCall = runner.create.mock.calls[0] as unknown as [
			{ taskName: string; owner: string; input: string },
		];
		expect(createCall[0].input).toBe(issueContext.issueUrl);
	});

	// AC #25: Deterministic naming
	test("uses deterministic task name", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		runner.getStatus.mockResolvedValue(null);
		runner.create.mockResolvedValue(mockTask);

		const action = new CreateTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		await action.run();

		const getStatusCall = runner.getStatus.mock.calls[0] as unknown as [
			{ taskName: string; owner?: string },
		];
		expect(String(getStatusCall[0].taskName)).toBe("gh-libxmtp-42");
	});

	test("logs task name via injected logger", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		runner.getStatus.mockResolvedValue(null);
		runner.create.mockResolvedValue(mockTask);

		const action = new CreateTaskAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		await action.run();

		expect(
			logger.messages.some((m) => m.message.includes("gh-libxmtp-42")),
		).toBe(true);
	});
});
