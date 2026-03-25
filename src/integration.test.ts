import { describe, expect, test, beforeEach } from "bun:test";
import { createApp } from "./server";
import {
	WebhookRouter,
	type RouteResult,
	type CreateTaskContext,
	type IssueCommentContext,
} from "./webhook-router";
import { TestLogger } from "./logger";

import issuesAssigned from "./__fixtures__/issues-assigned.json";
import issueCommentOnIssue from "./__fixtures__/issue-comment-on-issue.json";
import workflowRunSuccess from "./__fixtures__/workflow-run-success.json";

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

// ── Test setup helpers ────────────────────────────────────────────────────────

function buildTestApp(logger: TestLogger): {
	app: ReturnType<typeof createApp>;
	lastResult: () => RouteResult | null;
} {
	const router = new WebhookRouter({
		agentGithubUsername: AGENT_LOGIN,
		appBotLogin: BOT_LOGIN,
		logger,
	});

	let capturedResult: RouteResult | null = null;

	const app = createApp({
		webhookSecret: TEST_SECRET,
		handleWebhook: async (eventName, deliveryId, payload) => {
			capturedResult = await router.handleWebhook(
				eventName,
				deliveryId,
				payload,
			);
			if (capturedResult.dispatched) {
				return { dispatched: true, handler: capturedResult.handler };
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

	test("issues.assigned to agent → 200 and dispatches create_task", async () => {
		const { app, lastResult } = buildTestApp(logger);
		const body = JSON.stringify(issuesAssigned);

		const res = await postWebhook(app, { eventName: "issues", body });

		expect(res.status).toBe(200);

		const result = lastResult();
		expect(result).not.toBeNull();
		expect(result?.dispatched).toBe(true);
		if (result?.dispatched) {
			expect(result.handler).toBe("create_task");
			expect(result.installationId).toBe(118770088);
			const ctx = result.context as CreateTaskContext;
			expect(ctx.issueNumber).toBe(65);
			expect(ctx.repoName).toBe("coder-action");
			expect(ctx.repoOwner).toBe("xmtplabs");
		}
	});

	test("issue_comment.created from human on issue → 200 and dispatches issue_comment", async () => {
		const { app, lastResult } = buildTestApp(logger);
		const body = JSON.stringify(issueCommentOnIssue);

		const res = await postWebhook(app, { eventName: "issue_comment", body });

		expect(res.status).toBe(200);

		const result = lastResult();
		expect(result).not.toBeNull();
		expect(result?.dispatched).toBe(true);
		if (result?.dispatched) {
			expect(result.handler).toBe("issue_comment");
			expect(result.installationId).toBe(118770088);
			const ctx = result.context as IssueCommentContext;
			expect(ctx.issueNumber).toBe(65);
			expect(ctx.commentBody).toBe(
				"Can you also handle the edge case for empty inputs?",
			);
			expect(ctx.repoName).toBe("coder-action");
			expect(ctx.repoOwner).toBe("xmtplabs");
		}
	});

	test("issue_comment.edited from human on issue → 200 and dispatches issue_comment", async () => {
		const { app, lastResult } = buildTestApp(logger);
		const editedPayload = { ...issueCommentOnIssue, action: "edited" };
		const body = JSON.stringify(editedPayload);

		const res = await postWebhook(app, { eventName: "issue_comment", body });

		expect(res.status).toBe(200);

		const result = lastResult();
		expect(result).not.toBeNull();
		expect(result?.dispatched).toBe(true);
		if (result?.dispatched) {
			expect(result.handler).toBe("issue_comment");
			expect(result.installationId).toBe(118770088);
			expect((result.context as IssueCommentContext).issueNumber).toBe(65);
		}
	});

	test("workflow_run.completed with success conclusion → 200 and skipped", async () => {
		const { app, lastResult } = buildTestApp(logger);
		const body = JSON.stringify(workflowRunSuccess);

		const res = await postWebhook(app, { eventName: "workflow_run", body });

		expect(res.status).toBe(200);

		const result = lastResult();
		expect(result).not.toBeNull();
		expect(result?.dispatched).toBe(false);
		if (!result?.dispatched) {
			expect(result?.reason).toContain("success");
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
		expect(result?.dispatched).toBe(false);
		if (!result?.dispatched) {
			expect(result?.reason).toContain(AGENT_LOGIN);
		}
	});
});
