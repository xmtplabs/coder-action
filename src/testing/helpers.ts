import { mock } from "bun:test";
import type {
	CoderClient,
	ExperimentalCoderSDKTask,
} from "../services/coder/client";
import { TaskIdSchema, TaskNameSchema } from "../services/coder/client";
import type { GitHubClient } from "../services/github/client";
import type { Task, TaskName, TaskRunner } from "../services/task-runner";
import { TaskNameSchema as TaskRunnerNameSchema } from "../services/task-runner";

// ── Mock Task Data ──────────────────────────────────────────────────────────

export const mockTask: ExperimentalCoderSDKTask = {
	id: TaskIdSchema.parse("550e8400-e29b-41d4-a716-446655440000"),
	name: TaskNameSchema.parse("gh-repo-42"),
	owner_id: "550e8400-e29b-41d4-a716-446655440001",
	template_id: "550e8400-e29b-41d4-a716-446655440002",
	workspace_id: "550e8400-e29b-41d4-a716-446655440003",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
	status: "active",
	current_state: { state: "idle" },
};

export const mockStoppedTask: ExperimentalCoderSDKTask = {
	...mockTask,
	status: "paused",
	current_state: null,
};

export const mockErrorTask: ExperimentalCoderSDKTask = {
	...mockTask,
	status: "error",
	current_state: null,
};

export const mockTemplate = {
	id: "550e8400-e29b-41d4-a716-446655440010",
	name: "task-template",
	description: "AI task template",
	organization_id: "550e8400-e29b-41d4-a716-446655440020",
	active_version_id: "550e8400-e29b-41d4-a716-446655440030",
};

export const mockPreset = {
	ID: "550e8400-e29b-41d4-a716-446655440040",
	Name: "default",
	Default: true,
};

// ── Mock Coder Client ───────────────────────────────────────────────────────

export class MockCoderClient implements CoderClient {
	getCoderUserByGitHubId = mock(() =>
		Promise.resolve({
			id: "u1",
			username: "coder-agent",
			email: "a@b.com",
			organization_ids: [],
			github_com_user_id: 1,
		}),
	);
	getTemplateByOrganizationAndName = mock(() => Promise.resolve(mockTemplate));
	getTemplateVersionPresets = mock(() => Promise.resolve([mockPreset]));
	getTask = mock(() => Promise.resolve(null));
	getTaskById = mock(() => Promise.resolve(mockTask));
	createTask = mock(() => Promise.resolve(mockTask));
	sendTaskInput = mock(() => Promise.resolve());
	waitForTaskActive = mock(() => Promise.resolve());
	getWorkspace = mock(() =>
		Promise.resolve({
			id: "ws-1",
			latest_build: { status: "running", transition: "start" },
		}),
	);
	startWorkspace = mock(() => Promise.resolve());
	stopWorkspace = mock(() => Promise.resolve());
	waitForWorkspaceStopped = mock(() => Promise.resolve());
	deleteWorkspace = mock(() => Promise.resolve());
	deleteTask = mock(() => Promise.resolve());
}

// ── Neutral Task Fixtures (TaskRunner-shape) ────────────────────────────────

export const mockTaskNeutral: Task = {
	name: TaskRunnerNameSchema.parse("gh-test-repo-42"),
	status: "ready",
	owner: "test-coder-user",
	url: "https://coder.example.com/tasks/test-coder-user/550e8400-e29b-41d4-a716-446655440000",
};

export const mockTaskNeutralStopped: Task = {
	...mockTaskNeutral,
	status: "stopped",
};

export const mockTaskNeutralError: Task = {
	...mockTaskNeutral,
	status: "error",
};

// ── Mock Task Runner ────────────────────────────────────────────────────────

export class MockTaskRunner implements TaskRunner {
	lookupUser = mock(
		async (_: { user: { type: "github"; id: string; username: string } }) =>
			"test-coder-user",
	);
	create = mock(
		async (_: { taskName: TaskName; owner: string; input: string }) =>
			mockTaskNeutral,
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
