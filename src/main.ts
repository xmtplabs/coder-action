import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "./config";
import { ConsoleLogger } from "./logger";
import { RealCoderClient } from "./coder-client";
import { WebhookRouter } from "./webhook-router";
import { createApp } from "./server";

// ── Startup context ───────────────────────────────────────────────────────────

export interface StartupContextOptions {
	getAppInfo: () => Promise<{ data: { slug: string; id: number } }>;
}

export interface StartupContext {
	appSlug: string;
	appBotLogin: string;
}

/**
 * Discovers the GitHub App identity by calling GET /app.
 * Extracted as a pure, testable function that takes injected dependencies.
 */
export async function createStartupContext(
	options: StartupContextOptions,
): Promise<StartupContext> {
	const { data: app } = await options.getAppInfo();
	return {
		appSlug: app.slug,
		appBotLogin: `${app.slug}[bot]`,
	};
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const logger = new ConsoleLogger();
	const config = loadConfig(process.env);

	// Create app-level Octokit authenticated as the GitHub App via JWT
	const appOctokit = new Octokit({
		authStrategy: createAppAuth,
		auth: { appId: config.appId, privateKey: config.privateKey },
	});

	// Discover bot identity from the GitHub App API
	const { appSlug, appBotLogin } = await createStartupContext({
		getAppInfo: () =>
			appOctokit.rest.apps.getAuthenticated().then((res) => {
				const data = res.data;
				if (!data) throw new Error("GitHub App returned no data");
				return { data: { slug: data.slug ?? "", id: data.id } };
			}),
	});
	logger.info(`Discovered app identity: ${appSlug} (bot: ${appBotLogin})`);

	// Wire up dependencies
	const _coder = new RealCoderClient(config.coderURL, config.coderToken);
	const router = new WebhookRouter({
		agentGithubUsername: config.agentGithubUsername,
		appBotLogin,
		logger,
	});

	// Create Hono app
	const app = createApp({
		webhookSecret: config.webhookSecret,
		handleWebhook: (eventName, deliveryId, payload) =>
			router.handleWebhook(eventName, deliveryId, payload).then(() => {}),
		logger,
	});

	// Start Bun server
	const server = Bun.serve({
		fetch: app.fetch,
		port: config.port,
	});

	logger.info(`XMTP Coder Agent listening on :${server.port}`);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("Fatal:", err);
		process.exit(1);
	});
}
