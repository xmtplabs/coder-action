import { describe, expect, test, beforeEach } from "bun:test";
import { createApp } from "../http/server";
import { WebhookRouter, type SkipResult } from "../webhooks/github/router";
import type {
	Event,
	TaskRequestedEvent,
	CommentPostedEvent,
} from "../events/types";
import { TestLogger } from "../infra/logger";

import issuesAssigned from "./fixtures/issues-assigned.json";
import issueCommentOnIssue from "./fixtures/issue-comment-on-issue.json";
import workflowRunSuccess from "./fixtures/workflow-run-success.json";

// ── Helpers ──────────────────────────────────────────────────────────────────

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
const AGENT_LOGIN = "xmtp-coder-agent";
const BOT_LOGIN = "xmtp-coder-tasks[bot]";

type RouterResult = Event | SkipResult;

function isEvent(r: RouterResult): r is Event {
	return !("dispatched" in r);
}

function isSkip(r: RouterResult): r is SkipResult {
	return "dispatched" in r && r.dispatched === false;
}

// ── Test setup helpers ────────────────────────────────────────────────────────

function buildTestApp(logger: TestLogger): {
	app: ReturnType<typeof createApp>;
	lastResult: () => RouterResult | null;
} {
	const router = new WebhookRouter({
		agentGithubUsername: AGENT_LOGIN,
		appBotLogin: BOT_LOGIN,
		logger,
	});

	let capturedResult: RouterResult | null = null;

	const app = createApp({
		webhookSecret: TEST_SECRET,
		handleWebhook: async (eventName, deliveryId, payload) => {
			capturedResult = await router.handleWebhook(
				eventName,
				deliveryId,
				payload,
			);
			if (isEvent(capturedResult)) {
				return { dispatched: true, handler: capturedResult.type };
			}
			const status = capturedResult.validationError === true ? 400 : 200;
			return { dispatched: false, status };
		},
		logger,
	});

	return { app, lastResult: () => capturedResult };
}

async function postWebhook(
	app: ReturnType<typeof createApp>,
	options: {
		eventName: string;
		body: string;
		signature?: string;
		deliveryId?: string;
	},
): Promise<Response> {
	const { eventName, body, deliveryId = "test-delivery-id" } = options;
	const signature =
		options.signature ?? (await computeSignature(TEST_SECRET, body));

	return app.request("/api/webhooks", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Hub-Signature-256": signature,
			"X-GitHub-Event": eventName,
			"X-GitHub-Delivery": deliveryId,
		},
		body,
	});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("End-to-end integration: webhook → router pipeline", () => {
	let logger: TestLogger;

	beforeEach(() => {
		logger = new TestLogger();
	});

	test("issues.assigned to agent → 200 and dispatches task_requested event", async () => {
		const { app, lastResult } = buildTestApp(logger);
		const body = JSON.stringify(issuesAssigned);

		const res = await postWebhook(app, { eventName: "issues", body });

		expect(res.status).toBe(200);

		const result = lastResult();
		expect(result).not.toBeNull();
		if (result == null) throw new Error("result is null");
		expect(isEvent(result)).toBe(true);
		if (isEvent(result)) {
			const event = result as TaskRequestedEvent;
			expect(event.type).toBe("task_requested");
			expect(event.source.installationId).toBe(118770088);
			expect(event.repository.name).toBe("coder-action");
			expect(event.repository.owner).toBe("xmtplabs");
			expect(event.issue.number).toBe(65);
		}
	});

	test("issue_comment.created from human on issue → 200 and dispatches comment_posted event (kind: issue)", async () => {
		const { app, lastResult } = buildTestApp(logger);
		const body = JSON.stringify(issueCommentOnIssue);

		const res = await postWebhook(app, { eventName: "issue_comment", body });

		expect(res.status).toBe(200);

		const result = lastResult();
		expect(result).not.toBeNull();
		if (result == null) throw new Error("result is null");
		expect(isEvent(result)).toBe(true);
		if (isEvent(result)) {
			const event = result as CommentPostedEvent;
			expect(event.type).toBe("comment_posted");
			expect(event.source.installationId).toBe(118770088);
			expect(event.target.kind).toBe("issue");
			expect(event.target.number).toBe(65);
			expect(event.comment.body).toBe(
				"Can you also handle the edge case for empty inputs?",
			);
			expect(event.repository.name).toBe("coder-action");
			expect(event.repository.owner).toBe("xmtplabs");
		}
	});

	test("issue_comment.edited from human on issue → 200 and dispatches comment_posted event", async () => {
		const { app, lastResult } = buildTestApp(logger);
		const editedPayload = { ...issueCommentOnIssue, action: "edited" };
		const body = JSON.stringify(editedPayload);

		const res = await postWebhook(app, { eventName: "issue_comment", body });

		expect(res.status).toBe(200);

		const result = lastResult();
		expect(result).not.toBeNull();
		if (result == null) throw new Error("result is null");
		expect(isEvent(result)).toBe(true);
		if (isEvent(result)) {
			const event = result as CommentPostedEvent;
			expect(event.type).toBe("comment_posted");
			expect(event.source.installationId).toBe(118770088);
			expect(event.target.number).toBe(65);
		}
	});

	test("workflow_run.completed with success conclusion → 200 and skipped", async () => {
		const { app, lastResult } = buildTestApp(logger);
		const body = JSON.stringify(workflowRunSuccess);

		const res = await postWebhook(app, { eventName: "workflow_run", body });

		expect(res.status).toBe(200);

		const result = lastResult();
		expect(result).not.toBeNull();
		if (result == null) throw new Error("result is null");
		expect(isSkip(result)).toBe(true);
		if (isSkip(result)) {
			expect(result.reason).toContain("success");
		}
	});

	test("invalid signature → 401 and no dispatch", async () => {
		const { app, lastResult } = buildTestApp(logger);
		const body = JSON.stringify(issuesAssigned);

		const res = await postWebhook(app, {
			eventName: "issues",
			body,
			signature: "sha256=invalidsignature000",
		});

		expect(res.status).toBe(401);
		// Router never called — result stays null
		expect(lastResult()).toBeNull();
	});

	test("issue_comment from agent user (self-comment) → 200 and skipped", async () => {
		const { app, lastResult } = buildTestApp(logger);

		// Modify the comment author to be the agent user
		const payload = {
			...issueCommentOnIssue,
			comment: {
				...issueCommentOnIssue.comment,
				user: { login: AGENT_LOGIN },
			},
		};
		const body = JSON.stringify(payload);

		const res = await postWebhook(app, { eventName: "issue_comment", body });

		expect(res.status).toBe(200);

		const result = lastResult();
		expect(result).not.toBeNull();
		if (result == null) throw new Error("result is null");
		expect(isSkip(result)).toBe(true);
		if (isSkip(result)) {
			expect(result.reason).toContain(AGENT_LOGIN);
		}
	});
});
