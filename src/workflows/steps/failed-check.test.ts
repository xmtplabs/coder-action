import { describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../../config/app-config";
import type { CheckFailedEvent } from "../../events/types";
import { runFailedCheck } from "./failed-check";

function makeStep() {
	const calls: string[] = [];
	const step = {
		calls,
		do: vi.fn(async (name: string, ...rest: unknown[]) => {
			calls.push(name);
			const fn = rest[rest.length - 1] as () => Promise<unknown>;
			return fn();
		}),
		sleep: vi.fn(async () => {}),
	};
	return step;
}

const config = {
	coderTaskNamePrefix: "gh",
	agentGithubUsername: "xmtp-coder-agent",
} as unknown as AppConfig;

function event(pullRequestNumbers: number[] = [5]): CheckFailedEvent {
	return {
		type: "check_failed",
		source: { type: "github", installationId: 1 },
		repository: { owner: "acme", name: "repo" },
		run: {
			id: 999,
			url: "https://github.com/acme/repo/runs/999",
			headSha: "abc123",
			workflowName: "ci",
			workflowFile: ".github/workflows/ci.yml",
		},
		pullRequestNumbers,
	};
}

describe("runFailedCheck", () => {
	test("returns early when no PR linked", async () => {
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => null),
			getTaskById: vi.fn(async () => ({})),
			resumeWorkspace: vi.fn(async () => {}),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			getPR: vi.fn(async () => null),
			findPRByHeadSHA: vi.fn(async () => null),
			findLinkedIssues: vi.fn(async () => []),
			getFailedJobs: vi.fn(async () => []),
			getJobLogs: vi.fn(async () => ""),
		};
		await runFailedCheck({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: event([]),
		});
		// fetch-pr-info ran; no fetch-failed-jobs / send-task-input
		expect(step.calls).toContain("fetch-pr-info");
		expect(step.calls).not.toContain("send-task-input");
	});

	test("emits expected step sequence when PR + task exist", async () => {
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				owner_id: "owner-uuid",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			getTaskById: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			resumeWorkspace: vi.fn(async () => {}),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			getPR: vi.fn(async () => ({
				number: 5,
				user: { login: "xmtp-coder-agent" },
				head: { sha: "abc123" },
			})),
			findPRByHeadSHA: vi.fn(async () => null),
			findLinkedIssues: vi.fn(async () => [
				{
					number: 7,
					title: "Bug",
					state: "OPEN",
					url: "https://github.com/acme/repo/issues/7",
				},
			]),
			getFailedJobs: vi.fn(async () => [
				{ id: 1, name: "test", conclusion: "failure" },
			]),
			getJobLogs: vi.fn(async () => "log line 1"),
		};
		await runFailedCheck({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: event(),
		});
		expect(step.calls).toContain("fetch-pr-info");
		expect(step.calls).toContain("find-linked-issues");
		expect(step.calls).toContain("locate-task");
		expect(step.calls).toContain("fetch-failed-jobs");
		// Step name includes the job id so multi-job PRs don't collide on the
		// replay cache (one name per instance — Workflows contract).
		expect(step.calls).toContain("fetch-job-logs-1");
		expect(step.calls).toContain("send-task-input");
	});

	test("fetch-job-logs step name is unique per job id (avoids replay-cache collision)", async () => {
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				owner_id: "owner-uuid",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			getTaskById: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			resumeWorkspace: vi.fn(async () => {}),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			getPR: vi.fn(async () => ({
				number: 5,
				user: { login: "xmtp-coder-agent" },
				head: { sha: "abc123" },
			})),
			findPRByHeadSHA: vi.fn(async () => null),
			findLinkedIssues: vi.fn(async () => [
				{ number: 7, title: "Bug", state: "OPEN", url: "u" },
			]),
			getFailedJobs: vi.fn(async () => [
				{ id: 101, name: "unit-test", conclusion: "failure" },
				{ id: 202, name: "e2e-test", conclusion: "failure" },
			]),
			getJobLogs: vi.fn(async () => "log"),
		};
		await runFailedCheck({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: event(),
		});
		const logsCalls = step.calls.filter((c: string) =>
			c.startsWith("fetch-job-logs-"),
		);
		expect(logsCalls).toEqual(["fetch-job-logs-101", "fetch-job-logs-202"]);
		// All step names are unique within the instance.
		expect(new Set(step.calls).size).toBe(step.calls.length);
	});

	test("fetch-failed-jobs returns plain array", async () => {
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				owner_id: "owner-uuid",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			getTaskById: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			resumeWorkspace: vi.fn(async () => {}),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			getPR: vi.fn(async () => ({
				number: 5,
				user: { login: "xmtp-coder-agent" },
				head: { sha: "abc123" },
			})),
			findPRByHeadSHA: vi.fn(async () => null),
			findLinkedIssues: vi.fn(async () => [
				{ number: 7, title: "B", state: "OPEN", url: "u" },
			]),
			getFailedJobs: vi.fn(async () => [
				{ id: 1, name: "unit", conclusion: "failure" },
			]),
			getJobLogs: vi.fn(async () => "log"),
		};
		await runFailedCheck({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: event(),
		});
		// fetch-failed-jobs returns the scalar projection per spec §4
		// serialization table: Array<{ id, name, conclusion }> — no extra raw
		// Octokit fields.
		const failedJobsIdx = step.do.mock.calls.findIndex(
			(c: unknown[]) => c[0] === "fetch-failed-jobs",
		);
		const failedJobsResult = await step.do.mock.results[failedJobsIdx]?.value;
		expect(failedJobsResult).toEqual([
			{ id: 1, name: "unit", conclusion: "failure" },
		]);

		// fetch-job-logs-<id> returns a plain string.
		const logsIdx = step.do.mock.calls.findIndex(
			(c: unknown[]) => c[0] === "fetch-job-logs-1",
		);
		const logsResult = await step.do.mock.results[logsIdx]?.value;
		expect(logsResult).toBe("log");
	});
});
