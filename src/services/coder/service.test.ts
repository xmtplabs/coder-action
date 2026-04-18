import { describe, expect, test, mock } from "bun:test";
import type { TaskStatus } from "../task-runner";
import { TaskNameSchema, TaskIdSchema } from "../task-runner";
import { TestLogger } from "../../infra/logger";
import { CoderService } from "./service";
import type { CoderServiceOptions } from "./service";

// ── helpers ──────────────────────────────────────────────────────────────────

const CODER_URL = "https://coder.test";
const API_TOKEN = "test-token";
const OWNER = "testuser";
const TASK_NAME = TaskNameSchema.parse("gh-repo-42");
const TASK_ID = TaskIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");
const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440099";
const TEMPLATE_ID = "550e8400-e29b-41d4-a716-446655440001";
const TEMPLATE_VERSION_ID = "550e8400-e29b-41d4-a716-446655440002";
const PRESET_ID = "550e8400-e29b-41d4-a716-446655440003";
const ORG = "test-org";
const TEMPLATE_NAME = "test-template";

function makeTask(
	overrides: Partial<{
		id: string;
		name: string;
		status: string;
		current_state: { state: string } | null;
		workspace_id: string;
	}> = {},
) {
	return {
		id: overrides.id ?? TASK_ID,
		name: overrides.name ?? TASK_NAME,
		owner_id: "550e8400-e29b-41d4-a716-446655440004",
		template_id: TEMPLATE_ID,
		workspace_id: overrides.workspace_id ?? WORKSPACE_ID,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		status: overrides.status ?? "active",
		current_state:
			overrides.current_state !== undefined
				? overrides.current_state
				: { state: "idle" },
	};
}

function makeTemplate() {
	return {
		id: TEMPLATE_ID,
		name: TEMPLATE_NAME,
		description: "test",
		organization_id: "550e8400-e29b-41d4-a716-446655440010",
		active_version_id: TEMPLATE_VERSION_ID,
	};
}

function makePresets(defaultPreset = true) {
	return [
		{ ID: PRESET_ID, Name: "my-preset", Default: defaultPreset },
		{
			ID: "550e8400-e29b-41d4-a716-446655440005",
			Name: "other",
			Default: false,
		},
	];
}

function makeUserList(username = OWNER) {
	return {
		users: [
			{
				id: "550e8400-e29b-41d4-a716-446655440006",
				username,
				email: `${username}@test.com`,
				organization_ids: [],
				github_com_user_id: 12345,
			},
		],
	};
}

function createMockResponse(
	body: unknown,
	options?: { status?: number; statusText?: string },
) {
	const status = options?.status ?? 200;
	const bodyStr = body !== undefined ? JSON.stringify(body) : "";
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: options?.statusText ?? "OK",
		headers: new Headers({
			"content-length": bodyStr.length.toString(),
		}),
		json: async () => body,
		text: async () => bodyStr,
	} as unknown as Response;
}

type WaitFnType = CoderServiceOptions["waitForTaskIdleFn"];

/** Build a CoderService with a fake fetchFn and optional waitForTaskIdleFn */
function makeService(
	fetchFn: typeof fetch,
	opts: {
		templatePreset?: string;
		waitForTaskIdleFn?: WaitFnType;
		logger?: TestLogger;
	} = {},
) {
	return new CoderService({
		serverURL: CODER_URL,
		apiToken: API_TOKEN,
		config: {
			organization: ORG,
			templateName: TEMPLATE_NAME,
			...(opts.templatePreset ? { templatePreset: opts.templatePreset } : {}),
		},
		fetchFn,
		logger: opts.logger,
		...(opts.waitForTaskIdleFn
			? { waitForTaskIdleFn: opts.waitForTaskIdleFn }
			: {}),
	});
}

// ── Test 1: create — single call, no polling ─────────────────────────────────

describe("CoderService.create", () => {
	test("single call, no polling — returns new task (EARS-REQ-7)", async () => {
		const calls: string[] = [];
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			calls.push(`${method} ${url}`);

			// GET template
			if (
				method === "GET" &&
				url.includes(`/api/v2/organizations/${ORG}/templates/${TEMPLATE_NAME}`)
			) {
				return Promise.resolve(createMockResponse(makeTemplate()));
			}
			// GET presets
			if (method === "GET" && url.includes("/presets")) {
				return Promise.resolve(createMockResponse(makePresets(true)));
			}
			// GET existing tasks (returns empty — no pre-existing task)
			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse({ tasks: [] }));
			}
			// POST create
			if (method === "POST" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(
					createMockResponse(
						makeTask({ status: "initializing", current_state: null }),
					),
				);
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		const task = await service.create({
			taskName: TASK_NAME,
			owner: OWNER,
			input: "fix the bug",
		});

		// Must have: GET tasks (existing check), GET template, GET presets, POST create
		const getTaskCall = calls.find((c) =>
			c.includes("/api/experimental/tasks/"),
		);
		const getTemplateCall = calls.find((c) =>
			c.includes(`/api/v2/organizations/${ORG}/templates/${TEMPLATE_NAME}`),
		);
		const postCreateCalls = calls.filter(
			(c) => c.startsWith("POST") && c.includes("/api/experimental/tasks/"),
		);

		expect(getTaskCall).toBeDefined();
		expect(getTemplateCall).toBeDefined();
		expect(postCreateCalls).toHaveLength(1);

		// Confirm task is returned
		expect(task.name).toBe(TASK_NAME);
		expect(task.owner).toBe(OWNER);
		expect(task.url).toContain(`/tasks/${OWNER}/${TASK_ID}`);

		// Total calls: GET tasks + GET template + GET presets + POST = 4
		// Zero polling fetches after POST
		expect(calls.length).toBe(4);
	});

	test("returns existing task when same name+owner exists — no POST (EARS-REQ-7 idempotent)", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			// pre-create lookup returns a match
			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse({ tasks: [makeTask()] }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		const task = await service.create({
			taskName: TASK_NAME,
			owner: OWNER,
			input: "any input",
		});

		// Only the GET tasks call, no POST
		const calls = fetchFn.mock.calls as Array<[string, RequestInit?]>;
		const postCalls = calls.filter(([, init]) => init?.method === "POST");
		expect(postCalls).toHaveLength(0);
		expect(task.name).toBe(TASK_NAME);
	});

	test("skips preset lookup when no templatePreset configured and uses default preset", async () => {
		const calls: string[] = [];
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			calls.push(`${method} ${url}`);

			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse({ tasks: [] }));
			}
			if (method === "GET" && url.includes("/api/v2/organizations/")) {
				return Promise.resolve(createMockResponse(makeTemplate()));
			}
			if (method === "GET" && url.includes("/presets")) {
				return Promise.resolve(createMockResponse(makePresets(true)));
			}
			if (method === "POST" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(
					createMockResponse(
						makeTask({ status: "pending", current_state: null }),
					),
				);
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		await service.create({ taskName: TASK_NAME, owner: OWNER, input: "test" });

		// Preset fetch happens because we pick the default preset
		const presetCalls = calls.filter((c) => c.includes("/presets"));
		expect(presetCalls.length).toBeGreaterThanOrEqual(1);
	});
});

// ── Test 3: sendInput on ready task (active+idle) — sends directly ────────────

describe("CoderService.sendInput", () => {
	test("active+idle task — no wait, single send POST (EARS-REQ-14 direct path)", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";

			// Resolve task by name
			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(
					createMockResponse({
						tasks: [
							makeTask({ status: "active", current_state: { state: "idle" } }),
						],
					}),
				);
			}
			// Send endpoint
			if (method === "POST" && url.includes("/send")) {
				return Promise.resolve(createMockResponse(undefined, { status: 204 }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const waitFn = mock((_params: unknown) => Promise.resolve());
		const service = makeService(fetchFn as unknown as typeof fetch, {
			waitForTaskIdleFn: waitFn as unknown as NonNullable<WaitFnType>,
		});

		await service.sendInput({
			taskName: TASK_NAME,
			owner: OWNER,
			input: "hello",
		});

		// waitForTaskIdle NOT called
		expect(waitFn).not.toHaveBeenCalled();

		// exactly one send POST
		const allCalls = fetchFn.mock.calls as Array<[string, RequestInit?]>;
		const sendCalls = allCalls.filter(
			([url, init]) =>
				(init?.method ?? "GET") === "POST" && url.includes("/send"),
		);
		expect(sendCalls).toHaveLength(1);
	});

	// ── Test 4: paused task — resume then wait then send ──────────────────────

	test("paused task — resume POST, then waitForTaskIdle, then send (EARS-REQ-14)", async () => {
		const fetchOrder: string[] = [];
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			fetchOrder.push(`${method} ${url}`);

			// Resolve task by name — returns paused task
			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(
					createMockResponse({ tasks: [makeTask({ status: "paused" })] }),
				);
			}
			// Resume workspace
			if (
				method === "POST" &&
				url.includes(`/api/v2/workspaces/${WORKSPACE_ID}/builds`)
			) {
				return Promise.resolve(createMockResponse({}, { status: 200 }));
			}
			// Send
			if (method === "POST" && url.includes("/send")) {
				return Promise.resolve(createMockResponse(undefined, { status: 204 }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const waitFn = mock((_params: unknown) => Promise.resolve());
		const service = makeService(fetchFn as unknown as typeof fetch, {
			waitForTaskIdleFn: waitFn as unknown as NonNullable<WaitFnType>,
		});

		await service.sendInput({
			taskName: TASK_NAME,
			owner: OWNER,
			input: "hello",
		});

		// resume build posted
		const resumeCalls = fetchOrder.filter((c) =>
			c.includes(`/api/v2/workspaces/${WORKSPACE_ID}/builds`),
		);
		expect(resumeCalls).toHaveLength(1);

		// waitForTaskIdle called exactly once after resume
		expect(waitFn).toHaveBeenCalledTimes(1);

		// send call happened
		const sendCalls = fetchOrder.filter((c) => c.includes("/send"));
		expect(sendCalls).toHaveLength(1);
	});

	// ── Test 5: initializing task — waits then sends ───────────────────────────

	test("initializing task — waitForTaskIdle then single send (EARS-REQ-15)", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";

			// Resolve task — initializing
			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(
					createMockResponse({
						tasks: [makeTask({ status: "initializing", current_state: null })],
					}),
				);
			}
			if (method === "POST" && url.includes("/send")) {
				return Promise.resolve(createMockResponse(undefined, { status: 204 }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const waitFn = mock((_params: unknown) => Promise.resolve());
		const service = makeService(fetchFn as unknown as typeof fetch, {
			waitForTaskIdleFn: waitFn as unknown as NonNullable<WaitFnType>,
		});

		await service.sendInput({
			taskName: TASK_NAME,
			owner: OWNER,
			input: "fix",
		});

		expect(waitFn).toHaveBeenCalledTimes(1);

		const allCalls = fetchFn.mock.calls as Array<[string, RequestInit?]>;
		const sendCalls = allCalls.filter(
			([url, init]) =>
				(init?.method ?? "GET") === "POST" && url.includes("/send"),
		);
		expect(sendCalls).toHaveLength(1);
	});

	// ── Test 6: no retry on send failure ──────────────────────────────────────

	test("does NOT retry on send failure — rejects after first failed send (EARS-REQ-9)", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";

			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse({ tasks: [makeTask()] }));
			}
			if (method === "POST" && url.includes("/send")) {
				return Promise.resolve(
					createMockResponse(
						{ message: "server error" },
						{ status: 500, statusText: "Internal Server Error" },
					),
				);
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const waitFn = mock((_params: unknown) => Promise.resolve());
		const service = makeService(fetchFn as unknown as typeof fetch, {
			waitForTaskIdleFn: waitFn as unknown as NonNullable<WaitFnType>,
		});

		await expect(
			service.sendInput({ taskName: TASK_NAME, owner: OWNER, input: "hello" }),
		).rejects.toThrow();

		// Exactly one send attempt — no retry
		const allCalls = fetchFn.mock.calls as Array<[string, RequestInit?]>;
		const sendCalls = allCalls.filter(
			([url, init]) =>
				(init?.method ?? "GET") === "POST" && url.includes("/send"),
		);
		expect(sendCalls).toHaveLength(1);
	});

	// ── Test 7: default timeout 120000ms ──────────────────────────────────────

	test("passes 120_000 ms default timeout to waitForTaskIdleFn (EARS-REQ-10)", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";

			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(
					createMockResponse({
						tasks: [makeTask({ status: "initializing", current_state: null })],
					}),
				);
			}
			if (method === "POST" && url.includes("/send")) {
				return Promise.resolve(createMockResponse(undefined, { status: 204 }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const waitFn = mock((_params: unknown) => Promise.resolve());
		const service = makeService(fetchFn as unknown as typeof fetch, {
			waitForTaskIdleFn: waitFn as unknown as NonNullable<WaitFnType>,
		});

		await service.sendInput({
			taskName: TASK_NAME,
			owner: OWNER,
			input: "hello",
		});

		expect(waitFn).toHaveBeenCalledTimes(1);
		// The waitFn receives a params object; check timeoutMs defaults to 120_000
		const callArgs = (waitFn.mock.calls[0] as [{ timeoutMs?: number }])[0];
		expect(callArgs.timeoutMs).toBe(120_000);
	});

	test("passes explicit timeout to waitForTaskIdleFn (EARS-REQ-10)", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";

			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(
					createMockResponse({
						tasks: [makeTask({ status: "initializing", current_state: null })],
					}),
				);
			}
			if (method === "POST" && url.includes("/send")) {
				return Promise.resolve(createMockResponse(undefined, { status: 204 }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const waitFn = mock((_params: unknown) => Promise.resolve());
		const service = makeService(fetchFn as unknown as typeof fetch, {
			waitForTaskIdleFn: waitFn as unknown as NonNullable<WaitFnType>,
		});

		await service.sendInput({
			taskName: TASK_NAME,
			owner: OWNER,
			input: "hello",
			timeout: 60_000,
		});

		const callArgs = (waitFn.mock.calls[0] as [{ timeoutMs?: number }])[0];
		expect(callArgs.timeoutMs).toBe(60_000);
	});
});

// ── Test 8 & 9: delete ────────────────────────────────────────────────────────

describe("CoderService.delete", () => {
	test("single DELETE API call — no workspace stop/delete (EARS-REQ-18)", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";

			// Resolve task by name
			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse({ tasks: [makeTask()] }));
			}
			// DELETE
			if (method === "DELETE" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse(undefined, { status: 204 }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		await service.delete({ taskName: TASK_NAME, owner: OWNER });

		const allCalls = fetchFn.mock.calls as Array<[string, RequestInit?]>;
		const deleteCalls = allCalls.filter(
			([, init]) => init?.method === "DELETE",
		);
		const workspaceCalls = allCalls.filter(([url]) =>
			url.includes("/workspaces/"),
		);

		expect(deleteCalls).toHaveLength(1);
		// No workspace calls at all
		expect(workspaceCalls).toHaveLength(0);
	});

	test("no-op when task missing — no DELETE call (EARS-REQ-11)", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";

			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse({ tasks: [] }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		// Should not throw
		await expect(
			service.delete({ taskName: TASK_NAME, owner: OWNER }),
		).resolves.toBeUndefined();

		const allCalls = fetchFn.mock.calls as Array<[string, RequestInit?]>;
		const deleteCalls = allCalls.filter(
			([, init]) => init?.method === "DELETE",
		);
		expect(deleteCalls).toHaveLength(0);
	});
});

// ── Test 10 & 11: getStatus ───────────────────────────────────────────────────

describe("CoderService.getStatus", () => {
	test("resolves to null when task missing (EARS-REQ-12)", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			if (method === "GET" && url.includes("/api/experimental/tasks")) {
				return Promise.resolve(createMockResponse({ tasks: [] }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		const result = await service.getStatus({
			taskName: TASK_NAME,
			owner: OWNER,
		});
		expect(result).toBeNull();
	});

	test("warns on multiple matches when no owner given (EARS-REQ-19)", async () => {
		const task1 = makeTask({ id: TASK_ID });
		const task2 = makeTask({ id: "550e8400-e29b-41d4-a716-446655440099" });

		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			if (method === "GET" && url.includes("/api/experimental/tasks")) {
				return Promise.resolve(createMockResponse({ tasks: [task1, task2] }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const logger = new TestLogger();
		const service = makeService(fetchFn as unknown as typeof fetch, { logger });

		const result = await service.getStatus({ taskName: TASK_NAME });
		// Returns first match
		expect(result).not.toBeNull();
		expect(result?.name).toBe(TASK_NAME);
		// Warn was called
		const warnMessages = logger.messages.filter((m) => m.level === "warn");
		expect(warnMessages.length).toBeGreaterThan(0);
	});
});

// ── Test 12: status normalization ─────────────────────────────────────────────

describe("CoderService status normalization (EARS-REQ-20)", () => {
	const cases: Array<{
		status: string;
		current_state: { state: string } | null;
		expected: TaskStatus;
	}> = [
		{ status: "pending", current_state: null, expected: "initializing" },
		{
			status: "pending",
			current_state: { state: "idle" },
			expected: "initializing",
		},
		{ status: "initializing", current_state: null, expected: "initializing" },
		{
			status: "initializing",
			current_state: { state: "working" },
			expected: "initializing",
		},
		{ status: "active", current_state: { state: "idle" }, expected: "ready" },
		{
			status: "active",
			current_state: { state: "complete" },
			expected: "ready",
		},
		{ status: "active", current_state: { state: "failed" }, expected: "ready" },
		{
			status: "active",
			current_state: { state: "working" },
			expected: "initializing",
		},
		{ status: "active", current_state: null, expected: "ready" },
		{ status: "paused", current_state: null, expected: "stopped" },
		{ status: "paused", current_state: { state: "idle" }, expected: "stopped" },
		{ status: "error", current_state: null, expected: "error" },
		{ status: "error", current_state: { state: "failed" }, expected: "error" },
		{ status: "unknown", current_state: null, expected: "error" },
		{ status: "unknown", current_state: { state: "idle" }, expected: "error" },
	];

	for (const { status, current_state, expected } of cases) {
		test(`Coder status="${status}" current_state=${current_state?.state ?? "null"} → TaskStatus="${expected}"`, async () => {
			const fetchFn = mock((url: string, init?: RequestInit) => {
				const method = init?.method ?? "GET";
				if (method === "GET" && url.includes("/api/experimental/tasks")) {
					return Promise.resolve(
						createMockResponse({
							tasks: [makeTask({ status, current_state })],
						}),
					);
				}
				throw new Error(`Unexpected fetch: ${method} ${url}`);
			});

			const service = makeService(fetchFn as unknown as typeof fetch);
			const result = await service.getStatus({
				taskName: TASK_NAME,
				owner: OWNER,
			});
			expect(result?.status).toBe(expected);
		});
	}
});

// ── Test 13: Task.url populated ───────────────────────────────────────────────

describe("CoderService Task.url", () => {
	test("url is composed as coderURL/tasks/owner/taskId", async () => {
		const fetchFn = mock((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			if (method === "GET" && url.includes("/api/experimental/tasks")) {
				return Promise.resolve(createMockResponse({ tasks: [makeTask()] }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		const result = await service.getStatus({
			taskName: TASK_NAME,
			owner: OWNER,
		});
		expect(result?.url).toBe(`${CODER_URL}/tasks/${OWNER}/${TASK_ID}`);
	});
});

// ── lookupUser ────────────────────────────────────────────────────────────────

describe("CoderService.lookupUser", () => {
	test("resolves github user to coder username", async () => {
		const fetchFn = mock((url: string) => {
			if (url.includes("/api/v2/users")) {
				return Promise.resolve(createMockResponse(makeUserList("coderuser")));
			}
			throw new Error(`Unexpected fetch: GET ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		const username = await service.lookupUser({
			user: { type: "github", id: "12345", username: "ghuser" },
		});
		expect(username).toBe("coderuser");
	});

	test("throws when user not found", async () => {
		const fetchFn = mock(() => {
			return Promise.resolve(createMockResponse({ users: [] }));
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		await expect(
			service.lookupUser({
				user: { type: "github", id: "99999", username: "nobody" },
			}),
		).rejects.toThrow();
	});
});
