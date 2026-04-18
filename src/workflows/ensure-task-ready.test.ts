import { describe, expect, test, vi } from "vitest";
import type { CoderService } from "../services/coder/service";
import { TaskIdSchema } from "../services/task-runner";
import { ensureTaskReady } from "./ensure-task-ready";

const taskId = TaskIdSchema.parse("11111111-1111-1111-1111-111111111111");

// ── Test harness ─────────────────────────────────────────────────────────
// A fake WorkflowStep that:
//   • `do(name, [config,] cb)` — executes cb exactly once, returns its result.
//   • `sleep(name, duration)` — records the call and resolves immediately.
interface FakeStep {
	do: ReturnType<typeof vi.fn>;
	sleep: ReturnType<typeof vi.fn>;
	calls: string[];
	sleeps: string[];
}

function makeStep(): FakeStep {
	const calls: string[] = [];
	const sleeps: string[] = [];
	const fake: FakeStep = {
		calls,
		sleeps,
		do: vi.fn(async (name: string, ...rest: unknown[]) => {
			calls.push(name);
			const cb = rest[rest.length - 1] as () => Promise<unknown>;
			return cb();
		}),
		sleep: vi.fn(async (name: string, _dur: string) => {
			sleeps.push(name);
		}),
	};
	return fake;
}

// A CoderService stub that returns a programmed sequence of observations.
function makeCoder(
	observations: Array<{
		status: string;
		state: string | null;
		workspace_id?: string;
	}>,
) {
	let idx = 0;
	return {
		getTaskById: vi.fn(async () => {
			const last = observations[observations.length - 1];
			const o = observations[Math.min(idx, observations.length - 1)] ?? last;
			idx++;
			if (!o) throw new Error("no observations programmed");
			return {
				id: taskId,
				status: o.status,
				current_state: o.state !== null ? { state: o.state } : null,
				workspace_id: o.workspace_id ?? "ws-1",
			};
		}),
		resumeWorkspace: vi.fn(async () => {}),
	} as unknown as CoderService;
}

// ── Pre-poll dispatch tests ──────────────────────────────────────────────

describe("ensureTaskReady — pre-poll dispatch", () => {
	test("active + idle → returns immediately, no loop, no resume", async () => {
		const step = makeStep();
		const coder = makeCoder([{ status: "active", state: "idle" }]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toEqual(["lookup-task"]);
		expect(step.sleeps).toEqual([]);
		expect(
			(coder.resumeWorkspace as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBe(0);
	});

	test("active + complete → returns immediately", async () => {
		const step = makeStep();
		const coder = makeCoder([{ status: "active", state: "complete" }]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toEqual(["lookup-task"]);
	});

	test("active + failed → returns immediately (per Coder CLI semantics)", async () => {
		const step = makeStep();
		const coder = makeCoder([{ status: "active", state: "failed" }]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toEqual(["lookup-task"]);
	});

	test("active + working → enters loop (no resume)", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toContain("lookup-task");
		expect(step.calls).toContain("check-status-1");
		expect(
			(coder.resumeWorkspace as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBe(0);
	});

	test("active + null → enters loop (no resume)", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: null },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toContain("check-status-1");
		expect(
			(coder.resumeWorkspace as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBe(0);
	});

	test("paused → calls resumeWorkspace(workspaceId) before loop", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "paused", state: null, workspace_id: "ws-xyz" },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toEqual([
			"lookup-task",
			"resume-paused-task",
			"check-status-1",
		]);
		expect(coder.resumeWorkspace).toHaveBeenCalledWith("ws-xyz");
	});

	test("initializing → enters loop (no resume, no early-return)", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "initializing", state: null },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toContain("check-status-1");
	});

	test("pending → enters loop (no early-fail, webhook-tolerant)", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "pending", state: null },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toContain("check-status-1");
	});

	test("error → enters loop (not immediate fail, grace applies)", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "error", state: null },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toContain("check-status-1");
	});

	test("unknown → enters loop (not immediate fail, grace applies)", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "unknown", state: null },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toContain("check-status-1");
	});
});

// ── Poll loop transitions ────────────────────────────────────────────────

describe("ensureTaskReady — poll loop transitions", () => {
	test("working → idle → returns", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" },
			{ status: "active", state: "working" },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toEqual([
			"lookup-task",
			"check-status-1",
			"check-status-2",
		]);
		expect(step.sleeps).toEqual(["wait-1"]);
	});

	test("error within grace → active + idle → recovers", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" },
			{ status: "error", state: null },
			{ status: "error", state: null },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toEqual([
			"lookup-task",
			"check-status-1",
			"check-status-2",
			"check-status-3",
		]);
	});

	test("error persisting beyond attempt 10 → NonRetryableError", async () => {
		const step = makeStep();
		const observations: Array<{ status: string; state: string | null }> = [
			{ status: "active", state: "working" },
		];
		for (let i = 0; i < 12; i++) {
			observations.push({ status: "error", state: null });
		}
		const coder = makeCoder(observations);
		await expect(
			ensureTaskReady({ step: step as never, coder, taskId, owner: "o" }),
		).rejects.toThrowError(/beyond 5-minute grace/);
	});

	test("unknown within grace → active + idle → recovers (analogue of error within grace)", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" }, // lookup-task
			{ status: "unknown", state: null }, // attempt 1
			{ status: "unknown", state: null }, // attempt 2
			{ status: "active", state: "idle" }, // attempt 3 — recovers
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toEqual([
			"lookup-task",
			"check-status-1",
			"check-status-2",
			"check-status-3",
		]);
	});

	test("unknown persisting beyond grace → NonRetryableError", async () => {
		const step = makeStep();
		const observations: Array<{ status: string; state: string | null }> = [
			{ status: "active", state: "working" },
		];
		for (let i = 0; i < 12; i++) {
			observations.push({ status: "unknown", state: null });
		}
		const coder = makeCoder(observations);
		await expect(
			ensureTaskReady({ step: step as never, coder, taskId, owner: "o" }),
		).rejects.toThrowError(/beyond 5-minute grace/);
	});

	test("paused mid-poll → NonRetryableError immediately", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" },
			{ status: "paused", state: null },
		]);
		await expect(
			ensureTaskReady({ step: step as never, coder, taskId, owner: "o" }),
		).rejects.toThrowError(/paused while waiting/);
		expect(step.calls).toEqual(["lookup-task", "check-status-1"]);
	});

	test("unexpected status → NonRetryableError", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" },
			{ status: "zombie", state: null },
		]);
		await expect(
			ensureTaskReady({ step: step as never, coder, taskId, owner: "o" }),
		).rejects.toThrowError(/unexpected status zombie/);
	});
});

// ── Nil-state grace ──────────────────────────────────────────────────────

describe("ensureTaskReady — nil-state grace", () => {
	test("nil-state for 4 consecutive attempts from first null → returns as idle", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" }, // pre-poll
			{ status: "active", state: null }, // attempt 1: start=1
			{ status: "active", state: null }, // attempt 2: diff 1
			{ status: "active", state: null }, // attempt 3: diff 2
			{ status: "active", state: null }, // attempt 4: diff 3
			{ status: "active", state: null }, // attempt 5: diff 4, ≥ 4 → returns
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toContain("check-status-5");
		expect(step.calls).not.toContain("check-status-6");
	});

	test("null → working → null RESETS grace (new nilStateStartAttempt)", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" }, // pre-poll
			{ status: "active", state: null }, // 1: start=1
			{ status: "active", state: null }, // 2: diff 1
			{ status: "active", state: "working" }, // 3: reset → start=null
			{ status: "active", state: null }, // 4: start=4
			{ status: "active", state: null }, // 5: diff 1
			{ status: "active", state: null }, // 6: diff 2
			{ status: "active", state: null }, // 7: diff 3
			{ status: "active", state: null }, // 8: diff 4, ≥ 4 → returns
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toContain("check-status-8");
		expect(step.calls).not.toContain("check-status-9");
	});

	test("null → null → active+idle → grace short-circuited by idle", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" },
			{ status: "active", state: null },
			{ status: "active", state: null },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toEqual([
			"lookup-task",
			"check-status-1",
			"check-status-2",
			"check-status-3",
		]);
	});

	test("non-active status between nulls also resets grace", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" },
			{ status: "active", state: null }, // 1: start=1
			{ status: "initializing", state: null }, // 2: reset
			{ status: "active", state: null }, // 3: start=3
			{ status: "active", state: null }, // 4: diff 1
			{ status: "active", state: null }, // 5: diff 2
			{ status: "active", state: null }, // 6: diff 3
			{ status: "active", state: null }, // 7: diff 4, ≥ 4 → returns
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		expect(step.calls).toContain("check-status-7");
		expect(step.calls).not.toContain("check-status-8");
	});
});

// ── Timeout ──────────────────────────────────────────────────────────────

describe("ensureTaskReady — total timeout", () => {
	test("60 consecutive 'working' attempts → throws plain Error (not NonRetryableError)", async () => {
		const step = makeStep();
		const observations: Array<{ status: string; state: string | null }> = [
			{ status: "active", state: "working" },
		];
		for (let i = 0; i < 60; i++) {
			observations.push({ status: "active", state: "working" });
		}
		const coder = makeCoder(observations);
		let thrown: unknown;
		try {
			await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toMatch(/did not become ready/);
		const { NonRetryableError } = await import("cloudflare:workflows");
		expect(thrown).not.toBeInstanceOf(NonRetryableError);
	});
});

// ── Serialization rule (EARS-REQ-16a) ────────────────────────────────────

describe("ensureTaskReady — step return serialization", () => {
	test("lookup-task step returns only plain scalar fields (no raw SDK task)", async () => {
		const step = makeStep();
		const coder = makeCoder([{ status: "active", state: "idle" }]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });

		const doMock = step.do.mock;
		expect(doMock.calls[0]?.[0]).toBe("lookup-task");
		const lookupResult = await doMock.results[0]?.value;
		expect(lookupResult).toHaveProperty("status");
		expect(lookupResult).toHaveProperty("state");
		expect(lookupResult).toHaveProperty("workspaceId");
		// Must NOT carry the raw SDK fields
		expect(lookupResult).not.toHaveProperty("current_state");
		expect(lookupResult).not.toHaveProperty("id");
	});

	test("check-status steps return only plain scalar fields", async () => {
		const step = makeStep();
		// Observation[0] consumed by lookup-task (active+working → enter loop)
		// Observation[1] consumed by check-status-1
		// Observation[2] consumed by check-status-2
		const coder = makeCoder([
			{ status: "active", state: "working" }, // lookup-task
			{ status: "active", state: "working" }, // check-status-1
			{ status: "active", state: "idle" }, // check-status-2
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		const callIdx = step.do.mock.calls.findIndex(
			(c: unknown[]) => c[0] === "check-status-1",
		);
		const result = await step.do.mock.results[callIdx]?.value;
		// Spec §4 serialization table: { status, state, workspaceId }. Deep-equal
		// guards against raw-SDK-field leakage (EARS-REQ-16a).
		expect(result).toEqual({
			status: "active",
			state: "working",
			workspaceId: "ws-1",
		});
	});
});

// ── Config (STATUS_RETRY is passed to step.do) ───────────────────────────

describe("ensureTaskReady — step retry config", () => {
	test("lookup-task is called with STATUS_RETRY (3 × 2s exponential)", async () => {
		const step = makeStep();
		const coder = makeCoder([{ status: "active", state: "idle" }]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		const call = step.do.mock.calls.find(
			(c: unknown[]) => c[0] === "lookup-task",
		);
		const config = call?.[1];
		expect(config).toMatchObject({
			retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
		});
	});

	test("check-status-<n> is called with STATUS_RETRY config", async () => {
		const step = makeStep();
		const coder = makeCoder([
			{ status: "active", state: "working" },
			{ status: "active", state: "idle" },
		]);
		await ensureTaskReady({ step: step as never, coder, taskId, owner: "o" });
		const call = step.do.mock.calls.find(
			(c: unknown[]) => c[0] === "check-status-1",
		);
		const config = call?.[1];
		expect(config).toMatchObject({
			retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
		});
	});
});
