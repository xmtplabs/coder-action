/**
 * Test helpers for the Cloudflare Workers migration. Shared between unit,
 * integration, and e2e suites so each test doesn't re-implement HMAC signing.
 */

export async function computeSignature(
	secret: string,
	body: string,
): Promise<string> {
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

export interface BuildSignedWebhookRequestOpts {
	secret: string;
	body: string;
	eventName: string;
	deliveryId?: string;
	/** Override the computed signature (e.g. to test the 401 path). */
	signature?: string;
}

/**
 * Build a `Request` object that the Worker `fetch` handler can process as a
 * GitHub webhook delivery. The request is signed with an HMAC-SHA256 over the
 * raw body using `secret` unless `signature` is explicitly overridden.
 */
export async function buildSignedWebhookRequest(
	opts: BuildSignedWebhookRequestOpts,
): Promise<Request> {
	const signature =
		opts.signature ?? (await computeSignature(opts.secret, opts.body));
	return new Request("https://example.com/webhooks/github", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Hub-Signature-256": signature,
			"X-GitHub-Event": opts.eventName,
			"X-GitHub-Delivery": opts.deliveryId ?? "test-delivery",
		},
		body: opts.body,
	});
}
