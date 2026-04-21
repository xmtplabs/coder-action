import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import type { StoredRepoConfig } from "../config/repo-config-schema";
import { RepoConfigDO } from "./repo-config-do";

const FULL_NAME = "acme/repo";

function makeStub() {
	const id = env.REPO_CONFIG_DO.idFromName(FULL_NAME);
	return env.REPO_CONFIG_DO.get(id);
}

describe("RepoConfigDO — binding smoke", () => {
	test("class is exported and name matches wrangler.toml class_name", () => {
		expect(RepoConfigDO.name).toBe("RepoConfigDO");
	});
	test("env.REPO_CONFIG_DO is callable", () => {
		expect(env.REPO_CONFIG_DO).toBeDefined();
		expect(typeof env.REPO_CONFIG_DO.idFromName).toBe("function");
		// makeStub is a helper available for parity with workflow-test patterns;
		// referenced here so tsc/biome don't flag it unused.
		expect(typeof makeStub).toBe("function");
	});
});

describe("RepoConfigDO — get/set round-trip", () => {
	test("fresh instance returns null", async () => {
		const id = env.REPO_CONFIG_DO.idFromName("acme/fresh");
		const stub = env.REPO_CONFIG_DO.get(id);
		await expect(stub.getRepoConfig()).resolves.toBeNull();
	});

	test("set then get returns resolved shape (defaults applied)", async () => {
		const id = env.REPO_CONFIG_DO.idFromName("acme/round-trip");
		const stub = env.REPO_CONFIG_DO.get(id);
		const cfg: StoredRepoConfig = {
			repositoryId: 1,
			repositoryFullName: "acme/round-trip",
			installationId: 100,
			settings: {},
		};
		await stub.setRepoConfig(cfg);
		const read = await stub.getRepoConfig();
		expect(read).not.toBeNull();
		expect(read?.repositoryId).toBe(1);
		expect(read?.repositoryFullName).toBe("acme/round-trip");
		expect(read?.installationId).toBe(100);
		expect(read?.settings.sandbox.size).toBe("medium");
		expect(read?.settings.sandbox.docker).toBe(false);
		expect(read?.settings.sandbox.volumes).toEqual([]);
		expect(read?.settings.harness.provider).toBe("claude_code");
		expect(read?.settings.scheduled_jobs).toEqual([]);
	});

	test("set overwrites prior state (no merge)", async () => {
		const id = env.REPO_CONFIG_DO.idFromName("acme/overwrite");
		const stub = env.REPO_CONFIG_DO.get(id);
		await stub.setRepoConfig({
			repositoryId: 1,
			repositoryFullName: "acme/overwrite",
			installationId: 100,
			settings: { sandbox: { size: "small" } },
		});
		await stub.setRepoConfig({
			repositoryId: 2,
			repositoryFullName: "acme/overwrite",
			installationId: 200,
			settings: { harness: { provider: "codex" } },
		});
		const read = await stub.getRepoConfig();
		expect(read?.repositoryId).toBe(2);
		expect(read?.installationId).toBe(200);
		// The overwritten sparse settings contain no sandbox section → size reverts to default "medium"
		expect(read?.settings.sandbox.size).toBe("medium");
		expect(read?.settings.harness.provider).toBe("codex");
	});

	test("volume with path-only returns resolved size '10gb'", async () => {
		const id = env.REPO_CONFIG_DO.idFromName("acme/volumes");
		const stub = env.REPO_CONFIG_DO.get(id);
		await stub.setRepoConfig({
			repositoryId: 3,
			repositoryFullName: "acme/volumes",
			installationId: 300,
			settings: { sandbox: { volumes: [{ path: "/data" }] } },
		});
		const read = await stub.getRepoConfig();
		expect(read?.settings.sandbox.volumes).toEqual([
			{ path: "/data", size: "10Gi" },
		]);
	});

	test("setRepoConfig writes identity fields and settings to separate KV keys", async () => {
		const id = env.REPO_CONFIG_DO.idFromName("acme/key-layout");
		const stub = env.REPO_CONFIG_DO.get(id);
		await stub.setRepoConfig({
			repositoryId: 42,
			repositoryFullName: "acme/key-layout",
			installationId: 999,
			settings: { sandbox: { size: "small" } },
		});
		await runInDurableObject(stub, async (_instance, ctx) => {
			expect(ctx.storage.kv.get("repositoryId")).toBe(42);
			expect(ctx.storage.kv.get("repositoryFullName")).toBe("acme/key-layout");
			expect(ctx.storage.kv.get("installationId")).toBe(999);
			expect(ctx.storage.kv.get("config")).toEqual({
				sandbox: { size: "small" },
			});
		});
	});

	test("distinct fullNames route to distinct DO instances", async () => {
		const idA = env.REPO_CONFIG_DO.idFromName("acme/a");
		const idB = env.REPO_CONFIG_DO.idFromName("acme/b");
		expect(idA.toString()).not.toBe(idB.toString());
		await env.REPO_CONFIG_DO.get(idA).setRepoConfig({
			repositoryId: 1,
			repositoryFullName: "acme/a",
			installationId: 1,
			settings: {},
		});
		await expect(
			env.REPO_CONFIG_DO.get(idB).getRepoConfig(),
		).resolves.toBeNull();
	});
});
