import { Hono } from "hono";
import { verify } from "@octokit/webhooks-methods";
import type { Logger } from "./logger";

export interface CreateAppOptions {
  webhookSecret: string;
  handleWebhook: (eventName: string, deliveryId: string, payload: unknown) => Promise<void>;
  logger: Logger;
}

export function createApp(options: CreateAppOptions): Hono {
  const { webhookSecret, handleWebhook, logger } = options;
  const app = new Hono();

  app.get("/healthz", (c) => {
    return c.text("ok", 200);
  });

  app.post("/api/webhooks", async (c) => {
    const rawBody = await c.req.text();

    const signature = c.req.header("X-Hub-Signature-256");
    if (!signature) {
      logger.info(
        JSON.stringify({ event: null, delivery_id: null, status: 401, reason: "missing signature" }),
      );
      return c.text("Unauthorized: missing signature", 401);
    }

    let signatureValid: boolean;
    try {
      signatureValid = await verify(webhookSecret, rawBody, signature);
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      logger.info(
        JSON.stringify({ event: null, delivery_id: null, status: 401, reason: "invalid signature" }),
      );
      return c.text("Unauthorized: invalid signature", 401);
    }

    const eventName = c.req.header("X-GitHub-Event");
    if (!eventName) {
      logger.info(
        JSON.stringify({ event: null, delivery_id: null, status: 400, reason: "missing X-GitHub-Event" }),
      );
      return c.text("Bad Request: missing X-GitHub-Event header", 400);
    }

    const deliveryId = c.req.header("X-GitHub-Delivery") ?? "unknown";

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logger.info(
        JSON.stringify({ event: eventName, delivery_id: deliveryId, status: 400, reason: "invalid JSON" }),
      );
      return c.text("Bad Request: invalid JSON body", 400);
    }

    try {
      await handleWebhook(eventName, deliveryId, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        JSON.stringify({ event: eventName, delivery_id: deliveryId, status: 500, error: message }),
      );
      return c.text("Internal Server Error", 500);
    }

    logger.info(
      JSON.stringify({ event: eventName, delivery_id: deliveryId, status: 200 }),
    );
    return c.text("ok", 200);
  });

  return app;
}
