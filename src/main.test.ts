import { describe, expect, test } from "vitest";
import worker from "./main";

describe("Worker default export", () => {
	test("has a fetch handler", () => {
		expect(typeof worker.fetch).toBe("function");
	});

	test("unknown route returns 404", async () => {
		const req = new Request("https://example.com/unknown", { method: "GET" });
		const res = await worker.fetch(req, {} as never, {} as ExecutionContext);
		expect(res.status).toBe(404);
	});
});
