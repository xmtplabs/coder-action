import { mock } from "bun:test";
import type { CoderClient, ExperimentalCoderSDKTask } from "./coder-client";
import { TaskIdSchema, TaskNameSchema } from "./coder-client";
import type { GitHubClient } from "./github-client";

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
	stopWorkspace = mock(() => Promise.resolve());
	deleteWorkspace = mock(() => Promise.resolve());
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
	} as unknown as { [K in keyof GitHubClient]: ReturnType<typeof mock> };
}
