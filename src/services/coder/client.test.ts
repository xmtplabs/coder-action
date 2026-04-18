import { describe, expect, test, beforeEach, mock } from "bun:test";
import {
	RealCoderClient,
	CoderAPIError,
	TaskNameSchema,
	TaskIdSchema,
} from "./client";

function createMockResponse(
	body: unknown,
	options?: { status?: number; statusText?: string },
) {
	const status = options?.status ?? 200;
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: options?.statusText ?? "OK",
		headers: new Headers({
			"content-length": (JSON.stringify(body) ?? "").length.toString(),
		}),
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

describe("RealCoderClient", () => {
	let mockFetch: ReturnType<typeof mock>;
	let client: RealCoderClient;

	beforeEach(() => {
		mockFetch = mock(() => Promise.resolve(createMockResponse({})));
		client = new RealCoderClient(
			"https://coder.test",
			"test-token",
			mockFetch as unknown as typeof fetch,
		);
	});

	describe("getTask", () => {
		test("returns task when found", async () => {
			const taskData = {
				tasks: [
					{
						id: "550e8400-e29b-41d4-a716-446655440000",
						name: "gh-repo-42",
						owner_id: "550e8400-e29b-41d4-a716-446655440001",
						template_id: "550e8400-e29b-41d4-a716-446655440002",
						workspace_id: "550e8400-e29b-41d4-a716-446655440003",
						created_at: "2026-01-01T00:00:00Z",
						updated_at: "2026-01-01T00:00:00Z",
						status: "active",
						current_state: { state: "idle" },
					},
				],
			};
			mockFetch.mockResolvedValueOnce(createMockResponse(taskData));
			const result = await client.getTask(
				"user",
				TaskNameSchema.parse("gh-repo-42"),
			);
			expect(result).not.toBeNull();
			expect(result?.name).toBe(TaskNameSchema.parse("gh-repo-42"));
		});

		test("returns null when not found", async () => {
			mockFetch.mockResolvedValueOnce(createMockResponse({ tasks: [] }));
			const result = await client.getTask(
				"user",
				TaskNameSchema.parse("gh-repo-99"),
			);
			expect(result).toBeNull();
		});
	});

	describe("createTask", () => {
		test("creates task successfully", async () => {
			const created = {
				id: "550e8400-e29b-41d4-a716-446655440000",
				name: "gh-repo-42",
				owner_id: "550e8400-e29b-41d4-a716-446655440001",
				template_id: "550e8400-e29b-41d4-a716-446655440002",
				workspace_id: "550e8400-e29b-41d4-a716-446655440003",
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
				status: "pending",
				current_state: null,
			};
			mockFetch.mockResolvedValueOnce(createMockResponse(created));
			const result = await client.createTask("user", {
				name: "gh-repo-42",
				template_version_id: "ver-id",
				input: "test prompt",
			});
			expect(result.name).toBe(TaskNameSchema.parse("gh-repo-42"));
		});
	});

	describe("sendTaskInput", () => {
		test("sends input successfully", async () => {
			mockFetch.mockResolvedValueOnce(
				createMockResponse(undefined, { status: 204 }),
			);
			await client.sendTaskInput(
				"user",
				TaskIdSchema.parse("550e8400-e29b-41d4-a716-446655440000"),
				"hello",
			);
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});
	});

	describe("stopWorkspace", () => {
		test("posts stop transition", async () => {
			mockFetch.mockResolvedValueOnce(createMockResponse({ id: "build-1" }));
			await client.stopWorkspace("ws-id");
			const call = mockFetch.mock.calls[0];
			expect(call[0]).toContain("/api/v2/workspaces/ws-id/builds");
			const body = JSON.parse(call[1].body);
			expect(body.transition).toBe("stop");
		});
	});

	describe("deleteWorkspace", () => {
		test("posts delete transition", async () => {
			mockFetch.mockResolvedValueOnce(createMockResponse({ id: "build-1" }));
			await client.deleteWorkspace("ws-id");
			const call = mockFetch.mock.calls[0];
			const body = JSON.parse(call[1].body);
			expect(body.transition).toBe("delete");
		});
	});

	describe("getWorkspace", () => {
		test("returns workspace data", async () => {
			const ws = {
				id: "ws-id",
				latest_build: { status: "running", transition: "start" },
			};
			mockFetch.mockResolvedValueOnce(createMockResponse(ws));
			const result = await client.getWorkspace("ws-id");
			expect(result.id).toBe("ws-id");
		});

		test("throws on 404", async () => {
			mockFetch.mockResolvedValueOnce(
				createMockResponse({}, { status: 404, statusText: "Not Found" }),
			);
			expect(client.getWorkspace("ws-id")).rejects.toThrow(CoderAPIError);
		});
	});

	describe("waitForWorkspaceStopped", () => {
		test("resolves immediately when workspace is already stopped", async () => {
			const ws = {
				id: "ws-id",
				latest_build: { status: "stopped", transition: "stop" },
			};
			mockFetch.mockResolvedValueOnce(createMockResponse(ws));
			const logs: string[] = [];
			await client.waitForWorkspaceStopped("ws-id", (msg) => logs.push(msg));
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		test("resolves after workspace transitions to stopped", async () => {
			const stopping = {
				id: "ws-id",
				latest_build: { status: "stopping", transition: "stop" },
			};
			const stopped = {
				id: "ws-id",
				latest_build: { status: "stopped", transition: "stop" },
			};
			mockFetch
				.mockResolvedValueOnce(createMockResponse(stopping))
				.mockResolvedValueOnce(createMockResponse(stopped));
			const logs: string[] = [];
			await client.waitForWorkspaceStopped(
				"ws-id",
				(msg) => logs.push(msg),
				10000,
			);
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		test("resolves when workspace reaches failed status", async () => {
			const ws = {
				id: "ws-id",
				latest_build: { status: "failed", transition: "stop" },
			};
			mockFetch.mockResolvedValueOnce(createMockResponse(ws));
			await client.waitForWorkspaceStopped("ws-id", () => {});
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		test("throws CoderAPIError on timeout", async () => {
			const stopping = {
				id: "ws-id",
				latest_build: { status: "stopping", transition: "stop" },
			};
			// Always return stopping so it times out
			mockFetch.mockResolvedValue(createMockResponse(stopping));
			await expect(
				client.waitForWorkspaceStopped("ws-id", () => {}, 100),
			).rejects.toThrow(CoderAPIError);
		});
	});
});
