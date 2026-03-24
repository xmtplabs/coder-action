import { beforeEach, describe, expect, test } from "bun:test";
import { TestLogger } from "../logger";
import type { FailedCheckInputs } from "../schemas";
import {
	MockCoderClient,
	createMockGitHubClient,
	mockTask,
} from "../test-helpers";
import { FailedCheckHandler } from "./failed-check";
import type { FailedCheckContext } from "./failed-check";

const baseInputs: FailedCheckInputs = {
	action: "failed_check",
	coderURL: "https://coder.test",
	coderToken: "token",
	coderUsername: "coder-agent",
	coderTaskNamePrefix: "gh",
	githubToken: "ghp_123",
	coderGithubUsername: "xmtp-coder-agent",
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

describe("FailedCheckHandler", () => {
	let coder: MockCoderClient;
	let github: ReturnType<typeof createMockGitHubClient>;
	let logger: TestLogger;

	beforeEach(() => {
		coder = new MockCoderClient();
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
		coder.getTask.mockResolvedValue(mockTask as never);
	});

	// AC #16: Forward failed check logs
	test("fetches failed job logs and sends formatted message", async () => {
		const handler = new FailedCheckHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(false);
		expect(github.getFailedJobs).toHaveBeenCalledWith("xmtp", "libxmtp", 12345);
		expect(github.getJobLogs).toHaveBeenCalledTimes(1);
		expect(coder.sendTaskInput).toHaveBeenCalledTimes(1);
		const sentMessage = (
			coder.sendTaskInput.mock.calls[0] as unknown as [string, unknown, string]
		)[2];
		expect(sentMessage).toContain("CI Check Failed on PR:");
		expect(sentMessage).toContain("test assertion failed");
	});

	// AC #17: PR not by agent
	test("skips when PR not authored by coder agent", async () => {
		github.getPR.mockResolvedValue({
			number: 5,
			user: { login: "other-dev" },
			head: { sha: "abc123" },
		});

		const handler = new FailedCheckHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await handler.run();

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

		const handler = new FailedCheckHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await handler.run();

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

		const handler = new FailedCheckHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await handler.run();

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

		const handler = new FailedCheckHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			ctx,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("no-pr-found");
	});

	// Edge: no linked issue
	test("skips when no linked issue found", async () => {
		github.findLinkedIssues.mockResolvedValue([]);

		const handler = new FailedCheckHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain("no-linked-issue");
	});

	// Edge: task not found
	test("skips when task not found", async () => {
		coder.getTask.mockResolvedValue(null);

		const handler = new FailedCheckHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		const result = await handler.run();

		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain("task-not-found");
	});

	// Edge: caps at 5 failed jobs
	test("caps at 5 failed jobs in message", async () => {
		const jobs = Array.from({ length: 8 }, (_, i) => ({
			id: i + 1,
			name: `job-${i}`,
			conclusion: "failure",
		}));
		github.getFailedJobs.mockResolvedValue(jobs);
		github.getJobLogs.mockResolvedValue("failure output");

		const handler = new FailedCheckHandler(
			coder,
			github as unknown as import("../github-client").GitHubClient,
			baseInputs,
			validContext,
			logger,
		);
		await handler.run();

		// Should only fetch logs for first 5 jobs
		expect(github.getJobLogs).toHaveBeenCalledTimes(5);
	});
});
