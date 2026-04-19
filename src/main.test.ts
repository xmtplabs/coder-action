import { beforeEach, describe, expect, test, vi } from "vitest";
import worker, { __setAppBotLoginForTests } from "./main";
import workflowRunSuccess from "./testing/fixtures/workflow-run-success.json";
import { computeSignature } from "./testing/workflow-test-helpers";

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

// ── Worker tracing bindings ───────────────────────────────────────────────────
//
// The Worker's `handleGithubWebhook` builds `reqLogger` after
// `parseWebhookRequest` succeeds and immediately emits a "Webhook received"
// log line on it. We drive a real signed webhook through `worker.fetch`, spy
// on `console.log` (JSON mode), then inspect the emitted record to assert
// which tracing bindings ended up on the child logger.

const TEST_SECRET = "test-webhook-secret";
const TEST_APP_ID = "123";
const TEST_PRIVATE_KEY =
	"-----BEGIN RSA PRIVATE KEY-----\nfake-key\n-----END RSA PRIVATE KEY-----";
const AGENT_LOGIN = "xmtp-coder-agent";

const baseEnv = {
	APP_ID: TEST_APP_ID,
	PRIVATE_KEY: TEST_PRIVATE_KEY,
	WEBHOOK_SECRET: TEST_SECRET,
	AGENT_GITHUB_USERNAME: AGENT_LOGIN,
	CODER_URL: "https://coder.example.com",
	CODER_TOKEN: "token",
	CODER_TASK_NAME_PREFIX: "gh",
	CODER_TEMPLATE_NAME: "task-template",
	CODER_TEMPLATE_NAME_CODEX: "task-template-codex",
	CODER_ORGANIZATION: "default",
	LOG_FORMAT: "json",
};

function makeTracingEnv() {
	return {
		...baseEnv,
		TASK_RUNNER_WORKFLOW: {
			create: (args: { id: string; params: unknown }) =>
				Promise.resolve({ id: args.id }),
		},
	} as unknown as Parameters<typeof worker.fetch>[1];
}

interface BuildReqOpts {
	headers?: Record<string, string>;
}

async function buildWebhookRequestWithHeaders(
	opts: BuildReqOpts = {},
): Promise<Request> {
	const body = JSON.stringify(workflowRunSuccess);
	const signature = await computeSignature(TEST_SECRET, body);
	return new Request("https://example.com/webhooks/github", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Hub-Signature-256": signature,
			"X-GitHub-Event": "workflow_run",
			"X-GitHub-Delivery": "trace-delivery-1",
			...(opts.headers ?? {}),
		},
		body,
	});
}

/**
 * Invoke the Worker with the given request, capture every `console.log` call,
 * and return the JSON record (if any) whose `msg === "Webhook received"`.
 */
async function captureWebhookReceivedLog(
	req: Request,
): Promise<Record<string, unknown>> {
	const spy = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		await worker.fetch(req, makeTracingEnv(), {} as ExecutionContext);
	} finally {
		// leave cleanup to `afterEach` via mockRestore below
	}
	const entries: Record<string, unknown>[] = [];
	for (const call of spy.mock.calls) {
		const arg = call[0];
		if (typeof arg !== "string") continue;
		try {
			entries.push(JSON.parse(arg) as Record<string, unknown>);
		} catch {
			// non-JSON console.log output — ignore.
		}
	}
	spy.mockRestore();
	const match = entries.find((e) => e.msg === "Webhook received");
	if (!match) {
		throw new Error(
			`"Webhook received" log not emitted. Captured: ${JSON.stringify(entries)}`,
		);
	}
	return match;
}

describe("Worker tracing bindings", () => {
	beforeEach(() => {
		__setAppBotLoginForTests("xmtp-coder-tasks[bot]");
	});

	test("cf-ray + valid traceparent → rayId, traceId, spanId bound on reqLogger", async () => {
		const req = await buildWebhookRequestWithHeaders({
			headers: {
				"cf-ray": "8a1-SJC",
				traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
			},
		});
		const log = await captureWebhookReceivedLog(req);
		expect(log.deliveryId).toBe("trace-delivery-1");
		expect(log.eventName).toBe("workflow_run");
		expect(log.rayId).toBe("8a1-SJC");
		expect(log.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
		expect(log.spanId).toBe("b7ad6b7169203331");
	});

	test("missing cf-ray and missing traceparent → no rayId/traceId/spanId keys", async () => {
		const req = await buildWebhookRequestWithHeaders();
		const log = await captureWebhookReceivedLog(req);
		expect(log.deliveryId).toBe("trace-delivery-1");
		expect(log.eventName).toBe("workflow_run");
		expect("rayId" in log).toBe(false);
		expect("traceId" in log).toBe(false);
		expect("spanId" in log).toBe(false);
	});

	test("cf-ray present but traceparent malformed → rayId only", async () => {
		const req = await buildWebhookRequestWithHeaders({
			headers: {
				"cf-ray": "9zz-IAD",
				traceparent: "garbage",
			},
		});
		const log = await captureWebhookReceivedLog(req);
		expect(log.deliveryId).toBe("trace-delivery-1");
		expect(log.eventName).toBe("workflow_run");
		expect(log.rayId).toBe("9zz-IAD");
		expect("traceId" in log).toBe(false);
		expect("spanId" in log).toBe(false);
	});
});
