import { beforeEach, describe, expect, test } from "bun:test";
import { TestLogger } from "../infra/logger";
import type { HandlerConfig } from "../config/handler-config";
import {
	MockTaskRunner,
	mockTask,
	mockErrorTask,
	createMockGitHubClient,
} from "../testing/helpers";
import { FailedCheckAction } from "./failed-check";
import type { FailedCheckContext } from "./failed-check";

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

const validContext: FailedCheckContext = {
	owner: "xmtp",
	repo: "libxmtp",
	runId: 12345,
	runUrl: "https://github.com/xmtp/libxmtp/actions/runs/12345",
	headSha: "abc123",
	workflowName: "CI",
	workflowFile: "ci.yml",
	pullRequests: [{ number: 5 }],
};

describe("FailedCheckAction", () => {
	let runner: MockTaskRunner;
	let github: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;

	beforeEach(() => {
		runner = new MockTaskRunner();
		github = createMockGitHubClient();
		logger = new TestLogger();
		// Defaults: PR by agent, matching SHA, linked issue, task exists
		github.getPR.mockResolvedValue({
			number: 5,
			user: { login: "xmtp-coder-agent" },
			head: { sha: "abc123" },
		});
		github.findLinkedIssues.mockResolvedValue([
			{
				number: 42,
				title: "Bug",
				state: "OPEN",
				url: "https://github.com/xmtp/libxmtp/issues/42",
			},
		]);
		github.getFailedJobs.mockResolvedValue([
			{ id: 1, name: "test", conclusion: "failure" },
		]);
		github.getJobLogs.mockResolvedValue(
			"Error: test assertion failed\n  at test.ts:42",
		);
		runner.getStatus.mockResolvedValue(mockTask);
	});

	// AC #16: Happy path — fetches failed job logs, sends formatted message
	test("fetches failed job logs and sends formatted message", async () => {
		const action = new FailedCheckAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(false);
		expect(github.getFailedJobs).toHaveBeenCalledWith("xmtp", "libxmtp", 12345);
		expect(github.getJobLogs).toHaveBeenCalledTimes(1);
		expect(runner.sendInput).toHaveBeenCalledTimes(1);
		const sendArgs = runner.sendInput.mock.calls[0] as unknown as [
			{ taskName: string; input: string; timeout: number },
		];
		// linked issue #42 → task name includes issue number
		expect(String(sendArgs[0].taskName)).toBe("gh-libxmtp-42");
		expect(sendArgs[0].input).toContain("CI Check Failed on PR:");
		expect(sendArgs[0].input).toContain("test assertion failed");
		expect(sendArgs[0].timeout).toBe(120_000);
	});

	// No reaction calls for failed-check
	test("does not add any reactions", async () => {
		const action = new FailedCheckAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		await action.run();

		expect(github.addReactionToComment).not.toHaveBeenCalled();
		expect(github.addReactionToReviewComment).not.toHaveBeenCalled();
	});

	// AC #17: PR not by agent
	test("skips when PR not authored by coder agent", async () => {
		github.getPR.mockResolvedValue({
			number: 5,
			user: { login: "other-dev" },
			head: { sha: "abc123" },
		});

		const action = new FailedCheckAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("pr-not-by-coder-agent");
	});

	// AC #18: Stale commit
	test("skips when head SHA doesn't match (stale commit)", async () => {
		github.getPR.mockResolvedValue({
			number: 5,
			user: { login: "xmtp-coder-agent" },
			head: { sha: "newer-sha-456" },
		});

		const action = new FailedCheckAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("stale-commit");
	});

	// AC #19: Fork PR fallback
	test("falls back to PR lookup by SHA when pull_requests empty", async () => {
		const ctx = { ...validContext, pullRequests: [] };
		github.findPRByHeadSHA.mockResolvedValue({
			number: 5,
			user: { login: "xmtp-coder-agent" },
			head: { sha: "abc123" },
		});

		const action = new FailedCheckAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(false);
		expect(github.findPRByHeadSHA).toHaveBeenCalledWith(
			"xmtp",
			"libxmtp",
			"abc123",
		);
	});

	// Edge: no PR found at all
	test("skips when no PR found", async () => {
		const ctx = { ...validContext, pullRequests: [] };
		github.findPRByHeadSHA.mockResolvedValue(null);

		const action = new FailedCheckAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("no-pr-found");
	});

	// Edge: no linked issue
	test("skips when no linked issue found", async () => {
		github.findLinkedIssues.mockResolvedValue([]);

		const action = new FailedCheckAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await action.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("no-linked-issue");
	});

	// Edge: task not found
	test("skips when task not found", async () => {
		runner.getStatus.mockResolvedValue(null);

		const action = new FailedCheckAction(
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

	// Edge: task in error state — skip
	test("skips when task is in error state", async () => {
		runner.getStatus.mockResolvedValue(mockErrorTask);

		const action = new FailedCheckAction(
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

	// Edge: caps at MAX_FAILED_JOBS (5) failed jobs
	test("caps at 5 failed jobs in message", async () => {
		const jobs = Array.from({ length: 8 }, (_, i) => ({
			id: i + 1,
			name: `job-${i}`,
			conclusion: "failure",
		}));
		github.getFailedJobs.mockResolvedValue(jobs);
		github.getJobLogs.mockResolvedValue("failure output");

		const action = new FailedCheckAction(
			runner,
			github as unknown as import("../services/github/client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		await action.run();

		// Should only fetch logs for first 5 jobs
		expect(github.getJobLogs).toHaveBeenCalledTimes(5);
	});
});
