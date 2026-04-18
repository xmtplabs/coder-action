import { beforeEach, describe, expect, mock, test } from "bun:test";
import { HandlerDispatcher } from "./handler-dispatcher";
import type { HandlerDispatcherOptions } from "./handler-dispatcher";
import {
	MockCoderClient,
	createMockGitHubClient,
	mockTask,
} from "./testing/helpers";
import { TestLogger } from "./infra/logger";
import type { AppConfig } from "./config/app-config";
import type {
	RouteResult,
	CreateTaskContext,
	CloseTaskContext,
	PRCommentContext,
	IssueCommentContext,
	FailedCheckContext,
} from "./webhook-router";
import type { GitHubClient, Octokit } from "./github-client";

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockConfig: AppConfig = {
	appId: "app-123",
	privateKey:
		"-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
	webhookSecret: "secret",
	agentGithubUsername: "xmtp-coder-agent",
	coderURL: "https://coder.example.com",
	coderToken: "coder-token",
	coderTaskNamePrefix: "gh",
	coderTemplateName: "task-template",
	coderTemplateNameCodex: "task-template-codex",
	coderOrganization: "default",
	port: 3000,
};

const INSTALLATION_ID = 99999;

type DispatchedResult = Extract<RouteResult, { dispatched: true }>;

function makeDispatchedResult(
	handler: DispatchedResult["handler"],
	context:
		| CreateTaskContext
		| CloseTaskContext
		| PRCommentContext
		| IssueCommentContext
		| FailedCheckContext,
): DispatchedResult {
	return {
		dispatched: true,
		handler,
		installationId: INSTALLATION_ID,
		context,
	} as DispatchedResult;
}

describe("HandlerDispatcher", () => {
	let coder: MockCoderClient;
	let gh: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;
	let mockOctokit: Octokit;
	let createInstallationOctokit: ReturnType<typeof mock>;
	let dispatcher: HandlerDispatcher;

	beforeEach(() => {
		coder = new MockCoderClient();
		gh = createMockGitHubClient();
		logger = new TestLogger();

		// Minimal mock Octokit — we intercept GitHubClient creation so the
		// real octokit is never used; the mock GitHub client methods are called instead.
		mockOctokit = {} as Octokit;
		createInstallationOctokit = mock(() => mockOctokit);

		const options: HandlerDispatcherOptions = {
			config: mockConfig,
			createInstallationOctokit: createInstallationOctokit as unknown as (
				installationId: number,
			) => Octokit,
			coderClient: coder,
			logger,
			// Inject mock GitHubClient to avoid real API calls
			createGitHubClient: () => gh as unknown as GitHubClient,
		};
		dispatcher = new HandlerDispatcher(options);
	});

	// ── create_task ──────────────────────────────────────────────────────────

	describe("create_task", () => {
		const createTaskContext = {
			issueNumber: 42,
			issueUrl: "https://github.com/xmtp/test-repo/issues/42",
			issueTitle: "Fix some bug",
			issueLabels: [] as string[],
			repoName: "test-repo",
			repoOwner: "xmtp",
			senderLogin: "human-dev",
			senderId: 67890,
		};

		test("calls createInstallationOctokit with the correct installationId", async () => {
			const result = makeDispatchedResult("create_task", createTaskContext);
			await dispatcher.dispatch(result);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("resolves coder username via getCoderUserByGitHubId with senderId", async () => {
			const result = makeDispatchedResult("create_task", createTaskContext);
			await dispatcher.dispatch(result);
			expect(coder.getCoderUserByGitHubId).toHaveBeenCalledWith(67890);
		});

		test("creates a task and returns ActionOutputs", async () => {
			coder.getTask.mockResolvedValue(null);
			coder.createTask.mockResolvedValue(mockTask);

			const result = makeDispatchedResult("create_task", createTaskContext);
			const outputs = await dispatcher.dispatch(result);

			expect(outputs.skipped).toBe(false);
			expect(outputs.taskName).toBeDefined();
		});
	});

	// ── close_task ───────────────────────────────────────────────────────────

	describe("close_task", () => {
		const closeTaskContext = {
			issueNumber: 42,
			repoName: "test-repo",
			repoOwner: "xmtp",
		};

		test("calls createInstallationOctokit with the correct installationId", async () => {
			const result = makeDispatchedResult("close_task", closeTaskContext);
			await dispatcher.dispatch(result);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("skips when no task is found", async () => {
			coder.getTask.mockResolvedValue(null);

			const result = makeDispatchedResult("close_task", closeTaskContext);
			const outputs = await dispatcher.dispatch(result);

			expect(outputs.skipped).toBe(true);
			expect(outputs.skipReason).toBe("task-not-found");
		});

		test("deletes task and returns outputs when task exists", async () => {
			coder.getTask.mockResolvedValue(mockTask as never);

			const result = makeDispatchedResult("close_task", closeTaskContext);
			const outputs = await dispatcher.dispatch(result);

			expect(outputs.skipped).toBe(false);
			expect(outputs.taskStatus).toBe("deleted");
		});
	});

	// ── pr_comment ───────────────────────────────────────────────────────────

	describe("pr_comment", () => {
		const prCommentContext = {
			issueNumber: 5,
			commentBody: "Please fix the naming.",
			commentUrl: "https://github.com/xmtp/test-repo/pull/5#issuecomment-1001",
			commentId: 1001,
			commentCreatedAt: "2024-01-15T10:00:00Z",
			repoName: "test-repo",
			repoOwner: "xmtp",
			prAuthor: "xmtp-coder-agent",
			commenterLogin: "human-reviewer",
			isReviewComment: false,
			isReviewSubmission: false,
		};

		test("calls createInstallationOctokit with the correct installationId", async () => {
			const result = makeDispatchedResult("pr_comment", prCommentContext);
			await dispatcher.dispatch(result);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("forwards comment to task and returns outputs", async () => {
			coder.getTask.mockResolvedValue(mockTask as never);

			const result = makeDispatchedResult("pr_comment", prCommentContext);
			const outputs = await dispatcher.dispatch(result);

			expect(outputs.skipped).toBe(false);
			expect(coder.sendTaskInput).toHaveBeenCalled();
		});

		test("skips when PR not authored by agent", async () => {
			const context = { ...prCommentContext, prAuthor: "other-user" };
			const result = makeDispatchedResult("pr_comment", context);
			const outputs = await dispatcher.dispatch(result);

			expect(outputs.skipped).toBe(true);
			expect(outputs.skipReason).toBe("pr-not-by-coder-agent");
		});
	});

	// ── issue_comment ─────────────────────────────────────────────────────────

	describe("issue_comment", () => {
		const issueCommentContext = {
			issueNumber: 42,
			commentBody: "Can you handle edge cases?",
			commentUrl:
				"https://github.com/xmtp/test-repo/issues/42#issuecomment-1002",
			commentId: 1002,
			commentCreatedAt: "2024-01-15T11:00:00Z",
			repoName: "test-repo",
			repoOwner: "xmtp",
			commenterLogin: "human-dev",
		};

		test("calls createInstallationOctokit with the correct installationId", async () => {
			const result = makeDispatchedResult("issue_comment", issueCommentContext);
			await dispatcher.dispatch(result);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("forwards comment to task and returns outputs", async () => {
			coder.getTask.mockResolvedValue(mockTask as never);

			const result = makeDispatchedResult("issue_comment", issueCommentContext);
			const outputs = await dispatcher.dispatch(result);

			expect(outputs.skipped).toBe(false);
			expect(coder.sendTaskInput).toHaveBeenCalled();
		});

		test("skips when task is not found", async () => {
			coder.getTask.mockResolvedValue(null);

			const result = makeDispatchedResult("issue_comment", issueCommentContext);
			const outputs = await dispatcher.dispatch(result);

			expect(outputs.skipped).toBe(true);
			expect(outputs.skipReason).toBe("task-not-found");
		});
	});

	// ── failed_check ─────────────────────────────────────────────────────────

	describe("failed_check", () => {
		const failedCheckContext = {
			workflowRunId: 4001,
			workflowName: "CI",
			workflowPath: ".github/workflows/ci.yml",
			headSha: "abc123def456",
			workflowRunUrl: "https://github.com/xmtp/test-repo/actions/runs/4001",
			conclusion: "failure",
			pullRequestNumbers: [5],
			repoName: "test-repo",
			repoOwner: "xmtp",
		};

		test("calls createInstallationOctokit with the correct installationId", async () => {
			const result = makeDispatchedResult("failed_check", failedCheckContext);
			await dispatcher.dispatch(result);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("skips when PR not authored by agent", async () => {
			gh.getPR.mockResolvedValue({
				number: 5,
				user: { login: "other-user" },
				head: { sha: "abc123def456" },
			});

			const result = makeDispatchedResult("failed_check", failedCheckContext);
			const outputs = await dispatcher.dispatch(result);

			expect(outputs.skipped).toBe(true);
			expect(outputs.skipReason).toBe("pr-not-by-coder-agent");
		});

		test("forwards failed check details to task when all conditions met", async () => {
			// PR sha must match headSha in context to pass the stale-commit guard
			gh.getPR.mockResolvedValue({
				number: 5,
				user: { login: "xmtp-coder-agent" },
				head: { sha: "abc123def456" },
			});
			coder.getTask.mockResolvedValue(mockTask as never);

			const result = makeDispatchedResult("failed_check", failedCheckContext);
			const outputs = await dispatcher.dispatch(result);

			expect(outputs.skipped).toBe(false);
			expect(coder.sendTaskInput).toHaveBeenCalled();
		});
	});
});
