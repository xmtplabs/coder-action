import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "./logger";
import { type WebhookEnv, webhookSignatureMiddleware } from "./middleware";

export interface WebhookHandleResult {
	dispatched: boolean;
	handler?: string;
	/** Optional HTTP status override. Defaults to 200 when not provided. */
	status?: number;
}

export interface CreateAppOptions {
	webhookSecret: string;
	handleWebhook: (
		eventName: string,
		deliveryId: string,
		payload: unknown,
		logger: Logger,
	) => Promise<WebhookHandleResult>;
	logger: Logger;
}

/**
 * Safely extracts a string field from an unknown payload object.
 * Returns null if the field is missing or not a string.
 */
function safeStringField(payload: unknown, ...path: string[]): string | null {
	let current: unknown = payload;
	for (const key of path) {
		if (typeof current !== "object" || current === null) return null;
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === "string" ? current : null;
}

export function createApp(options: CreateAppOptions): Hono<WebhookEnv> {
	const { webhookSecret, handleWebhook, logger } = options;
	const app = new Hono<WebhookEnv>();

	app.get("/healthz", (c) => {
		return c.text("ok", 200);
	});

	app.post(
		"/api/webhooks",
		webhookSignatureMiddleware(webhookSecret, logger),
		async (c) => {
			const startTime = Date.now();
			const rawBody = c.get("rawBody");

			const eventName = c.req.header("X-GitHub-Event");
			if (!eventName) {
				logger.info("Webhook rejected: missing X-GitHub-Event", {
					event: null,
					delivery_id: null,
					status: 400,
				});
				return c.text("Bad Request: missing X-GitHub-Event header", 400);
			}

			const deliveryId = c.req.header("X-GitHub-Delivery") ?? "unknown";

			let payload: unknown;
			try {
				payload = JSON.parse(rawBody);
			} catch {
				logger.error("Webhook rejected: invalid JSON body", {
					event: eventName,
					delivery_id: deliveryId,
					status: 400,
				});
				return c.text("Bad Request: invalid JSON body", 400);
			}

			// Create per-request child logger with request context
			const payloadAction = safeStringField(payload, "action");
			const qualifiedEvent = payloadAction
				? `${eventName}.${payloadAction}`
				: eventName;
			const reqLogger = logger.child({
				deliveryId,
				eventName: qualifiedEvent,
			});

			reqLogger.info("Webhook received");

			// Extract repository for structured logging
			const payloadRepo = safeStringField(payload, "repository", "full_name");

			let handleResult: WebhookHandleResult;
			try {
				handleResult = await handleWebhook(
					eventName,
					deliveryId,
					payload,
					reqLogger,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				reqLogger.error(`Webhook handler error: ${message}`, {
					action: payloadAction,
					repository: payloadRepo,
					status: 500,
					error: message,
					duration_ms: Date.now() - startTime,
				});
				return c.text("Internal Server Error", 500);
			}

			const responseStatus = (handleResult.status ??
				200) as ContentfulStatusCode;
			reqLogger.info("Webhook processed", {
				action: payloadAction,
				repository: payloadRepo,
				handler: handleResult.handler ?? null,
				dispatched: handleResult.dispatched,
				status: responseStatus,
				duration_ms: Date.now() - startTime,
			});
			return c.text("ok", responseStatus);
		},
	);

	return app;
}
