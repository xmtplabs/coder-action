import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventDispatcher } from "./dispatcher";
import type { EventDispatcherOptions } from "./dispatcher";
import {
	MockTaskRunner,
	mockTask,
	createMockGitHubClient,
} from "../testing/helpers";
import { TestLogger } from "../infra/logger";
import type { AppConfig } from "../config/app-config";
import type {
	TaskRequestedEvent,
	TaskClosedEvent,
	CommentPostedEvent,
	CheckFailedEvent,
} from "./types";
import type { GitHubClient, Octokit } from "../services/github/client";

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

function makeTaskRequestedEvent(
	overrides?: Partial<TaskRequestedEvent>,
): TaskRequestedEvent {
	return {
		type: "task_requested",
		source: { type: "github", installationId: INSTALLATION_ID },
		repository: { owner: "xmtp", name: "test-repo" },
		issue: {
			number: 42,
			url: "https://github.com/xmtp/test-repo/issues/42",
		},
		requester: {
			login: "human-dev",
			externalId: 67890,
		},
		...overrides,
	};
}

function makeTaskClosedEvent(
	overrides?: Partial<TaskClosedEvent>,
): TaskClosedEvent {
	return {
		type: "task_closed",
		source: { type: "github", installationId: INSTALLATION_ID },
		repository: { owner: "xmtp", name: "test-repo" },
		issue: { number: 42 },
		...overrides,
	};
}

function makePRCommentEvent(
	overrides?: Partial<CommentPostedEvent>,
): CommentPostedEvent {
	return {
		type: "comment_posted",
		source: { type: "github", installationId: INSTALLATION_ID },
		repository: { owner: "xmtp", name: "test-repo" },
		target: {
			kind: "pull_request",
			number: 5,
			authorLogin: "xmtp-coder-agent",
		},
		comment: {
			id: 1001,
			body: "Please fix the naming.",
			url: "https://github.com/xmtp/test-repo/pull/5#issuecomment-1001",
			createdAt: "2024-01-15T10:00:00Z",
			authorLogin: "human-reviewer",
			isReviewComment: false,
			isReviewSubmission: false,
		},
		...overrides,
	};
}

function makeIssueCommentEvent(
	overrides?: Partial<CommentPostedEvent>,
): CommentPostedEvent {
	return {
		type: "comment_posted",
		source: { type: "github", installationId: INSTALLATION_ID },
		repository: { owner: "xmtp", name: "test-repo" },
		target: {
			kind: "issue",
			number: 42,
			authorLogin: "xmtp-coder-agent",
		},
		comment: {
			id: 1002,
			body: "Can you handle edge cases?",
			url: "https://github.com/xmtp/test-repo/issues/42#issuecomment-1002",
			createdAt: "2024-01-15T11:00:00Z",
			authorLogin: "human-dev",
			isReviewComment: false,
			isReviewSubmission: false,
		},
		...overrides,
	};
}

function makeCheckFailedEvent(
	overrides?: Partial<CheckFailedEvent>,
): CheckFailedEvent {
	return {
		type: "check_failed",
		source: { type: "github", installationId: INSTALLATION_ID },
		repository: { owner: "xmtp", name: "test-repo" },
		run: {
			id: 4001,
			url: "https://github.com/xmtp/test-repo/actions/runs/4001",
			headSha: "abc123def456",
			workflowName: "CI",
			workflowFile: "ci.yml",
		},
		pullRequestNumbers: [5],
		...overrides,
	};
}

describe("EventDispatcher", () => {
	let runner: MockTaskRunner;
	let gh: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;
	let mockOctokit: Octokit;
	let createInstallationOctokit: ReturnType<typeof mock>;
	let dispatcher: EventDispatcher;

	beforeEach(() => {
		runner = new MockTaskRunner();
		gh = createMockGitHubClient();
		logger = new TestLogger();

		// Minimal mock Octokit — we intercept GitHubClient creation so the
		// real octokit is never used; the mock GitHub client methods are called instead.
		mockOctokit = {} as Octokit;
		createInstallationOctokit = mock(() => mockOctokit);

		const options: EventDispatcherOptions = {
			config: mockConfig,
			createInstallationOctokit: createInstallationOctokit as unknown as (
				installationId: number,
			) => Octokit,
			taskRunner: runner,
			logger,
			// Inject mock GitHubClient to avoid real API calls
			createGitHubClient: () => gh as unknown as GitHubClient,
		};
		dispatcher = new EventDispatcher(options);
	});

	// ── task_requested ──────────────────────────────────────────────────────

	describe("task_requested", () => {
		test("calls createInstallationOctokit with the correct installationId", async () => {
			const event = makeTaskRequestedEvent();
			await dispatcher.dispatch(event);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("resolves owner via runner.lookupUser with senderId", async () => {
			const event = makeTaskRequestedEvent();
			await dispatcher.dispatch(event);
			expect(runner.lookupUser).toHaveBeenCalledWith({
				user: {
					type: "github",
					id: "67890",
					username: "human-dev",
				},
			});
		});

		test("creates a task and returns ActionOutputs", async () => {
			runner.getStatus.mockResolvedValue(null);
			runner.create.mockResolvedValue(mockTask);

			const event = makeTaskRequestedEvent();
			const outputs = await dispatcher.dispatch(event);

			expect(outputs.skipped).toBe(false);
			expect(outputs.taskName).toBeDefined();
		});

		test("installation caching: second dispatch reuses Octokit", async () => {
			const event = makeTaskRequestedEvent();
			await dispatcher.dispatch(event);
			await dispatcher.dispatch(event);
			// createInstallationOctokit called once — cached on second call
			expect(createInstallationOctokit).toHaveBeenCalledTimes(1);
		});
	});

	// ── task_closed ──────────────────────────────────────────────────────────

	describe("task_closed", () => {
		test("calls createInstallationOctokit with the correct installationId", async () => {
			const event = makeTaskClosedEvent();
			await dispatcher.dispatch(event);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("deletes task and returns outputs", async () => {
			const event = makeTaskClosedEvent();
			const outputs = await dispatcher.dispatch(event);

			expect(outputs.skipped).toBe(false);
			expect(outputs.taskStatus).toBe("deleted");
			expect(runner.delete).toHaveBeenCalledTimes(1);
		});
	});

	// ── comment_posted (pull_request) ─────────────────────────────────────────

	describe("comment_posted (pull_request)", () => {
		test("calls createInstallationOctokit with the correct installationId", async () => {
			const event = makePRCommentEvent();
			await dispatcher.dispatch(event);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("forwards comment to task and returns outputs", async () => {
			runner.getStatus.mockResolvedValue(mockTask);

			const event = makePRCommentEvent();
			const outputs = await dispatcher.dispatch(event);

			expect(outputs.skipped).toBe(false);
			expect(runner.sendInput).toHaveBeenCalledTimes(1);
		});

		test("skips when PR not authored by agent", async () => {
			const event = makePRCommentEvent({
				target: {
					kind: "pull_request",
					number: 5,
					authorLogin: "other-user",
				},
			});
			const outputs = await dispatcher.dispatch(event);

			expect(outputs.skipped).toBe(true);
			expect(outputs.skipReason).toBe("pr-not-by-coder-agent");
		});

		test("dispatches to PRCommentAction, not IssueCommentAction", async () => {
			runner.getStatus.mockResolvedValue(mockTask);

			const event = makePRCommentEvent();
			await dispatcher.dispatch(event);

			// PRCommentAction calls findLinkedIssues, IssueCommentAction does not
			expect(gh.findLinkedIssues).toHaveBeenCalledTimes(1);
		});
	});

	// ── comment_posted (issue) ────────────────────────────────────────────────

	describe("comment_posted (issue)", () => {
		test("calls createInstallationOctokit with the correct installationId", async () => {
			const event = makeIssueCommentEvent();
			await dispatcher.dispatch(event);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("forwards comment to task and returns outputs", async () => {
			runner.getStatus.mockResolvedValue(mockTask);

			const event = makeIssueCommentEvent();
			const outputs = await dispatcher.dispatch(event);

			expect(outputs.skipped).toBe(false);
			expect(runner.sendInput).toHaveBeenCalledTimes(1);
		});

		test("skips when task is not found", async () => {
			runner.getStatus.mockResolvedValue(null);

			const event = makeIssueCommentEvent();
			const outputs = await dispatcher.dispatch(event);

			expect(outputs.skipped).toBe(true);
			expect(outputs.skipReason).toBe("task-not-found");
		});

		test("dispatches to IssueCommentAction, not PRCommentAction", async () => {
			runner.getStatus.mockResolvedValue(mockTask);

			const event = makeIssueCommentEvent();
			await dispatcher.dispatch(event);

			// IssueCommentAction does NOT call findLinkedIssues
			expect(gh.findLinkedIssues).not.toHaveBeenCalled();
		});
	});

	// ── check_failed ─────────────────────────────────────────────────────────

	describe("check_failed", () => {
		test("calls createInstallationOctokit with the correct installationId", async () => {
			const event = makeCheckFailedEvent();
			await dispatcher.dispatch(event);
			expect(createInstallationOctokit).toHaveBeenCalledWith(INSTALLATION_ID);
		});

		test("skips when PR not authored by agent", async () => {
			gh.getPR.mockResolvedValue({
				number: 5,
				user: { login: "other-user" },
				head: { sha: "abc123def456" },
			});

			const event = makeCheckFailedEvent();
			const outputs = await dispatcher.dispatch(event);

			expect(outputs.skipped).toBe(true);
			expect(outputs.skipReason).toBe("pr-not-by-coder-agent");
		});

		test("forwards failed check details to task when all conditions met", async () => {
			// PR sha must match headSha in event to pass the stale-commit guard
			gh.getPR.mockResolvedValue({
				number: 5,
				user: { login: "xmtp-coder-agent" },
				head: { sha: "abc123def456" },
			});
			runner.getStatus.mockResolvedValue(mockTask);

			const event = makeCheckFailedEvent();
			const outputs = await dispatcher.dispatch(event);

			expect(outputs.skipped).toBe(false);
			expect(runner.sendInput).toHaveBeenCalledTimes(1);
		});
	});

	// ── installation caching (cross-event) ───────────────────────────────────

	describe("installation caching", () => {
		test("two dispatches with same installationId reuse the Octokit instance", async () => {
			const event1 = makeTaskClosedEvent();
			const event2 = makeTaskClosedEvent();

			await dispatcher.dispatch(event1);
			await dispatcher.dispatch(event2);

			expect(createInstallationOctokit).toHaveBeenCalledTimes(1);
		});

		test("two dispatches with different installationIds create separate Octokits", async () => {
			const event1 = makeTaskClosedEvent({
				source: { type: "github", installationId: 11111 },
			});
			const event2 = makeTaskClosedEvent({
				source: { type: "github", installationId: 22222 },
			});

			await dispatcher.dispatch(event1);
			await dispatcher.dispatch(event2);

			expect(createInstallationOctokit).toHaveBeenCalledTimes(2);
			expect(createInstallationOctokit).toHaveBeenCalledWith(11111);
			expect(createInstallationOctokit).toHaveBeenCalledWith(22222);
		});
	});
});
