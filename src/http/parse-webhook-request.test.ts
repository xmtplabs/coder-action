import { describe, expect, test } from "vitest";
import {
	InvalidJsonError,
	InvalidSignatureError,
	MissingEventHeaderError,
	MissingSignatureError,
	parseWebhookRequest,
	WebhookRequestError,
} from "./parse-webhook-request";
import { computeSignature } from "../testing/workflow-test-helpers";

const SECRET = "test-webhook-secret";

async function signedReq(opts: {
	body: string;
	eventName?: string;
	deliveryId?: string;
	signature?: string;
}): Promise<Request> {
	const signature =
		opts.signature ?? (await computeSignature(SECRET, opts.body));
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-Hub-Signature-256": signature,
	};
	if (opts.eventName) headers["X-GitHub-Event"] = opts.eventName;
	if (opts.deliveryId) headers["X-GitHub-Delivery"] = opts.deliveryId;
	return new Request("https://w/webhooks/github", {
		method: "POST",
		headers,
		body: opts.body,
	});
}

describe("parseWebhookRequest — happy path", () => {
	test("valid signature + headers + JSON → returns parsed components", async () => {
		const body = JSON.stringify({ action: "opened", issue: { number: 1 } });
		const req = await signedReq({
			body,
			eventName: "issues",
			deliveryId: "d-123",
		});
		const result = await parseWebhookRequest(req, SECRET);
		expect(result.eventName).toBe("issues");
		expect(result.deliveryId).toBe("d-123");
		expect(result.payload).toEqual({ action: "opened", issue: { number: 1 } });
		expect(result.rawBody).toBe(body);
	});

	test("missing X-GitHub-Delivery header defaults to 'unknown'", async () => {
		const body = JSON.stringify({ ok: true });
		const req = await signedReq({ body, eventName: "issues" });
		const result = await parseWebhookRequest(req, SECRET);
		expect(result.deliveryId).toBe("unknown");
	});
});

describe("parseWebhookRequest — typed errors", () => {
	test("missing X-Hub-Signature-256 → MissingSignatureError (401)", async () => {
		const body = "{}";
		const req = new Request("https://w/webhooks/github", {
			method: "POST",
			headers: { "X-GitHub-Event": "issues" },
			body,
		});
		let thrown: unknown;
		try {
			await parseWebhookRequest(req, SECRET);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(MissingSignatureError);
		expect(thrown).toBeInstanceOf(WebhookRequestError);
		expect((thrown as MissingSignatureError).status).toBe(401);
		expect((thrown as MissingSignatureError).body).toMatch(/missing signature/);
	});

	test("wrong signature → InvalidSignatureError (401)", async () => {
		const body = "{}";
		const req = await signedReq({
			body,
			eventName: "issues",
			signature: `sha256=${"0".repeat(64)}`,
		});
		let thrown: unknown;
		try {
			await parseWebhookRequest(req, SECRET);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(InvalidSignatureError);
		expect((thrown as InvalidSignatureError).status).toBe(401);
		expect((thrown as InvalidSignatureError).body).toMatch(/invalid signature/);
	});

	test("malformed signature (triggers verify() throw) → InvalidSignatureError (401)", async () => {
		// Signature header shape that makes verify() throw internally; parser
		// catches the throw and treats it as an invalid signature.
		const body = "{}";
		const req = await signedReq({
			body,
			eventName: "issues",
			signature: "not-a-valid-format",
		});
		await expect(parseWebhookRequest(req, SECRET)).rejects.toBeInstanceOf(
			InvalidSignatureError,
		);
	});

	test("missing X-GitHub-Event header → MissingEventHeaderError (400)", async () => {
		const body = "{}";
		const req = await signedReq({ body });
		let thrown: unknown;
		try {
			await parseWebhookRequest(req, SECRET);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(MissingEventHeaderError);
		expect((thrown as MissingEventHeaderError).status).toBe(400);
	});

	test("signed but malformed JSON body → InvalidJsonError (400)", async () => {
		const body = "not { json";
		const req = await signedReq({ body, eventName: "issues" });
		let thrown: unknown;
		try {
			await parseWebhookRequest(req, SECRET);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(InvalidJsonError);
		expect((thrown as InvalidJsonError).status).toBe(400);
		expect((thrown as InvalidJsonError).body).toMatch(/invalid JSON/i);
	});

	test("stage ordering: missing signature short-circuits before JSON parse (defense-in-depth)", async () => {
		// Unsigned + malformed JSON. Must fail at signature stage (401), NOT at
		// JSON stage (400). Proves the parser doesn't leak information about
		// the body shape to unauthenticated callers.
		const body = "not { json";
		const req = new Request("https://w/webhooks/github", {
			method: "POST",
			headers: { "X-GitHub-Event": "issues" },
			body,
		});
		await expect(parseWebhookRequest(req, SECRET)).rejects.toBeInstanceOf(
			MissingSignatureError,
		);
	});
});
