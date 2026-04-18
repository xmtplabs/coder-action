import { verify } from "@octokit/webhooks-methods";

// ── Typed errors ─────────────────────────────────────────────────────────────
//
// Each subclass carries the HTTP status + response body the handler should
// surface when catching. This keeps the parser declarative (throws on any
// unacceptable input) and lets the handler pattern-match via `instanceof`.

export class WebhookRequestError extends Error {
	constructor(
		message: string,
		public readonly status: 400 | 401,
		public readonly body: string,
	) {
		super(message);
		this.name = "WebhookRequestError";
	}
}

export class MissingSignatureError extends WebhookRequestError {
	constructor() {
		super("missing signature", 401, "Unauthorized: missing signature");
		this.name = "MissingSignatureError";
	}
}

export class InvalidSignatureError extends WebhookRequestError {
	constructor() {
		super("invalid signature", 401, "Unauthorized: invalid signature");
		this.name = "InvalidSignatureError";
	}
}

export class MissingEventHeaderError extends WebhookRequestError {
	constructor() {
		super(
			"missing X-GitHub-Event header",
			400,
			"Bad Request: missing X-GitHub-Event",
		);
		this.name = "MissingEventHeaderError";
	}
}

export class InvalidJsonError extends WebhookRequestError {
	constructor() {
		super("invalid JSON body", 400, "Bad Request: invalid JSON body");
		this.name = "InvalidJsonError";
	}
}

// ── Parser ───────────────────────────────────────────────────────────────────

export interface ParsedWebhookRequest {
	/** Value of `X-GitHub-Event` — always present on success. */
	eventName: string;
	/** Value of `X-GitHub-Delivery`, or `"unknown"` if absent. */
	deliveryId: string;
	/** Parsed JSON body. Typed as `unknown`; the router applies structural casts. */
	payload: unknown;
	/** Raw body string — kept for downstream logging or signature re-verification. */
	rawBody: string;
}

/**
 * Validate and decode an incoming GitHub webhook request. On success returns
 * the parsed components; on any failure throws a `WebhookRequestError`
 * subclass whose `.status` / `.body` drive the HTTP response.
 *
 * Stages:
 *   1. Read the raw body text.
 *   2. Verify the HMAC-SHA256 signature in `X-Hub-Signature-256` against
 *      `webhookSecret` using `@octokit/webhooks-methods#verify` (timing-safe).
 *   3. Require the `X-GitHub-Event` header.
 *   4. Parse the body as JSON.
 *
 * The stages run in order so a request with no signature fails at stage 2
 * before any JSON parsing (defense against trivial replay-by-content-variation
 * attacks).
 */
export async function parseWebhookRequest(
	request: Request,
	webhookSecret: string,
): Promise<ParsedWebhookRequest> {
	const rawBody = await request.text();

	const signature = request.headers.get("X-Hub-Signature-256");
	if (!signature) throw new MissingSignatureError();

	let signatureValid = false;
	try {
		signatureValid = await verify(webhookSecret, rawBody, signature);
	} catch {
		signatureValid = false;
	}
	if (!signatureValid) throw new InvalidSignatureError();

	const eventName = request.headers.get("X-GitHub-Event");
	if (!eventName) throw new MissingEventHeaderError();

	const deliveryId = request.headers.get("X-GitHub-Delivery") ?? "unknown";

	let payload: unknown;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		throw new InvalidJsonError();
	}

	return { eventName, deliveryId, payload, rawBody };
}
