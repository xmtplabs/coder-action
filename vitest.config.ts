import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Test-only secrets and vars.
//
// `wrangler.toml` declares `[vars]` but not secrets — in production the latter
// come from `wrangler secret put` / `.dev.vars`. For workerd-based tests we
// inject equivalents here via `miniflare.bindings`, which takes precedence over
// Wrangler config.
//
// Values are deliberately fake and non-functional: `introspectWorkflowInstance`
// mocks every `step.do` result, so no real GitHub / Coder API calls fire and
// neither key is ever parsed by `@octokit/auth-app` (which defers key parsing
// until the first API call).
const TEST_BINDINGS = {
	APP_ID: "123456",
	PRIVATE_KEY:
		"-----BEGIN RSA PRIVATE KEY-----\nMIIBOwIBAAJBAJ/test/fake\n-----END RSA PRIVATE KEY-----",
	WEBHOOK_SECRET: "test-webhook-secret",
	CODER_TOKEN: "test-coder-token",
	// CODER_TEMPLATE_PRESET intentionally omitted — the Zod schema treats an
	// absent key as `undefined` (optional), but rejects an empty string via
	// `.min(1)`. Missing is the correct "no preset" signal.
};

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.toml" },
			miniflare: {
				bindings: TEST_BINDINGS,
				// Pre-declare the compatibility flags that `@cloudflare/vitest-pool-workers`
				// would otherwise auto-add at runtime, each emitting a `[vpw:debug]` line.
				// `nodejs_compat` is included because this list overrides (not merges with)
				// `wrangler.toml`'s `compatibility_flags`.
				compatibilityFlags: [
					"nodejs_compat",
					"enable_nodejs_tty_module",
					"enable_nodejs_fs_module",
					"enable_nodejs_http_modules",
					"enable_nodejs_perf_hooks_module",
					"enable_nodejs_v8_module",
					"enable_nodejs_process_v2",
				],
			},
		}),
	],
});
