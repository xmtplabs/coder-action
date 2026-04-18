import { beforeEach, describe, expect, test } from "vitest";
import worker, { __setAppBotLoginForTests } from "../main";
import issueCommentOnIssue from "./fixtures/issue-comment-on-issue.json";
import issuesAssigned from "./fixtures/issues-assigned.json";
import workflowRunSuccess from "./fixtures/workflow-run-success.json";
import {
	buildSignedWebhookRequest,
	computeSignature,
} from "./workflow-test-helpers";

// Pre-seed the bot-login cache so tests don't hit `GET /app`.
beforeEach(() => {
	__setAppBotLoginForTests("xmtp-coder-tasks[bot]");
});

// ── Env fixture ──────────────────────────────────────────────────────────────
//
// Minimum env shape the Worker's `handleWebhook` expects. `CODER_TASK_WORKFLOW`
// is stubbed so `.create()` can succeed without a real workflow binding — we
// only assert the HTTP response status in these tests, not workflow behavior.
// (End-to-end coverage with the real binding + `introspectWorkflow` lives in
// `e2e.test.ts`.)

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

interface WorkflowCreateArgs {
	id: string;
	params: unknown;
}

function makeEnv(
	workflowCreate?: (args: WorkflowCreateArgs) => Promise<unknown>,
) {
	return {
		...baseEnv,
		CODER_TASK_WORKFLOW: {
			create:
				workflowCreate ??
				((args: WorkflowCreateArgs) => Promise.resolve({ id: args.id })),
		},
	} as unknown as Parameters<typeof worker.fetch>[1];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Worker fetch handler — HTTP status surface", () => {
	// ── 200 ─────────────────────────────────────────────────────────────────

	test("workflow_run success → 200 and no workflow created (skip)", async () => {
		let created = false;
		const env = makeEnv(() => {
			created = true;
			return Promise.resolve({ id: "x" });
		});
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body: JSON.stringify(workflowRunSuccess),
			eventName: "workflow_run",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		expect(created).toBe(false);
	});

	test("issue_comment from agent user (self-comment) → 200, no workflow", async () => {
		let created = false;
		const env = makeEnv(() => {
			created = true;
			return Promise.resolve({ id: "x" });
		});
		const payload = {
			...issueCommentOnIssue,
			comment: {
				...issueCommentOnIssue.comment,
				user: { login: AGENT_LOGIN },
			},
		};
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body: JSON.stringify(payload),
			eventName: "issue_comment",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		expect(created).toBe(false);
	});

	test("duplicate delivery (instance already exists) → 200", async () => {
		const env = makeEnv(() =>
			Promise.reject(new Error("instance already exists")),
		);
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body: JSON.stringify(issuesAssigned),
			eventName: "issues",
			deliveryId: "dup-1",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
	});

	// ── 202 ─────────────────────────────────────────────────────────────────

	test("valid signed task_requested webhook → 202 and workflow.create called with composite instance id", async () => {
		const createCalls: WorkflowCreateArgs[] = [];
		const env = makeEnv(async (args) => {
			createCalls.push(args);
			return { id: args.id };
		});
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body: JSON.stringify(issuesAssigned),
			eventName: "issues",
			deliveryId: "accept-1",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(202);
		expect(createCalls).toHaveLength(1);
		expect(createCalls[0]?.id).toMatch(/^task_requested-/);
		expect(createCalls[0]?.id).toContain("accept-1");
	});

	// ── 400 ─────────────────────────────────────────────────────────────────

	test("missing X-GitHub-Event header → 400, no workflow created", async () => {
		let created = false;
		const env = makeEnv(() => {
			created = true;
			return Promise.resolve({ id: "x" });
		});
		const body = JSON.stringify(issuesAssigned);
		// Hand-build the request so we can omit the event-name header.
		const signature = await computeSignature(TEST_SECRET, body);
		const req = new Request("https://w/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
				"X-GitHub-Delivery": "no-event-hdr",
			},
			body,
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(400);
		expect(await res.text()).toMatch(/X-GitHub-Event/);
		expect(created).toBe(false);
	});

	test("invalid JSON body with valid signature → 400, no workflow created", async () => {
		let created = false;
		const env = makeEnv(() => {
			created = true;
			return Promise.resolve({ id: "x" });
		});
		const body = "not a json object {";
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body,
			eventName: "issues",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(400);
		expect(await res.text()).toMatch(/invalid JSON/i);
		expect(created).toBe(false);
	});

	// The router's `SkipResult.validationError` flag is declared but never
	// set — router.ts uses structural `as` casts with null-checks rather
	// than schema validation. Payloads that the router can't classify flow
	// to the default "Unhandled event" arm and yield 200. This test pins
	// current behavior so any future router refactor that introduces real
	// Zod validation (and a reachable 400 path) has to explicitly update it.
	// See docs/gotchas.md § "Zod 400-branch is unreachable today."
	test("payload the router can't classify → 200 with SkipResult (400-branch is unreachable today)", async () => {
		let created = false;
		const env = makeEnv(() => {
			created = true;
			return Promise.resolve({ id: "x" });
		});
		const body = JSON.stringify({ not: "a real webhook payload" });
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body,
			eventName: "issues",
			deliveryId: "zod-fail-1",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		expect(created).toBe(false);
	});

	// ── 401 ─────────────────────────────────────────────────────────────────

	test("missing signature → 401, no workflow created", async () => {
		let created = false;
		const env = makeEnv(() => {
			created = true;
			return Promise.resolve({ id: "x" });
		});
		const body = JSON.stringify(issuesAssigned);
		const req = new Request("https://w/api/webhooks", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-GitHub-Event": "issues",
				"X-GitHub-Delivery": "d1",
			},
			body,
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(401);
		expect(await res.text()).toMatch(/missing signature/);
		expect(created).toBe(false);
	});

	test("invalid signature → 401, no workflow created", async () => {
		let created = false;
		const env = makeEnv(() => {
			created = true;
			return Promise.resolve({ id: "x" });
		});
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body: JSON.stringify(issuesAssigned),
			eventName: "issues",
			signature: "sha256=deadbeef",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(401);
		expect(await res.text()).toMatch(/invalid signature/);
		expect(created).toBe(false);
	});

	// ── 404 ─────────────────────────────────────────────────────────────────

	test("unknown path → 404", async () => {
		const res = await worker.fetch(
			new Request("https://w/not-a-route", { method: "GET" }),
			makeEnv(),
			{} as ExecutionContext,
		);
		expect(res.status).toBe(404);
	});

	test("GET /api/webhooks → 404 (only POST is a route)", async () => {
		const res = await worker.fetch(
			new Request("https://w/api/webhooks", { method: "GET" }),
			makeEnv(),
			{} as ExecutionContext,
		);
		expect(res.status).toBe(404);
	});

	// ── 500 ─────────────────────────────────────────────────────────────────

	test("workflow.create throws non-duplicate error → 500", async () => {
		const env = makeEnv(() =>
			Promise.reject(new Error("Cloudflare: internal service error")),
		);
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body: JSON.stringify(issuesAssigned),
			eventName: "issues",
			deliveryId: "err-1",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(500);
	});
});
