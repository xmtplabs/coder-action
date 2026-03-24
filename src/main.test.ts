import { describe, expect, test, mock } from "bun:test";
import { createStartupContext } from "./main";
import type { StartupContextOptions } from "./main";

describe("createStartupContext", () => {
	test("calls GET /app to discover bot identity", async () => {
		const mockGetApp: StartupContextOptions["getAppInfo"] = mock(() =>
			Promise.resolve({
				data: { slug: "xmtp-coder-app", id: 12345 },
			}),
		);

		const ctx = await createStartupContext({
			getAppInfo: mockGetApp,
		});

		expect(mockGetApp).toHaveBeenCalledTimes(1);
		expect(ctx.appSlug).toBe("xmtp-coder-app");
		expect(ctx.appBotLogin).toBe("xmtp-coder-app[bot]");
	});

	test("throws if GET /app fails", async () => {
		const mockGetApp: StartupContextOptions["getAppInfo"] = mock(() =>
			Promise.reject(new Error("auth failed")),
		);

		await expect(
			createStartupContext({
				getAppInfo: mockGetApp,
			}),
		).rejects.toThrow("auth failed");
	});
});
