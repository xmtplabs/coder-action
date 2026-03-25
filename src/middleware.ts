import { createMiddleware } from "hono/factory";
import { verify } from "@octokit/webhooks-methods";
import type { Logger } from "./logger";

export type WebhookEnv = {
	Variables: {
		rawBody: string;
	};
};

/**
 * Hono middleware that verifies the GitHub webhook signature.
 * On success, stores the raw request body in `c.var.rawBody` for downstream handlers.
 */
export function webhookSignatureMiddleware(
	webhookSecret: string,
	logger: Logger,
) {
	return createMiddleware<WebhookEnv>(async (c, next) => {
		const rawBody = await c.req.text();

		const signature = c.req.header("X-Hub-Signature-256");
		if (!signature) {
			logger.info("Webhook rejected: missing signature", {
				event: null,
				delivery_id: null,
				status: 401,
			});
			return c.text("Unauthorized: missing signature", 401);
		}

		let signatureValid: boolean;
		try {
			signatureValid = await verify(webhookSecret, rawBody, signature);
		} catch {
			signatureValid = false;
		}

		if (!signatureValid) {
			logger.info("Webhook rejected: invalid signature", {
				event: null,
				delivery_id: null,
				status: 401,
			});
			return c.text("Unauthorized: invalid signature", 401);
		}

		c.set("rawBody", rawBody);
		await next();
	});
}
