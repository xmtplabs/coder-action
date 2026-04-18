import { describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../../config/app-config";
import type { TaskRequestedEvent } from "../../events/types";
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

describe("runCreateTask", () => {
	test("emits steps in order: check-github-permission (first), lookup-coder-user, create-coder-task, comment-on-issue", async () => {
		const step = makeStep();
		const coder = {
			lookupUser: vi.fn(async () => "coder-user"),
			create: vi.fn(async () => ({
				id: "task-uuid-1",
				name: "gh-repo-42",
				status: "ready",
				owner: "coder-user",
				url: "https://coder/t",
			})),
		};
		const github = {
			checkActorPermission: vi.fn(async () => true),
			commentOnIssue: vi.fn(async () => {}),
		};

		await runCreateTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		expect(step.calls).toEqual([
			"check-github-permission",
			"lookup-coder-user",
			"create-coder-task",
			"comment-on-issue",
		]);
	});

	test("skips lookup + create + comment if actor lacks write permission", async () => {
		const step = makeStep();
		const coder = {
			lookupUser: vi.fn(async () => "coder-user"),
			create: vi.fn(async () => ({
				id: "unused",
				name: "x",
				status: "ready",
				owner: "x",
				url: "u",
			})),
		};
		const github = {
			checkActorPermission: vi.fn(async () => false),
			commentOnIssue: vi.fn(async () => {}),
		};
		await runCreateTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		// Only the permission check ran.
		expect(step.calls).toEqual(["check-github-permission"]);
		// Neither Coder nor GitHub comment-on-issue hit.
		expect(coder.lookupUser).not.toHaveBeenCalled();
		expect(coder.create).not.toHaveBeenCalled();
		expect(github.commentOnIssue).not.toHaveBeenCalled();
	});

	test("create-coder-task step returns exactly the spec §4 scalar projection", async () => {
		const step = makeStep();
		const coder = {
			lookupUser: vi.fn(async () => "coder-user"),
			create: vi.fn(async () => ({
				id: "11111111-1111-4111-8111-111111111111",
				name: "gh-repo-42",
				status: "ready",
				owner: "coder-user",
				url: "https://coder/t",
			})),
		};
		const github = {
			checkActorPermission: vi.fn(async () => true),
			commentOnIssue: vi.fn(async () => {}),
		};
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
		// Exact deep equality — guards against raw-SDK-field leakage (EARS-REQ-16a)
		// AND missing-field regressions.
		expect(result).toEqual({
			taskName: "gh-repo-42",
			owner: "coder-user",
			taskId: "11111111-1111-4111-8111-111111111111",
			url: "https://coder/t",
			status: "ready",
		});
	});
});
