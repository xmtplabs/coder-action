import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { verify } from "@octokit/webhooks-methods";
import { loadConfig } from "./config/app-config";
import { createLogger } from "./infra/logger";
import { WebhookRouter } from "./webhooks/github/router";
import {
	buildInstanceId,
	isDuplicateInstanceError,
} from "./workflows/instance-id";
import type { CoderTaskWorkflowEnv } from "./workflows/coder-task-workflow";

export { CoderTaskWorkflow } from "./workflows/coder-task-workflow";

// ── Module-scope caches (shared across requests on the same isolate) ─────────
//
// Workers reuse isolates. These caches are safe because:
//  1. The app-bot login is account-wide (no request-specific data).
//  2. `@octokit/auth-app` manages installation-token refresh internally.
//  3. No mutable state tied to the request/response lifecycle lives here.

let appBotLoginCache: string | undefined;

/**
 * Test-only helper: pre-seed the app-bot login cache to avoid a live call to
 * GitHub's `GET /app` endpoint in integration tests.
 */
export function __setAppBotLoginForTests(login: string | undefined): void {
	appBotLoginCache = login;
}

async function resolveAppBotLogin(
	env: CoderTaskWorkflowEnv,
	config: ReturnType<typeof loadConfig>,
): Promise<string> {
	if (appBotLoginCache) return appBotLoginCache;
	// Allow env override (used by tests and also a useful escape hatch for
	// installations with a non-standard bot login).
	if (env.AGENT_GITHUB_USERNAME) {
		// The env var configures the human-user identity that the agent posts as,
		// NOT the bot login — don't conflate. Fall through to the API call.
	}
	const appOctokit = new Octokit({
		authStrategy: createAppAuth,
		auth: { appId: config.appId, privateKey: config.privateKey },
	});
	const res = await appOctokit.rest.apps.getAuthenticated();
	const slug = res.data?.slug ?? "unknown";
	appBotLoginCache = `${slug}[bot]`;
	return appBotLoginCache;
}

// ── Worker entrypoint ────────────────────────────────────────────────────────

export default {
	async fetch(
		request: Request,
		env: CoderTaskWorkflowEnv,
		_ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/healthz") {
			return new Response("ok", { status: 200 });
		}

		if (request.method === "POST" && url.pathname === "/api/webhooks") {
			return handleWebhook(request, env);
		}

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<CoderTaskWorkflowEnv>;

async function handleWebhook(
	request: Request,
	env: CoderTaskWorkflowEnv,
): Promise<Response> {
	const config = loadConfig(
		env as unknown as Record<string, string | undefined>,
	);
	const logger = createLogger({ logFormat: env.LOG_FORMAT });
	const started = Date.now();

	const rawBody = await request.text();

	const signature = request.headers.get("X-Hub-Signature-256");
	if (!signature) {
		logger.info("Webhook rejected: missing signature", { status: 401 });
		return new Response("Unauthorized: missing signature", { status: 401 });
	}

	let signatureValid = false;
	try {
		signatureValid = await verify(config.webhookSecret, rawBody, signature);
	} catch {
		signatureValid = false;
	}
	if (!signatureValid) {
		logger.info("Webhook rejected: invalid signature", { status: 401 });
		return new Response("Unauthorized: invalid signature", { status: 401 });
	}

	const eventName = request.headers.get("X-GitHub-Event");
	if (!eventName) {
		return new Response("Bad Request: missing X-GitHub-Event", { status: 400 });
	}
	const deliveryId = request.headers.get("X-GitHub-Delivery") ?? "unknown";

	let payload: unknown;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return new Response("Bad Request: invalid JSON body", { status: 400 });
	}

	const reqLogger = logger.child({ deliveryId, eventName });
	reqLogger.info("Webhook received");

	const appBotLogin = await resolveAppBotLogin(env, config);
	const router = new WebhookRouter({
		agentGithubUsername: config.agentGithubUsername,
		appBotLogin,
		logger: reqLogger,
	});

	const result = await router.handleWebhook(eventName, deliveryId, payload);
	if ("dispatched" in result) {
		const status = result.validationError === true ? 400 : 200;
		reqLogger.info("Webhook skipped", {
			status,
			reason: result.reason,
			duration_ms: Date.now() - started,
		});
		return new Response("ok", { status });
	}

	const instanceId = buildInstanceId(result, deliveryId);
	try {
		await env.CODER_TASK_WORKFLOW.create({ id: instanceId, params: result });
		reqLogger.info("Webhook processed", {
			handler: result.type,
			instanceId,
			status: 202,
			duration_ms: Date.now() - started,
		});
		return new Response("accepted", { status: 202 });
	} catch (err) {
		if (isDuplicateInstanceError(err)) {
			reqLogger.info("Webhook duplicate (instance exists)", {
				handler: result.type,
				instanceId,
				status: 200,
			});
			return new Response("ok", { status: 200 });
		}
		reqLogger.error("Webhook workflow.create failed", {
			error: String(err),
			status: 500,
		});
		return new Response("Internal Server Error", { status: 500 });
	}
}
