import { vi } from "vitest";
import type { GitHubClient } from "../services/github/client";
import type {
	Task,
	TaskId,
	TaskName,
	TaskRunner,
} from "../services/task-runner";
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
	lookupUser = vi.fn(
		async (_: { user: { type: "github"; id: string; username: string } }) =>
			"test-coder-user",
	);
	findTaskByName = vi.fn(
		async (_: TaskName, __?: string): Promise<unknown | null> => null,
	);
	getTaskById = vi.fn(
		async (_: TaskId, __: string): Promise<unknown> => ({
			id: "00000000-0000-0000-0000-000000000000",
			status: "active",
			current_state: { state: "idle" },
			workspace_id: "00000000-0000-0000-0000-000000000099",
		}),
	);
	create = vi.fn(
		async (_: { taskName: TaskName; owner: string; input: string }) => mockTask,
	);
	resumeWorkspace = vi.fn(async (_: string): Promise<void> => {});
	sendTaskInput = vi.fn(
		async (_: TaskId, __: string, ___: string): Promise<void> => {},
	);
	delete = vi.fn(
		async (_: { taskName: TaskName; owner?: string }) =>
			({ deleted: true }) as { deleted: boolean },
	);
}

// ── Mock GitHub Client ──────────────────────────────────────────────────────

export function createMockGitHubClient(): {
	[K in keyof GitHubClient]: ReturnType<typeof vi.fn>;
} {
	return {
		checkActorPermission: vi.fn(() => Promise.resolve(true)),
		findLinkedIssues: vi.fn(() =>
			Promise.resolve([
				{
					number: 42,
					title: "Bug",
					state: "OPEN",
					url: "https://github.com/org/repo/issues/42",
				},
			]),
		),
		commentOnIssue: vi.fn(() => Promise.resolve()),
		findPRByHeadSHA: vi.fn(() => Promise.resolve(null)),
		getPR: vi.fn(() =>
			Promise.resolve({
				number: 1,
				user: { login: "xmtp-coder-agent" },
				head: { sha: "abc123" },
			}),
		),
		getFailedJobs: vi.fn(() =>
			Promise.resolve([{ id: 1, name: "test", conclusion: "failure" }]),
		),
		getJobLogs: vi.fn(() => Promise.resolve("Error: test failed")),
		addReactionToComment: vi.fn(() => Promise.resolve()),
		addReactionToReviewComment: vi.fn(() => Promise.resolve()),
	} as unknown as { [K in keyof GitHubClient]: ReturnType<typeof vi.fn> };
}
