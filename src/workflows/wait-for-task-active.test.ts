import { describe, expect, test, vi } from "vitest";
import type { CoderService } from "../services/coder/service";
import { TaskIdSchema } from "../services/task-runner";
import { waitForTaskActive } from "./wait-for-task-active";

const taskId = TaskIdSchema.parse("11111111-1111-4111-8111-111111111111");

interface FakeStep {
	do: ReturnType<typeof vi.fn>;
	sleep: ReturnType<typeof vi.fn>;
	calls: string[];
	sleeps: string[];
	stepResults: unknown[];
}

function makeStep(): FakeStep {
	const calls: string[] = [];
	const sleeps: string[] = [];
	const stepResults: unknown[] = [];
	const fake: FakeStep = {
		calls,
		sleeps,
		stepResults,
		do: vi.fn(async (name: string, ...rest: unknown[]) => {
			calls.push(name);
			const cb = rest[rest.length - 1] as () => Promise<unknown>;
			const result = await cb();
			stepResults.push(result);
			return result;
		}),
		sleep: vi.fn(async (name: string, _dur: string) => {
			sleeps.push(name);
		}),
	};
	return fake;
}

function makeCoder(statuses: string[]) {
	let idx = 0;
	return {
		getTaskById: vi.fn(async () => {
			const s = statuses[Math.min(idx, statuses.length - 1)] ?? "unknown";
			idx++;
			return {
				id: taskId,
				status: s,
				current_state: null,
				workspace_id: "ws-1",
			};
		}),
	} as unknown as CoderService;
}

describe("waitForTaskActive — pre-poll dispatch", () => {
	test("pre-poll sees active → returns 'active' without entering the loop", async () => {
		const step = makeStep();
		const coder = makeCoder(["active"]);
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("active");
		expect(step.calls).toEqual(["wait-lookup-task"]);
		expect(step.sleeps).toEqual([]);
	});

	test("pre-poll sees paused → returns 'error' without entering the loop", async () => {
		const step = makeStep();
		const coder = makeCoder(["paused"]);
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("error");
		expect(step.calls).toEqual(["wait-lookup-task"]);
		expect(step.sleeps).toEqual([]);
	});

	test("pre-poll sees unexpected status → returns 'error'", async () => {
		const step = makeStep();
		const coder = makeCoder(["weird-new-status"]);
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("error");
		expect(step.calls).toEqual(["wait-lookup-task"]);
	});
});

describe("waitForTaskActive — poll loop", () => {
	test("pending → active transitions during polling", async () => {
		const step = makeStep();
		const coder = makeCoder(["pending", "pending", "initializing", "active"]);
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("active");
		// 1 pre-poll + 3 loop checks (pending, initializing, active)
		expect(step.calls).toEqual([
			"wait-lookup-task",
			"wait-check-status-1",
			"wait-check-status-2",
			"wait-check-status-3",
		]);
		// A sleep follows every non-terminal observation (pending, initializing).
		// The third observation is 'active' → loop returns BEFORE the sleep.
		expect(step.sleeps).toEqual(["wait-sleep-1", "wait-sleep-2"]);
	});

	test("returns 'active' when raw.status === 'active' regardless of current_state", async () => {
		const step = makeStep();
		const coder = {
			getTaskById: vi.fn(async () => ({
				id: taskId,
				status: "active",
				current_state: { state: "working" },
				workspace_id: "ws-1",
			})),
		} as unknown as CoderService;
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("active");
	});

	test("paused observed mid-poll → returns 'error'", async () => {
		const step = makeStep();
		const coder = makeCoder(["pending", "paused"]);
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("error");
	});
});

describe("waitForTaskActive — error grace window", () => {
	test("error within grace window, then active → returns 'active'", async () => {
		const step = makeStep();
		// Pre-poll 'initializing', then 5 'error', then 'active'. Grace = 10.
		const coder = makeCoder([
			"initializing",
			"error",
			"error",
			"error",
			"error",
			"error",
			"active",
		]);
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("active");
	});

	test("error persists beyond ERROR_GRACE_ATTEMPTS → returns 'error'", async () => {
		const step = makeStep();
		// Pre-poll 'initializing', then infinite 'error'. Grace is 10 attempts.
		const coder = makeCoder(["initializing", ...Array(30).fill("error")]);
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("error");
		// Grace ends on attempt=11 → we should NOT have run all 60 iterations.
		const checkCount = step.calls.filter((n) =>
			n.startsWith("wait-check-status-"),
		).length;
		expect(checkCount).toBeLessThan(60);
		expect(checkCount).toBeGreaterThanOrEqual(11);
	});

	test("unknown persists beyond grace → returns 'error'", async () => {
		const step = makeStep();
		const coder = makeCoder(["initializing", ...Array(30).fill("unknown")]);
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("error");
	});
});

describe("waitForTaskActive — timeout", () => {
	test("MAX_ATTEMPTS exhausted without reaching active → returns 'error'", async () => {
		const step = makeStep();
		// Always 'initializing' — never reaches active, never errors.
		const coder = makeCoder(Array(100).fill("initializing"));
		const result = await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(result).toBe("error");
		// 1 pre-poll + 60 loop checks.
		const checkCount = step.calls.filter((n) =>
			n.startsWith("wait-check-status-"),
		).length;
		expect(checkCount).toBe(60);
	});
});

describe("waitForTaskActive — step naming and projection", () => {
	test("step names use wait-lookup-task, wait-check-status-{n}, wait-sleep-{n}", async () => {
		const step = makeStep();
		const coder = makeCoder(["pending", "pending", "active"]);
		await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		expect(step.calls[0]).toBe("wait-lookup-task");
		expect(step.calls[1]).toBe("wait-check-status-1");
		expect(step.calls[2]).toBe("wait-check-status-2");
		expect(step.sleeps[0]).toBe("wait-sleep-1");
	});

	test("step names do not collide with ensureTaskReady's step names", async () => {
		const step = makeStep();
		const coder = makeCoder(["pending", "active"]);
		await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		// ensureTaskReady uses `lookup-task`, `check-status-{n}`, `wait-{n}`.
		// Ours must NOT match those exact names.
		expect(step.calls).not.toContain("lookup-task");
		expect(step.calls).not.toContain("check-status-1");
		expect(step.sleeps).not.toContain("wait-1");
	});

	test("step.do callback returns only the scalar {status}", async () => {
		const step = makeStep();
		const coder = makeCoder(["active"]);
		await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		const preResult = step.stepResults[0] as Record<string, unknown>;
		expect(Object.keys(preResult)).toEqual(["status"]);
		expect(preResult).toEqual({ status: "active" });
	});

	test("wraps status reads in step.do with STATUS_RETRY config", async () => {
		const step = makeStep();
		const coder = makeCoder(["active"]);
		await waitForTaskActive({
			step: step as never,
			coder,
			taskId,
			owner: "o",
		});
		// The pre-poll step.do call must include a retry config argument.
		const firstCall = step.do.mock.calls[0] as unknown[];
		// Signature: (name, config?, cb). If config is present it's the 2nd arg.
		expect(firstCall).toHaveLength(3);
		const config = firstCall[1] as { retries?: { limit?: number } };
		expect(config?.retries?.limit).toBe(3);
	});

	test("does NOT throw for any task-state reason (paused/error/timeout)", async () => {
		const step = makeStep();
		for (const statuses of [
			["paused"],
			["initializing", "paused"],
			["initializing", ...Array(60).fill("error")],
			Array(100).fill("pending"),
		]) {
			const coder = makeCoder(statuses);
			await expect(
				waitForTaskActive({
					step: step as never,
					coder,
					taskId,
					owner: "o",
				}),
			).resolves.toBe("error");
		}
	});
});
