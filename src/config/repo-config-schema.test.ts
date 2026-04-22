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
provider = "claude_code"

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
			size: "20Gi",
		});
		expect(parsed.harness?.provider).toBe("claude_code");
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
		expect(r.harness.provider).toBe("claude_code");
		expect(r.scheduled_jobs).toEqual([]);
	});
	test("empty object → full defaults", () => {
		expect(resolveRepoConfigSettings({})).toEqual({
			sandbox: { size: "medium", docker: false, volumes: [] },
			harness: { provider: "claude_code" },
			scheduled_jobs: [],
			on_event: { failed_run: [] },
		});
	});
	test("volume with path-only → size defaulted to '10Gi'", () => {
		const r = resolveRepoConfigSettings({
			sandbox: { volumes: [{ path: "/data" }] },
		});
		expect(r.sandbox.volumes[0]).toEqual({ path: "/data", size: "10Gi" });
	});
	test("partial override: explicit size beats default", () => {
		const r = resolveRepoConfigSettings({
			sandbox: { size: "large" },
		});
		expect(r.sandbox.size).toBe("large");
		expect(r.sandbox.docker).toBe(false);
	});
});

describe("resolveRepoConfigSettings — on_event defaults", () => {
	test("undefined → on_event.failed_run defaults to []", () => {
		const r = resolveRepoConfigSettings(undefined);
		expect(r.on_event.failed_run).toEqual([]);
	});

	test("empty object → on_event.failed_run defaults to []", () => {
		const r = resolveRepoConfigSettings({});
		expect(r.on_event.failed_run).toEqual([]);
	});

	test("sparse on_event with no failed_run → failed_run defaults to []", () => {
		const r = resolveRepoConfigSettings({ on_event: {} });
		expect(r.on_event.failed_run).toEqual([]);
	});

	test("entries passthrough", () => {
		const r = resolveRepoConfigSettings({
			on_event: {
				failed_run: [
					{
						workflows: ["CI"],
						branches: ["main"],
						prompt_additions: "fix it",
					},
				],
			},
		});
		expect(r.on_event.failed_run).toEqual([
			{ workflows: ["CI"], branches: ["main"], prompt_additions: "fix it" },
		]);
	});
});

describe("parseRepoConfigToml — on_event.failed_run", () => {
	test("full entry with all fields → parses", () => {
		const toml = `
[[on_event.failed_run]]
workflows = ["CI"]
branches = ["main"]
prompt_additions = "There was a failed run. Fix it"
`;
		const parsed = parseRepoConfigToml(toml);
		expect(parsed.on_event?.failed_run?.[0]).toEqual({
			workflows: ["CI"],
			branches: ["main"],
			prompt_additions: "There was a failed run. Fix it",
		});
	});

	test("entry without prompt_additions → parses", () => {
		const toml = `
[[on_event.failed_run]]
workflows = ["CI"]
branches = ["main"]
`;
		const parsed = parseRepoConfigToml(toml);
		expect(parsed.on_event?.failed_run?.[0]).toEqual({
			workflows: ["CI"],
			branches: ["main"],
		});
	});

	test("multiple entries → preserved in order with full shape", () => {
		const toml = `
[[on_event.failed_run]]
workflows = ["CI"]
branches = ["main"]

[[on_event.failed_run]]
workflows = ["Deploy"]
branches = ["release"]
`;
		const parsed = parseRepoConfigToml(toml);
		expect(parsed.on_event?.failed_run).toEqual([
			{ workflows: ["CI"], branches: ["main"] },
			{ workflows: ["Deploy"], branches: ["release"] },
		]);
	});

	test("unknown keys inside entry are dropped", () => {
		const toml = `
[[on_event.failed_run]]
workflows = ["CI"]
branches = ["main"]
future_field = "ignored"
`;
		const parsed = parseRepoConfigToml(toml);
		expect(parsed.on_event?.failed_run?.[0]).toEqual({
			workflows: ["CI"],
			branches: ["main"],
		});
	});

	test("missing workflows → NonRetryableError", () => {
		expect(() =>
			parseRepoConfigToml(`[[on_event.failed_run]]\nbranches = ["main"]`),
		).toThrow(/Invalid RepoConfig/);
	});

	test("empty workflows array → NonRetryableError", () => {
		expect(() =>
			parseRepoConfigToml(
				`[[on_event.failed_run]]\nworkflows = []\nbranches = ["main"]`,
			),
		).toThrow(/Invalid RepoConfig/);
	});

	test("missing branches → NonRetryableError", () => {
		expect(() =>
			parseRepoConfigToml(`[[on_event.failed_run]]\nworkflows = ["CI"]`),
		).toThrow(/Invalid RepoConfig/);
	});

	test("empty branches array → NonRetryableError", () => {
		expect(() =>
			parseRepoConfigToml(
				`[[on_event.failed_run]]\nworkflows = ["CI"]\nbranches = []`,
			),
		).toThrow(/Invalid RepoConfig/);
	});

	test("error message does not leak raw branch values on type mismatch", () => {
		// Use branches = "not-an-array-SECRET" (type mismatch) so that the raw
		// string itself becomes issue.input for the failing Zod issue. If the
		// error builder ever started interpolating issue.input, the secret would
		// surface in the message.
		expect.assertions(2);
		try {
			parseRepoConfigToml(
				`[[on_event.failed_run]]\nworkflows = ["CI"]\nbranches = "SECRET_BRANCH_VALUE"`,
			);
		} catch (err) {
			expect((err as Error).message).not.toContain("SECRET_BRANCH_VALUE");
			expect((err as Error).message).toMatch(/Invalid RepoConfig/);
		}
	});
});

describe("volume size normalization → canonical Kubernetes binary-SI form", () => {
	test.each([
		["10gb", "10Gi"],
		["10GB", "10Gi"],
		["10Gb", "10Gi"],
		["10G", "10Gi"],
		["10g", "10Gi"],
		["10gi", "10Gi"],
		["10Gi", "10Gi"],
		["500mb", "500Mi"],
		["500M", "500Mi"],
		["500Mi", "500Mi"],
		["2tb", "2Ti"],
		["64k", "64Ki"],
		["  20 GB  ", "20Gi"],
	])("parseRepoConfigToml normalizes %s → %s on write", (input, expected) => {
		const parsed = parseRepoConfigToml(
			`[[sandbox.volumes]]\npath = "/data"\nsize = "${input}"`,
		);
		expect(parsed.sandbox?.volumes?.[0]?.size).toBe(expected);
	});

	test("resolveRepoConfigSettings normalizes legacy stored values on read", () => {
		// Simulate a stored record written before the normalization transform
		// existed — the resolved schema must re-normalize on read.
		const r = resolveRepoConfigSettings({
			sandbox: { volumes: [{ path: "/data", size: "20gb" }] },
		});
		expect(r.sandbox.volumes[0]).toEqual({ path: "/data", size: "20Gi" });
	});

	test.each([
		"10",
		"gb",
		"10bb",
		"10.5gb",
		"10eb",
		"abc",
	])("invalid volume size %s → parse rejects", (input) => {
		expect(() =>
			parseRepoConfigToml(
				`[[sandbox.volumes]]\npath = "/data"\nsize = "${input}"`,
			),
		).toThrow(/Invalid RepoConfig/);
	});
});
