import { describe, expect, test } from "vitest";
import { buildSignedWebhookRequest } from "./workflow-test-helpers";

describe("buildSignedWebhookRequest", () => {
	test("produces a Request with X-Hub-Signature-256", async () => {
		const req = await buildSignedWebhookRequest({
			secret: "test-secret",
			body: JSON.stringify({ foo: "bar" }),
			eventName: "issues",
			deliveryId: "d-1",
		});
		expect(req.method).toBe("POST");
		expect(req.headers.get("X-Hub-Signature-256")).toMatch(/^sha256=/);
		expect(req.headers.get("X-GitHub-Event")).toBe("issues");
		expect(req.headers.get("X-GitHub-Delivery")).toBe("d-1");
	});

	test("uses default deliveryId when not provided", async () => {
		const req = await buildSignedWebhookRequest({
			secret: "s",
			body: "{}",
			eventName: "issues",
		});
		expect(req.headers.get("X-GitHub-Delivery")).toBe("test-delivery");
	});

	test("respects override signature (used for 401 test paths)", async () => {
		const req = await buildSignedWebhookRequest({
			secret: "s",
			body: "{}",
			eventName: "issues",
			signature: "sha256=deadbeef",
		});
		expect(req.headers.get("X-Hub-Signature-256")).toBe("sha256=deadbeef");
	});
});
