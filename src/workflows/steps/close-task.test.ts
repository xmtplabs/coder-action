import { describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../../config/app-config";
import type { TaskClosedEvent } from "../../events/types";
import {
	TASK_STATUS_COMMENT_MARKER,
	buildTaskStatusCommentBody,
} from "../task-status-comment";
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

	test("comment-on-issue uses TASK_STATUS_COMMENT_MARKER as matchPrefix and body starts with it", async () => {
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
		expect(github.commentOnIssue).toHaveBeenCalledTimes(1);
		const call = github.commentOnIssue.mock.calls[0] as unknown as [
			string,
			string,
			number,
			string,
			string,
		];
		const [, , , body, matchPrefix] = call;
		expect(matchPrefix).toBe(TASK_STATUS_COMMENT_MARKER);
		expect(body).toBe(buildTaskStatusCommentBody("Task completed."));
		expect(body.startsWith(TASK_STATUS_COMMENT_MARKER)).toBe(true);
	});

	test("delete-coder-task step output projects ONLY `{deleted}` (strips any extra fields returned by the coder client)", async () => {
		const step = makeStep();
		// Simulate a future coder.delete returning extra fields — the step
		// callback must not let them leak into the cached step output.
		const coder = {
			delete: vi.fn(async () => ({
				deleted: true,
				_internal: "should not appear",
				warnings: ["ignored"],
			})),
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
		expect(Object.keys(result as object)).toEqual(["deleted"]);
	});
});
