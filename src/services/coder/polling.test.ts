import { describe, expect, test } from "bun:test";
import { waitForTaskIdle } from "./polling";
import type { ExperimentalCoderSDKTask } from "./schemas";
import { TaskIdSchema, TaskNameSchema } from "../task-runner";

const taskId = TaskIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");
const taskName = TaskNameSchema.parse("gh-repo-42");

function baseTask(
	over: Partial<ExperimentalCoderSDKTask>,
): ExperimentalCoderSDKTask {
	return {
		id: taskId,
		name: taskName,
		owner_id: "00000000-0000-0000-0000-000000000001",
		template_id: "00000000-0000-0000-0000-000000000002",
		workspace_id: "00000000-0000-0000-0000-000000000003",
		created_at: "2026-04-17T00:00:00Z",
		updated_at: "2026-04-17T00:00:00Z",
		status: "initializing",
		current_state: null,
		...over,
	};
}

function fakeClient(seq: Array<Partial<ExperimentalCoderSDKTask>>) {
	let i = 0;
	return {
		getTaskById: async (_id: string, _owner?: string) =>
			baseTask(seq[Math.min(i++, seq.length - 1)]),
	};
}

function fakeClock(stepMs: number) {
	let t = 0;
	return () => (t += stepMs);
}

const noSleep = async (_ms: number) => {};
const logNoop = (_: string) => {};

describe("waitForTaskIdle", () => {
	test("returns when task reaches active+idle", async () => {
		const client = fakeClient([
			{ status: "initializing" },
			{ status: "active", current_state: { state: "idle" } },
		]);
		await waitForTaskIdle({
			client,
			taskId,
			owner: "u1",
			log: logNoop,
			sleepFn: noSleep,
			now: fakeClock(5000),
			timeoutMs: 60_000,
		});
	});

	test("tolerates transient error for 5 minutes then rejects", async () => {
		const client = fakeClient([{ status: "error" }]);
		await expect(
			waitForTaskIdle({
				client,
				taskId,
				owner: "u1",
				log: logNoop,
				sleepFn: noSleep,
				now: fakeClock(60_000),
				timeoutMs: 10 * 60 * 1000,
			}),
		).rejects.toThrow(/error/i);
	});

	test("treats active+null current_state as ready after 30s grace", async () => {
		const client = fakeClient([{ status: "active", current_state: null }]);
		await waitForTaskIdle({
			client,
			taskId,
			owner: "u1",
			log: logNoop,
			sleepFn: noSleep,
			now: fakeClock(11_000),
			timeoutMs: 120_000,
		});
	});

	test("rejects on paused status during wait", async () => {
		const client = fakeClient([{ status: "paused" }]);
		await expect(
			waitForTaskIdle({
				client,
				taskId,
				owner: "u1",
				log: logNoop,
				sleepFn: noSleep,
				now: fakeClock(5000),
				timeoutMs: 60_000,
			}),
		).rejects.toThrow(/paused/i);
	});

	test("rejects on unknown status immediately", async () => {
		const client = fakeClient([{ status: "unknown" }]);
		await expect(
			waitForTaskIdle({
				client,
				taskId,
				owner: "u1",
				log: logNoop,
				sleepFn: noSleep,
				now: fakeClock(5000),
				timeoutMs: 60_000,
			}),
		).rejects.toThrow(/unknown/i);
	});

	test("rejects on overall timeout", async () => {
		const client = fakeClient([{ status: "initializing" }]);
		await expect(
			waitForTaskIdle({
				client,
				taskId,
				owner: "u1",
				log: logNoop,
				sleepFn: noSleep,
				now: fakeClock(20_000),
				timeoutMs: 60_000,
			}),
		).rejects.toThrow(/timeout/i);
	});
});
