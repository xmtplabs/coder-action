import { describe, expect, test } from "vitest";
import {
	parseRepoConfigToml,
	resolveRepoConfigSettings,
} from "./repo-config-schema";

describe("parseRepoConfigToml — happy paths", () => {
	test("empty string → empty sparse settings", () => {
		expect(parseRepoConfigToml("")).toEqual({});
	});
	test("whitespace only → empty sparse settings", () => {
		expect(parseRepoConfigToml("   \n\n")).toEqual({});
	});
	test("full valid TOML → sparse object with all declared fields", () => {
		const toml = `
[sandbox]
size = "medium"
docker = true

[[sandbox.volumes]]
path = "/data"
size = "20gb"

[harness]
provider = "claude"

[[scheduled_jobs]]
name = "nightly"
branch = "main"
schedule = "0 0 * * *"
prompt = "Do the thing"
`;
		const parsed = parseRepoConfigToml(toml);
		expect(parsed.sandbox?.size).toBe("medium");
		expect(parsed.sandbox?.docker).toBe(true);
		expect(parsed.sandbox?.volumes?.[0]).toEqual({
			path: "/data",
			size: "20gb",
		});
		expect(parsed.harness?.provider).toBe("claude");
		expect(parsed.scheduled_jobs?.[0]?.name).toBe("nightly");
	});
	test("unknown keys are dropped (write-side loose-parse)", () => {
		const parsed = parseRepoConfigToml(`[future_feature]\nkey = "value"`);
		expect(parsed).toEqual({});
	});
	test("partial fields do not materialize defaults", () => {
		const parsed = parseRepoConfigToml(`[sandbox]\ndocker = true`);
		expect(parsed).toEqual({ sandbox: { docker: true } });
		expect(parsed.sandbox?.size).toBeUndefined();
	});
});

describe("parseRepoConfigToml — failure paths throw NonRetryableError", () => {
	test("invalid TOML syntax", () => {
		expect(() => parseRepoConfigToml("not = toml = bad")).toThrow(
			/Invalid TOML/,
		);
	});
	test("sandbox.size out of enum", () => {
		expect(() => parseRepoConfigToml(`[sandbox]\nsize = "huge"`)).toThrow(
			/Invalid RepoConfig/,
		);
	});
	test("harness.provider out of enum", () => {
		expect(() => parseRepoConfigToml(`[harness]\nprovider = "gemini"`)).toThrow(
			/Invalid RepoConfig/,
		);
	});
	test("sandbox.volumes entry missing path", () => {
		expect(() =>
			parseRepoConfigToml(`[[sandbox.volumes]]\nsize = "10gb"`),
		).toThrow(/Invalid RepoConfig/);
	});
	test("scheduled_jobs entry missing branch", () => {
		expect(() =>
			parseRepoConfigToml(
				`[[scheduled_jobs]]\nname = "x"\nschedule = "0 0 * * *"\nprompt = "y"`,
			),
		).toThrow(/Invalid RepoConfig/);
	});
	test("error messages do not include raw values (secret-leak guard)", () => {
		try {
			parseRepoConfigToml(`[harness]\nprovider = "MY_SECRET_LEAK"`);
		} catch (err) {
			expect((err as Error).message).not.toContain("MY_SECRET_LEAK");
		}
	});
});

describe("resolveRepoConfigSettings — defaults applied on read", () => {
	test("undefined → full defaults", () => {
		const r = resolveRepoConfigSettings(undefined);
		expect(r.sandbox.size).toBe("medium");
		expect(r.sandbox.docker).toBe(false);
		expect(r.sandbox.volumes).toEqual([]);
		expect(r.harness.provider).toBe("claude");
		expect(r.scheduled_jobs).toEqual([]);
	});
	test("empty object → full defaults", () => {
		expect(resolveRepoConfigSettings({})).toEqual({
			sandbox: { size: "medium", docker: false, volumes: [] },
			harness: { provider: "claude" },
			scheduled_jobs: [],
		});
	});
	test("volume with path-only → size defaulted to '10gb'", () => {
		const r = resolveRepoConfigSettings({
			sandbox: { volumes: [{ path: "/data" }] },
		});
		expect(r.sandbox.volumes[0]).toEqual({ path: "/data", size: "10gb" });
	});
	test("partial override: explicit size beats default", () => {
		const r = resolveRepoConfigSettings({
			sandbox: { size: "large" },
		});
		expect(r.sandbox.size).toBe("large");
		expect(r.sandbox.docker).toBe(false);
	});
});
