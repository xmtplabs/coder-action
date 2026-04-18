import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { AppConfig } from "../config/app-config";

// ── Module-scope cache ───────────────────────────────────────────────────────
//
// Workers reuse isolates across requests. This cache is safe because the bot
// login is account-wide (never request-specific). Across isolate evictions the
// first request on a fresh isolate re-fetches via `GET /app`.

let appBotLoginCache: string | undefined;

/**
 * Test-only helper: pre-seed the cache so integration tests don't hit GitHub.
 * Pass `undefined` to clear the cache between tests if needed.
 */
export function __setAppBotLoginForTests(login: string | undefined): void {
	appBotLoginCache = login;
}

/**
 * Resolve the GitHub App bot login (`<app-slug>[bot]`), lazily fetching once
 * per isolate via `GET /app`.
 *
 * The app-bot login is distinct from `AGENT_GITHUB_USERNAME`: that env var
 * configures the human-user identity the agent posts as, while this function
 * returns the GitHub App installation's bot identity. Both are filtered by
 * `isIgnoredLogin` in the webhook router's self-comment suppression.
 */
export async function resolveAppBotLogin(config: AppConfig): Promise<string> {
	if (appBotLoginCache) return appBotLoginCache;
	const appOctokit = new Octokit({
		authStrategy: createAppAuth,
		auth: { appId: config.appId, privateKey: config.privateKey },
	});
	const res = await appOctokit.rest.apps.getAuthenticated();
	const slug = res.data?.slug ?? "unknown";
	appBotLoginCache = `${slug}[bot]`;
	return appBotLoginCache;
}
