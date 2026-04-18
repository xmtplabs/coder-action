import { describe, expect, test } from "vitest";
import worker from "./main";

describe("Worker default export", () => {
	test("has a fetch handler", () => {
		expect(typeof worker.fetch).toBe("function");
	});

	test("GET /healthz returns 200 'ok'", async () => {
		const req = new Request("https://example.com/healthz", { method: "GET" });
		const res = await worker.fetch(
			req,
			{} as never,
			{} as ExecutionContext,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	test("unknown route returns 404", async () => {
		const req = new Request("https://example.com/unknown", { method: "GET" });
		const res = await worker.fetch(
			req,
			{} as never,
			{} as ExecutionContext,
		);
		expect(res.status).toBe(404);
	});
});
