import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "./config/app-config";
import { createLogger } from "./infra/logger";
import { RealCoderClient } from "./coder-client";
import { WebhookRouter } from "./webhook-router";
import { HandlerDispatcher } from "./handler-dispatcher";
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
	const config = loadConfig(process.env);
	const logger = createLogger({ logFormat: config.logFormat });

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
	const coder = new RealCoderClient(config.coderURL, config.coderToken);
	const router = new WebhookRouter({
		agentGithubUsername: config.agentGithubUsername,
		appBotLogin,
		logger,
	});

	// Factory that creates (and caches) an installation-scoped Octokit per installationId.
	// Reusing the same Octokit instance allows @octokit/auth-app to cache the
	// short-lived installation access token internally, avoiding redundant token requests.
	const octokitCache = new Map<number, Octokit>();
	const createInstallationOctokit = (installationId: number): Octokit => {
		let octokit = octokitCache.get(installationId);
		if (!octokit) {
			octokit = new Octokit({
				authStrategy: createAppAuth,
				auth: {
					appId: config.appId,
					privateKey: config.privateKey,
					installationId,
				},
			});
			octokitCache.set(installationId, octokit);
		}
		return octokit;
	};

	const dispatcher = new HandlerDispatcher({
		config,
		createInstallationOctokit,
		coderClient: coder,
		logger,
	});

	// Create Hono app
	const app = createApp({
		webhookSecret: config.webhookSecret,
		handleWebhook: async (eventName, deliveryId, payload, reqLogger) => {
			const result = await router.handleWebhook(eventName, deliveryId, payload);
			if (result.dispatched) {
				await dispatcher.dispatch(result, reqLogger);
				return { dispatched: true, handler: result.handler };
			}
			// If the failure was due to a Zod schema validation error, signal 400.
			const status = result.validationError === true ? 400 : 200;
			return { dispatched: false, status };
		},
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
