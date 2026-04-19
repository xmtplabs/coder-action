import { describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../../config/app-config";
import type { TaskRequestedEvent } from "../../events/types";
import {
	TASK_STATUS_COMMENT_MARKER,
	buildTaskStatusCommentBody,
} from "../task-status-comment";
import { runCreateTask } from "./create-task";

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

const event: TaskRequestedEvent = {
	type: "task_requested",
	source: { type: "github", installationId: 1 },
	repository: { owner: "acme", name: "repo" },
	issue: { number: 42, url: "https://github.com/acme/repo/issues/42" },
	requester: { login: "alice", externalId: 123 },
};

const config = {
	coderTaskNamePrefix: "gh",
} as unknown as AppConfig;

function makeCoder(overrides: Record<string, unknown> = {}) {
	return {
		lookupUser: vi.fn(async () => "coder-user"),
		create: vi.fn(async () => ({
			id: "11111111-1111-4111-8111-111111111111",
			name: "gh-repo-42",
			status: "ready",
			owner: "coder-user",
			url: "https://coder/t",
		})),
		getTaskById: vi.fn(async () => ({
			id: "11111111-1111-4111-8111-111111111111",
			status: "active",
			current_state: null,
			workspace_id: "ws-1",
		})),
		...overrides,
	};
}

function makeGithub(overrides: Record<string, unknown> = {}) {
	return {
		checkActorPermission: vi.fn(async () => true),
		commentOnIssue: vi.fn(async () => {}),
		...overrides,
	};
}

describe("runCreateTask", () => {
	test("emits steps in order: check-github-permission (first), lookup-coder-user, create-coder-task, comment-on-issue, wait-*, update-status-comment", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();

		await runCreateTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		// With a fast-path `active` observation at pre-poll, waitForTaskActive
		// emits exactly one step (`wait-lookup-task`).
		expect(step.calls).toEqual([
			"check-github-permission",
			"lookup-coder-user",
			"create-coder-task",
			"comment-on-issue",
			"wait-lookup-task",
			"update-status-comment",
		]);
	});

	test("skips lookup + create + comment + wait + update if actor lacks write permission", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub({
			checkActorPermission: vi.fn(async () => false),
		});
		await runCreateTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		// Only the permission check ran.
		expect(step.calls).toEqual(["check-github-permission"]);
		expect(coder.lookupUser).not.toHaveBeenCalled();
		expect(coder.create).not.toHaveBeenCalled();
		expect(coder.getTaskById).not.toHaveBeenCalled();
		expect(github.commentOnIssue).not.toHaveBeenCalled();
	});

	test("create-coder-task step returns exactly the spec §4 scalar projection", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();
		await runCreateTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		const createIdx = step.do.mock.calls.findIndex(
			(c: unknown[]) => c[0] === "create-coder-task",
		);
		const result = await step.do.mock.results[createIdx]?.value;
		// Exact deep equality — guards against raw-SDK-field leakage
		// AND missing-field regressions.
		expect(result).toEqual({
			taskName: "gh-repo-42",
			owner: "coder-user",
			taskId: "11111111-1111-4111-8111-111111111111",
			url: "https://coder/t",
			status: "ready",
		});
	});

	test("initial comment-on-issue uses the shared marker as matchPrefix and the body starts with the marker", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();
		await runCreateTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		// First commentOnIssue call — the initial "Task created" comment.
		const firstCall = github.commentOnIssue.mock.calls[0] as unknown as [
			string,
			string,
			number,
			string,
			string,
		];
		const [, , , body, matchPrefix] = firstCall;
		expect(matchPrefix).toBe(TASK_STATUS_COMMENT_MARKER);
		expect(body.startsWith(TASK_STATUS_COMMENT_MARKER)).toBe(true);
		expect(body).toBe(
			buildTaskStatusCommentBody("Task created: https://coder/t"),
		);
	});

	test("when waitForTaskActive returns 'active' → update-status-comment posts running message with marker", async () => {
		const step = makeStep();
		// Pre-poll 'initializing', then 'active' at attempt 1.
		let call = 0;
		const coder = makeCoder({
			getTaskById: vi.fn(async () => {
				const s = call === 0 ? "initializing" : "active";
				call++;
				return {
					id: "11111111-1111-4111-8111-111111111111",
					status: s,
					current_state: null,
					workspace_id: "ws-1",
				};
			}),
		});
		const github = makeGithub();
		await runCreateTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});

		expect(step.calls).toContain("update-status-comment");

		// Final commentOnIssue (update) should carry the running message.
		const last =
			github.commentOnIssue.mock.calls[
				github.commentOnIssue.mock.calls.length - 1
			];
		const [, , , body, matchPrefix] = last as unknown as [
			string,
			string,
			number,
			string,
			string,
		];
		expect(matchPrefix).toBe(TASK_STATUS_COMMENT_MARKER);
		expect(body).toBe(
			buildTaskStatusCommentBody("Task is running: https://coder/t"),
		);
	});

	test("when waitForTaskActive returns 'error' → update-status-comment posts failure message with marker", async () => {
		const step = makeStep();
		// Every status read returns 'paused' → immediate error.
		const coder = makeCoder({
			getTaskById: vi.fn(async () => ({
				id: "11111111-1111-4111-8111-111111111111",
				status: "paused",
				current_state: null,
				workspace_id: "ws-1",
			})),
		});
		const github = makeGithub();
		await runCreateTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});

		expect(step.calls).toContain("update-status-comment");

		const last =
			github.commentOnIssue.mock.calls[
				github.commentOnIssue.mock.calls.length - 1
			];
		const [, , , body, matchPrefix] = last as unknown as [
			string,
			string,
			number,
			string,
			string,
		];
		expect(matchPrefix).toBe(TASK_STATUS_COMMENT_MARKER);
		expect(body).toBe(
			buildTaskStatusCommentBody(
				"Failed to create task sandbox: https://coder/t",
			),
		);
	});

	test("every commentOnIssue invocation uses TASK_STATUS_COMMENT_MARKER as matchPrefix and body starts with it", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();
		await runCreateTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		expect(github.commentOnIssue).toHaveBeenCalledTimes(2);
		for (const call of github.commentOnIssue.mock.calls) {
			const [, , , body, matchPrefix] = call as unknown as [
				string,
				string,
				number,
				string,
				string,
			];
			expect(matchPrefix).toBe(TASK_STATUS_COMMENT_MARKER);
			expect(body.startsWith(TASK_STATUS_COMMENT_MARKER)).toBe(true);
		}
	});
});
