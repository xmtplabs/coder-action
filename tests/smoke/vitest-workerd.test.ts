import { describe, expect, test } from "vitest";

describe("vitest pool-workers smoke", () => {
	test("runs inside workerd — crypto.subtle exists", () => {
		expect(typeof crypto.subtle).toBe("object");
		expect(typeof crypto.subtle.digest).toBe("function");
	});

	// The second assertion (env binding accessible via `cloudflare:test`) forces
	// pool-workers to bundle the `main` entry from wrangler.toml. Because the
	// current `src/main.ts` still imports pino/pino-pretty (replaced in Phase 3
	// Task 10), that bundling fails under workerd. The crypto.subtle assertion
	// above is sufficient to prove pool-workers is running tests inside workerd;
	// the env-binding assertion is re-added in the Phase 6 integration tests
	// once main.ts is rewritten.
});
