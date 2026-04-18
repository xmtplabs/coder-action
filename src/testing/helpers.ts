import { mock } from "bun:test";
import type { GitHubClient } from "../services/github/client";
import type { Task, TaskName, TaskRunner } from "../services/task-runner";
import { TaskNameSchema as TaskRunnerNameSchema } from "../services/task-runner";

// ── Mock Task Data (TaskRunner-shape) ───────────────────────────────────────

export const mockTask: Task = {
	name: TaskRunnerNameSchema.parse("gh-test-repo-42"),
	status: "ready",
	owner: "test-coder-user",
	url: "https://coder.example.com/tasks/test-coder-user/550e8400-e29b-41d4-a716-446655440000",
};

export const mockStoppedTask: Task = {
	...mockTask,
	status: "stopped",
};

export const mockErrorTask: Task = {
	...mockTask,
	status: "error",
};

// ── Mock Task Runner ────────────────────────────────────────────────────────

export class MockTaskRunner implements TaskRunner {
	lookupUser = mock(
		async (_: { user: { type: "github"; id: string; username: string } }) =>
			"test-coder-user",
	);
	create = mock(
		async (_: { taskName: TaskName; owner: string; input: string }) => mockTask,
	);
	sendInput = mock(
		async (_: {
			taskName: TaskName;
			owner?: string;
			input: string;
			timeout?: number;
		}) => {},
	);
	getStatus = mock(
		async (_: { taskName: TaskName; owner?: string }): Promise<Task | null> =>
			null,
	);
	delete = mock(async (_: { taskName: TaskName; owner?: string }) => {});
}

// ── Mock GitHub Client ──────────────────────────────────────────────────────

export function createMockGitHubClient(): {
	[K in keyof GitHubClient]: ReturnType<typeof mock>;
} {
	return {
		checkActorPermission: mock(() => Promise.resolve(true)),
		findLinkedIssues: mock(() =>
			Promise.resolve([
				{
					number: 42,
					title: "Bug",
					state: "OPEN",
					url: "https://github.com/org/repo/issues/42",
				},
			]),
		),
		commentOnIssue: mock(() => Promise.resolve()),
		findPRByHeadSHA: mock(() => Promise.resolve(null)),
		getPR: mock(() =>
			Promise.resolve({
				number: 1,
				user: { login: "xmtp-coder-agent" },
				head: { sha: "abc123" },
			}),
		),
		getFailedJobs: mock(() =>
			Promise.resolve([{ id: 1, name: "test", conclusion: "failure" }]),
		),
		getJobLogs: mock(() => Promise.resolve("Error: test failed")),
		addReactionToComment: mock(() => Promise.resolve()),
		addReactionToReviewComment: mock(() => Promise.resolve()),
	} as unknown as { [K in keyof GitHubClient]: ReturnType<typeof mock> };
}
