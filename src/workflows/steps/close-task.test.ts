import { describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../../config/app-config";
import type { TaskClosedEvent } from "../../events/types";
import { runCloseTask } from "./close-task";

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

const event: TaskClosedEvent = {
	type: "task_closed",
	source: { type: "github", installationId: 1 },
	repository: { owner: "acme", name: "repo" },
	issue: { number: 7 },
};

const config = { coderTaskNamePrefix: "gh" } as unknown as AppConfig;

describe("runCloseTask", () => {
	test("emits delete-coder-task then comment-on-issue when task existed", async () => {
		const step = makeStep();
		const coder = {
			delete: vi.fn(async () => ({ deleted: true })),
		};
		const github = {
			commentOnIssue: vi.fn(async () => {}),
		};
		await runCloseTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		expect(step.calls).toEqual(["delete-coder-task", "comment-on-issue"]);
	});

	test("skips comment when task did not exist (idempotent no-op)", async () => {
		const step = makeStep();
		const coder = {
			delete: vi.fn(async () => ({ deleted: false })),
		};
		const github = {
			commentOnIssue: vi.fn(async () => {}),
		};
		await runCloseTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		expect(step.calls).toEqual(["delete-coder-task"]);
		expect(github.commentOnIssue).not.toHaveBeenCalled();
	});

	test("delete-coder-task returns plain `{deleted: boolean}`", async () => {
		const step = makeStep();
		const coder = {
			delete: vi.fn(async () => ({ deleted: true })),
		};
		const github = { commentOnIssue: vi.fn(async () => {}) };
		await runCloseTask({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event,
		});
		const result = await step.do.mock.results[0]?.value;
		expect(result).toEqual({ deleted: true });
	});
});
