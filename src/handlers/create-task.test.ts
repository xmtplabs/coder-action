import { beforeEach, describe, expect, test } from "bun:test";
import {
	MockCoderClient,
	createMockGitHubClient,
	mockStoppedTask,
	mockTask,
} from "../test-helpers";
import type { HandlerConfig } from "../config/handler-config";
import { TestLogger } from "../infra/logger";
import { CreateTaskHandler } from "./create-task";

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
};

describe("CreateTaskHandler", () => {
	let coder: MockCoderClient;
	let github: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;

	beforeEach(() => {
		coder = new MockCoderClient();
		github = createMockGitHubClient();
		logger = new TestLogger();
	});

	// AC #1: Create task and post comment
	test("creates task and comments on issue for org member", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(null);
		coder.createTask.mockResolvedValue(mockTask);

		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(result.taskName).toBe("gh-libxmtp-42");
		expect(coder.createTask).toHaveBeenCalledTimes(1);
		expect(github.commentOnIssue).toHaveBeenCalledTimes(1);
	});

	// AC #2: Unauthorized actor rejected
	test("skips for actor without write access", async () => {
		github.checkActorPermission.mockResolvedValue(false);

		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("insufficient-permissions");
		expect(coder.createTask).not.toHaveBeenCalled();
	});

	// AC #4: Issue URL appended to prompt
	test("appends issue URL to prompt", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(null);
		coder.createTask.mockResolvedValue(mockTask);

		const inputs = { ...baseInputs, prompt: "Fix the bug" };
		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			inputs,
			issueContext,
			logger,
		);
		await handler.run();

		const createCall = coder.createTask.mock.calls[0] as unknown as [
			string,
			{ input: string },
		];
		const taskInput = createCall[1].input;
		expect(taskInput).toContain("Fix the bug");
		expect(taskInput).toEndWith(
			"\n\nhttps://github.com/xmtp/libxmtp/issues/42",
		);
	});

	// AC #4: Only issue URL when no prompt provided
	test("uses only issue URL when no prompt provided", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(null);
		coder.createTask.mockResolvedValue(mockTask);

		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		await handler.run();

		const createCall = coder.createTask.mock.calls[0] as unknown as [
			string,
			{ input: string },
		];
		expect(createCall[1].input).toBe(issueContext.issueUrl);
	});

	// AC #5: Existing running task
	test("skips creation when task already running", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(mockTask as never);

		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(result.taskName).toBe("gh-libxmtp-42");
		expect(coder.createTask).not.toHaveBeenCalled();
	});

	// AC #6: Existing stopped task — restart
	test("restarts stopped task", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(mockStoppedTask as never);

		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(coder.waitForTaskActive).toHaveBeenCalledTimes(1);
		expect(coder.createTask).not.toHaveBeenCalled();
	});

	// AC #25: Deterministic naming
	test("uses deterministic task name", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(null);
		coder.createTask.mockResolvedValue(mockTask);

		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		await handler.run();

		const taskNameArg = (
			coder.getTask.mock.calls[0] as unknown as [string, unknown]
		)[1];
		expect(String(taskNameArg)).toBe("gh-libxmtp-42");
	});

	test("uses codex template when issue title contains codex", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(null);
		coder.createTask.mockResolvedValue(mockTask);

		const ctx = {
			...issueContext,
			issueTitle: "Add Codex Support",
		};
		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		await handler.run();

		const templateCall = coder.getTemplateByOrganizationAndName.mock
			.calls[0] as unknown as [string, string];
		expect(templateCall[1]).toBe("task-template-codex");
	});

	test("uses codex template when issue has codex label", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(null);
		coder.createTask.mockResolvedValue(mockTask);

		const ctx = {
			...issueContext,
			issueLabels: ["enhancement", "codex"],
		};
		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		await handler.run();

		const templateCall = coder.getTemplateByOrganizationAndName.mock
			.calls[0] as unknown as [string, string];
		expect(templateCall[1]).toBe("task-template-codex");
	});

	test("uses default template when no codex indicator", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(null);
		coder.createTask.mockResolvedValue(mockTask);

		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		await handler.run();

		const templateCall = coder.getTemplateByOrganizationAndName.mock
			.calls[0] as unknown as [string, string];
		expect(templateCall[1]).toBe("task-template");
	});

	test("codex match in title is case insensitive", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(null);
		coder.createTask.mockResolvedValue(mockTask);

		const ctx = {
			...issueContext,
			issueTitle: "Use CODEX for processing",
		};
		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		await handler.run();

		const templateCall = coder.getTemplateByOrganizationAndName.mock
			.calls[0] as unknown as [string, string];
		expect(templateCall[1]).toBe("task-template-codex");
	});

	test("logs task name via injected logger", async () => {
		github.checkActorPermission.mockResolvedValue(true);
		coder.getTask.mockResolvedValue(null);
		coder.createTask.mockResolvedValue(mockTask);

		const handler = new CreateTaskHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			issueContext,
			logger,
		);
		await handler.run();

		expect(
			logger.messages.some((m) => m.message.includes("gh-libxmtp-42")),
		).toBe(true);
	});
});
