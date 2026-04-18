import { beforeEach, describe, expect, test } from "vitest";
import worker, { __setAppBotLoginForTests } from "../main";
import issuesAssigned from "./fixtures/issues-assigned.json";
import issueCommentOnIssue from "./fixtures/issue-comment-on-issue.json";
import workflowRunSuccess from "./fixtures/workflow-run-success.json";
import { buildSignedWebhookRequest } from "./workflow-test-helpers";

// Pre-seed the bot-login cache so tests don't hit `GET /app`.
beforeEach(() => {
	__setAppBotLoginForTests("xmtp-coder-tasks[bot]");
});

// ── Env fixture ──────────────────────────────────────────────────────────────
//
// Minimum env shape the Worker's `handleWebhook` expects. `CODER_TASK_WORKFLOW`
// is stubbed so `.create()` can succeed without a real workflow binding — we
// only assert the HTTP response status in these tests, not workflow behavior.

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

function makeEnv(workflowCreate?: (args: unknown) => Promise<unknown>) {
	return {
		...baseEnv,
		CODER_TASK_WORKFLOW: {
			create:
				workflowCreate ?? ((_args: unknown) => Promise.resolve({ id: "stub" })),
		},
	} as unknown as Parameters<typeof worker.fetch>[1];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Worker fetch handler (integration)", () => {
	test("GET /healthz → 200 'ok'", async () => {
		const res = await worker.fetch(
			new Request("https://w/healthz", { method: "GET" }),
			makeEnv(),
			{} as ExecutionContext,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

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
		expect(created).toBe(false);
	});

	test("invalid signature → 401, no workflow created", async () => {
		let created = false;
		const env = makeEnv(() => {
			created = true;
			return Promise.resolve({ id: "x" });
		});
		const body = JSON.stringify(issuesAssigned);
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body,
			eventName: "issues",
			signature: "sha256=deadbeef",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(401);
		expect(created).toBe(false);
	});

	test("workflow_run success → 200 and no workflow created (skip)", async () => {
		let created = false;
		const env = makeEnv(() => {
			created = true;
			return Promise.resolve({ id: "x" });
		});
		const body = JSON.stringify(workflowRunSuccess);
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body,
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
		const body = JSON.stringify(payload);
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body,
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
		const body = JSON.stringify(issuesAssigned);
		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body,
			eventName: "issues",
			deliveryId: "dup-1",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
	});
});
