import { loadConfig } from "./config/app-config";
import {
	__setAppBotLoginForTests,
	resolveAppBotLogin,
} from "./http/app-bot-login";
import {
	parseWebhookRequest,
	WebhookRequestError,
} from "./http/parse-webhook-request";
import { createLogger, parseTraceparent } from "./utils/logger";
import { WebhookRouter } from "./webhooks/github/router";
import type { TaskRunnerWorkflowEnv } from "./workflows/task-runner-workflow";
import {
	buildInstanceId,
	isDuplicateInstanceError,
} from "./workflows/instance-id";

export { TaskRunnerWorkflow } from "./workflows/task-runner-workflow";
export { __setAppBotLoginForTests };

// ── Worker entrypoint ────────────────────────────────────────────────────────

export default {
	async fetch(
		request: Request,
		env: TaskRunnerWorkflowEnv,
		_ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "POST" && url.pathname === "/webhooks/github") {
			return handleGithubWebhook(request, env);
		}

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<TaskRunnerWorkflowEnv>;

async function handleGithubWebhook(
	request: Request,
	env: TaskRunnerWorkflowEnv,
): Promise<Response> {
	const config = loadConfig(
		env as unknown as Record<string, string | undefined>,
	);
	const logger = createLogger({ logFormat: env.LOG_FORMAT });
	const started = Date.now();

	// Stage 1: verify signature + decode headers + parse JSON.
	let parsed: Awaited<ReturnType<typeof parseWebhookRequest>>;
	try {
		parsed = await parseWebhookRequest(request, config.webhookSecret);
	} catch (err) {
		if (err instanceof WebhookRequestError) {
			logger.info(`Webhook rejected: ${err.message}`, { status: err.status });
			return new Response(err.body, { status: err.status });
		}
		throw err;
	}

	const { eventName, deliveryId, payload } = parsed;
	const rayId = request.headers.get("cf-ray");
	const trace = parseTraceparent(request.headers.get("traceparent"));
	const reqLogger = logger.child({
		deliveryId,
		eventName,
		...(rayId ? { rayId } : {}),
		...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
	});
	reqLogger.info("Webhook received");

	// Stage 2: route via WebhookRouter.
	const appBotLogin = await resolveAppBotLogin(config);
	const router = new WebhookRouter({
		agentGithubUsername: config.agentGithubUsername,
		appBotLogin,
		logger: reqLogger,
	});
	const result = await router.handleGithubWebhook(
		eventName,
		deliveryId,
		payload,
	);
	if ("dispatched" in result) {
		const status = result.validationError === true ? 400 : 200;
		reqLogger.info("Webhook skipped", {
			status,
			reason: result.reason,
			duration_ms: Date.now() - started,
		});
		return new Response("ok", { status });
	}

	// Stage 3: dispatch to Workflow (fire-and-return-202).
	const instanceId = buildInstanceId(result, deliveryId);
	try {
		await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params: result });
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
			error: err instanceof Error ? err.message : "unknown error",
			status: 500,
		});
		return new Response("Internal Server Error", { status: 500 });
	}
}
