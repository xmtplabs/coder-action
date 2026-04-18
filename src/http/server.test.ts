import { describe, expect, test, beforeEach } from "vitest";
import { createApp } from "./server";
import { TestLogger } from "../infra/logger";

async function computeSignature(secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	const hex = Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `sha256=${hex}`;
}

const TEST_SECRET = "test-webhook-secret";

describe("GET /healthz", () => {
	test("returns 200", async () => {
		const logger = new TestLogger();
		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async () => ({ dispatched: false }),
			logger,
		});

		const res = await app.request("/healthz");
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toBe("ok");
	});
});

describe("POST /api/webhooks", () => {
	let logger: TestLogger;
	let receivedEvents: Array<{
		eventName: string;
		deliveryId: string;
		payload: unknown;
	}>;

	beforeEach(() => {
		logger = new TestLogger();
		receivedEvents = [];
	});

	test("with valid signature returns 200 and calls handleWebhook with event name", async () => {
		const body = JSON.stringify({ action: "opened" });
		const signature = await computeSignature(TEST_SECRET, body);

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async (eventName, deliveryId, payload) => {
				receivedEvents.push({ eventName, deliveryId, payload });
				return { dispatched: false };
			},
			logger,
		});

		const res = await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
				"X-GitHub-Event": "issues",
				"X-GitHub-Delivery": "abc-123",
			},
			body,
		});

		expect(res.status).toBe(200);
		expect(receivedEvents).toHaveLength(1);
		expect(receivedEvents[0].eventName).toBe("issues");
		expect(receivedEvents[0].deliveryId).toBe("abc-123");
	});

	test("with invalid signature returns 401", async () => {
		const body = JSON.stringify({ action: "opened" });

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async () => ({ dispatched: false }),
			logger,
		});

		const res = await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": "sha256=invalidsignature",
				"X-GitHub-Event": "issues",
				"X-GitHub-Delivery": "abc-123",
			},
			body,
		});

		expect(res.status).toBe(401);
	});

	test("with missing signature returns 401", async () => {
		const body = JSON.stringify({ action: "opened" });

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async () => ({ dispatched: false }),
			logger,
		});

		const res = await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-GitHub-Event": "issues",
				"X-GitHub-Delivery": "abc-123",
			},
			body,
		});

		expect(res.status).toBe(401);
	});

	test("with missing X-GitHub-Event returns 400", async () => {
		const body = JSON.stringify({ action: "opened" });
		const signature = await computeSignature(TEST_SECRET, body);

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async () => ({ dispatched: false }),
			logger,
		});

		const res = await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
				"X-GitHub-Delivery": "abc-123",
			},
			body,
		});

		expect(res.status).toBe(400);
	});

	test("with valid signature but invalid JSON body returns 400", async () => {
		const body = "not valid json {{{";
		const signature = await computeSignature(TEST_SECRET, body);

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async () => ({ dispatched: false }),
			logger,
		});

		const res = await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
				"X-GitHub-Event": "issues",
				"X-GitHub-Delivery": "abc-123",
			},
			body,
		});

		expect(res.status).toBe(400);
	});

	test("handler error returns 500", async () => {
		const body = JSON.stringify({ action: "opened" });
		const signature = await computeSignature(TEST_SECRET, body);

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async (): Promise<never> => {
				throw new Error("handler blew up");
			},
			logger,
		});

		const res = await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
				"X-GitHub-Event": "issues",
				"X-GitHub-Delivery": "abc-123",
			},
			body,
		});

		expect(res.status).toBe(500);
		const errorLogs = logger.messages.filter((m) => m.level === "error");
		expect(errorLogs.length).toBeGreaterThan(0);
	});

	test("handleWebhook returning status 400 results in 400 response", async () => {
		const body = JSON.stringify({ action: "opened" });
		const signature = await computeSignature(TEST_SECRET, body);

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async () => ({ dispatched: false, status: 400 }),
			logger,
		});

		const res = await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
				"X-GitHub-Event": "issue_comment",
				"X-GitHub-Delivery": "abc-456",
			},
			body,
		});

		expect(res.status).toBe(400);
	});

	test("handleWebhook returning dispatched result logs handler and duration_ms", async () => {
		const body = JSON.stringify({ action: "opened" });
		const signature = await computeSignature(TEST_SECRET, body);

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async () => ({
				dispatched: true,
				handler: "create_task",
			}),
			logger,
		});

		const res = await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
				"X-GitHub-Event": "issues",
				"X-GitHub-Delivery": "abc-789",
			},
			body,
		});

		expect(res.status).toBe(200);
		const infoLogs = logger.messages.filter((m) => m.level === "info");
		const lastLog = infoLogs[infoLogs.length - 1];
		expect(lastLog.fields?.handler).toBe("create_task");
		expect(lastLog.fields?.dispatched).toBe(true);
		expect(typeof lastLog.fields?.duration_ms).toBe("number");
	});

	test("logs qualified eventName (event.action) and deliveryId without full payload", async () => {
		const payloadObj = {
			action: "opened",
			repository: { full_name: "org/repo" },
		};
		const body = JSON.stringify(payloadObj);
		const signature = await computeSignature(TEST_SECRET, body);

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async () => ({ dispatched: false }),
			logger,
		});

		await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
				"X-GitHub-Event": "issues",
				"X-GitHub-Delivery": "raw-log-test",
			},
			body,
		});

		const receivedLog = logger.messages.find(
			(m) => m.level === "info" && m.message === "Webhook received",
		);
		expect(receivedLog).toBeDefined();
		expect(receivedLog?.fields?.eventName).toBe("issues.opened");
		expect(receivedLog?.fields?.deliveryId).toBe("raw-log-test");
		expect(receivedLog?.fields?.payload).toBeUndefined();
	});

	test("per-request child logger includes deliveryId and eventName", async () => {
		const body = JSON.stringify({ action: "opened" });
		const signature = await computeSignature(TEST_SECRET, body);

		const app = createApp({
			webhookSecret: TEST_SECRET,
			handleWebhook: async (_ev, _del, _pay, reqLogger) => {
				reqLogger.info("handler executed");
				return { dispatched: false };
			},
			logger,
		});

		await app.request("/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
				"X-GitHub-Event": "issues",
				"X-GitHub-Delivery": "delivery-xyz",
			},
			body,
		});

		const handlerLog = logger.messages.find(
			(m) => m.message === "handler executed",
		);
		expect(handlerLog).toBeDefined();
		expect(handlerLog?.fields?.deliveryId).toBe("delivery-xyz");
		expect(handlerLog?.fields?.eventName).toBe("issues.opened");
	});
});
