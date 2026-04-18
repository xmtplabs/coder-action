import { describe, expect, test, vi } from "vitest";
import type { TaskStatus } from "../task-runner";
import { TaskNameSchema, TaskIdSchema } from "../task-runner";
import { TestLogger } from "../../infra/logger";
import { CoderService } from "./service";
import { CoderAPIError } from "./errors";

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

/** Build a CoderService with a fake fetchFn */
function makeService(
	fetchFn: typeof fetch,
	opts: {
		templatePreset?: string;
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
	});
}

// ── Test 1: create — single call, no polling ─────────────────────────────────

describe("CoderService.create", () => {
	test("single call, no polling — returns new task (EARS-REQ-7)", async () => {
		const calls: string[] = [];
		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
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
		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
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

	test("fetches default preset when no templatePreset configured and uses it in POST body", async () => {
		const postBodies: unknown[] = [];
		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";

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
				postBodies.push(
					init?.body ? JSON.parse(init.body as string) : undefined,
				);
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

		// POST body must include the default preset's ID
		expect(postBodies).toHaveLength(1);
		const body = postBodies[0] as Record<string, unknown>;
		expect(body.template_version_preset_id).toBe(PRESET_ID);
	});
});

// ── sendInput (post-polling-removal) ────────────────────────────────────────

describe("CoderService.sendInput (no polling)", () => {
	test("single send — resolves task by name + owner then POSTs to send endpoint", async () => {
		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			// Resolve task by name
			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse({ tasks: [makeTask()] }));
			}
			// Send endpoint
			if (method === "POST" && url.includes("/send")) {
				return Promise.resolve(createMockResponse(undefined, { status: 204 }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		await service.sendInput({
			taskName: TASK_NAME,
			owner: OWNER,
			input: "hello",
		});

		const allCalls = fetchFn.mock.calls as Array<[string, RequestInit?]>;
		const sendCalls = allCalls.filter(
			([url, init]) => init?.method === "POST" && url.includes("/send"),
		);
		expect(sendCalls).toHaveLength(1);
	});

	test("throws when task not found", async () => {
		const fetchFn = vi.fn(() =>
			Promise.resolve(createMockResponse({ tasks: [] })),
		);
		const service = makeService(fetchFn as unknown as typeof fetch);
		await expect(
			service.sendInput({
				taskName: TASK_NAME,
				owner: OWNER,
				input: "hello",
			}),
		).rejects.toThrow(/Task not found/);
	});
});

// ── Test 8 & 9: delete ────────────────────────────────────────────────────────

describe("CoderService.delete", () => {
	test("single DELETE API call — no workspace stop/delete (EARS-REQ-18)", async () => {
		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
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
		const result = await service.delete({ taskName: TASK_NAME, owner: OWNER });
		expect(result).toEqual({ deleted: true });

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

	test("without owner, resolves UUID owner_id to username before DELETE", async () => {
		const OWNER_UUID = "550e8400-e29b-41d4-a716-446655440004"; // makeTask() owner_id
		const RESOLVED_USERNAME = "resolved-username";

		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			if (
				method === "GET" &&
				url.includes("/api/experimental/tasks") &&
				!url.includes("/api/v2/users/")
			) {
				return Promise.resolve(createMockResponse({ tasks: [makeTask()] }));
			}
			if (method === "GET" && url.includes(`/api/v2/users/${OWNER_UUID}`)) {
				return Promise.resolve(
					createMockResponse({
						id: OWNER_UUID,
						username: RESOLVED_USERNAME,
						email: `${RESOLVED_USERNAME}@test.com`,
						organization_ids: [],
					}),
				);
			}
			if (method === "DELETE" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse(undefined, { status: 204 }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		const result = await service.delete({ taskName: TASK_NAME });
		expect(result).toEqual({ deleted: true });

		const allCalls = fetchFn.mock.calls as Array<[string, RequestInit?]>;
		const deleteCall = allCalls.find(([, init]) => init?.method === "DELETE");
		expect(deleteCall).toBeDefined();
		// DELETE URL must contain the resolved username, NOT the UUID
		expect(deleteCall?.[0]).toContain(`/tasks/${RESOLVED_USERNAME}/`);
		expect(deleteCall?.[0]).not.toContain(OWNER_UUID);
	});

	test("no-op when task missing — no DELETE call, returns { deleted: false } (EARS-REQ-11)", async () => {
		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";

			if (method === "GET" && url.includes("/api/experimental/tasks/")) {
				return Promise.resolve(createMockResponse({ tasks: [] }));
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		const result = await service.delete({ taskName: TASK_NAME, owner: OWNER });
		expect(result).toEqual({ deleted: false });

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
		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
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
		// task owner_id is a UUID — resolveOwnerUsername will call /api/v2/users/<uuid>
		const OWNER_UUID = task1.owner_id;

		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			if (method === "GET" && url.includes("/api/experimental/tasks")) {
				return Promise.resolve(createMockResponse({ tasks: [task1, task2] }));
			}
			if (method === "GET" && url.includes(`/api/v2/users/${OWNER_UUID}`)) {
				return Promise.resolve(
					createMockResponse({
						id: OWNER_UUID,
						username: OWNER,
						email: `${OWNER}@test.com`,
						organization_ids: [],
					}),
				);
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
			const fetchFn = vi.fn((url: string, init?: RequestInit) => {
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
		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
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

	test("getStatus without owner resolves UUID owner_id to username for Task.url (spec §4)", async () => {
		// The task's owner_id is a UUID; getStatus must resolve it to a username
		const OWNER_UUID = "550e8400-e29b-41d4-a716-446655440004"; // matches makeTask() owner_id
		const RESOLVED_USERNAME = "resolved-username";

		const fetchFn = vi.fn((url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			// findTask (no owner) returns the task
			if (
				method === "GET" &&
				url.includes("/api/experimental/tasks") &&
				!url.includes(`/api/v2/users/`)
			) {
				return Promise.resolve(createMockResponse({ tasks: [makeTask()] }));
			}
			// resolveOwnerUsername fetches user by UUID
			if (method === "GET" && url.includes(`/api/v2/users/${OWNER_UUID}`)) {
				return Promise.resolve(
					createMockResponse({
						id: OWNER_UUID,
						username: RESOLVED_USERNAME,
						email: `${RESOLVED_USERNAME}@test.com`,
						organization_ids: [],
					}),
				);
			}
			throw new Error(`Unexpected fetch: ${method} ${url}`);
		});

		const service = makeService(fetchFn as unknown as typeof fetch);
		const result = await service.getStatus({ taskName: TASK_NAME });
		// URL must contain the resolved username, NOT the UUID
		expect(result?.url).toContain(`/tasks/${RESOLVED_USERNAME}/`);
		expect(result?.url).not.toContain(OWNER_UUID);
		expect(result?.owner).toBe(RESOLVED_USERNAME);
	});
});

// ── lookupUser ────────────────────────────────────────────────────────────────

describe("CoderService.lookupUser", () => {
	test("resolves github user to coder username", async () => {
		const fetchFn = vi.fn((url: string) => {
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
		const fetchFn = vi.fn(() => {
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

// ── Primitive methods (Phase 4 Task 12) ──────────────────────────────────────

describe("CoderService primitives", () => {
	function makeMinimalService(fetchFn: typeof fetch): CoderService {
		return new CoderService({
			serverURL: "https://c",
			apiToken: "t",
			config: { organization: "default", templateName: "x" },
			fetchFn,
		});
	}

	test("findTaskByName returns null on 404", async () => {
		const fetchFn = vi.fn(async () => new Response("", { status: 404 }));
		const svc = makeMinimalService(fetchFn as unknown as typeof fetch);
		const result = await svc.findTaskByName(
			TaskNameSchema.parse("tname"),
			"owner",
		);
		expect(result).toBeNull();
	});

	test("findTaskByName returns the matching task when found", async () => {
		const matching = makeTask({ name: "tname" });
		const fetchFn = vi.fn(
			async () =>
				new Response(JSON.stringify({ tasks: [matching], count: 1 }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const svc = makeMinimalService(fetchFn as unknown as typeof fetch);
		const result = await svc.findTaskByName(
			TaskNameSchema.parse("tname"),
			"owner",
		);
		expect(result).not.toBeNull();
		expect(result?.name).toBe("tname");
	});

	test("getTaskById throws CoderAPIError on non-2xx", async () => {
		const fetchFn = vi.fn(async () => new Response("boom", { status: 500 }));
		const svc = makeMinimalService(fetchFn as unknown as typeof fetch);
		await expect(
			svc.getTaskById(TaskIdSchema.parse(TASK_ID), "owner"),
		).rejects.toThrow(CoderAPIError);
	});

	test("getTaskById returns the parsed task on 200", async () => {
		const raw = makeTask();
		const fetchFn = vi.fn(
			async () =>
				new Response(JSON.stringify(raw), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const svc = makeMinimalService(fetchFn as unknown as typeof fetch);
		const parsed = await svc.getTaskById(TaskIdSchema.parse(TASK_ID), "owner");
		expect(parsed.id).toBe(TASK_ID);
	});

	test("resumeWorkspace POSTs to /api/v2/workspaces/<id>/builds with transition start", async () => {
		const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
		const svc = makeMinimalService(fetchFn as unknown as typeof fetch);
		await svc.resumeWorkspace("ws-123");
		const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, RequestInit];
		expect(call[0]).toContain("/api/v2/workspaces/ws-123/builds");
		expect(call[1].method).toBe("POST");
		expect(JSON.parse(call[1].body as string)).toEqual({
			transition: "start",
		});
	});

	test("sendTaskInput POSTs to /api/experimental/tasks/<owner>/<id>/send", async () => {
		const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
		const svc = makeMinimalService(fetchFn as unknown as typeof fetch);
		await svc.sendTaskInput(TaskIdSchema.parse(TASK_ID), "owner", "hello");
		const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, RequestInit];
		expect(call[0]).toContain(
			`/api/experimental/tasks/owner/${encodeURIComponent(TASK_ID)}/send`,
		);
		expect(call[1].method).toBe("POST");
		expect(JSON.parse(call[1].body as string)).toEqual({ input: "hello" });
	});
});
