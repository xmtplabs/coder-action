import { Buffer } from "node:buffer";
import { describe, expect, test, vi } from "vitest";
import type { StoredRepoConfig } from "../../config/repo-config-schema";
import type { RepoConfigDO } from "../../durable-objects/repo-config-do";
import type { ConfigPushEvent } from "../../events/types";
import type { GitHubClient } from "../../services/github/client";
import type { Logger } from "../../utils/logger";
import { runSyncRepoConfig } from "./sync-repo-config";

type StepCall = { name: string; returned?: unknown; threw?: unknown };

function makeStep() {
	const calls: StepCall[] = [];
	const step = {
		do: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
			try {
				const returned = await fn();
				calls.push({ name, returned });
				return returned;
			} catch (err) {
				calls.push({ name, threw: err });
				throw err;
			}
		},
	} as unknown as import("cloudflare:workers").WorkflowStep;
	return { step, calls };
}

const noopLogger: Logger = {
	info: () => {},
	debug: () => {},
	warn: () => {},
	error: () => {},
	child: () => noopLogger,
};

const toBase64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

function makeEvent(): ConfigPushEvent {
	return {
		type: "config_push",
		source: { type: "github", installationId: 100 },
		repository: {
			id: 42,
			owner: "acme",
			name: "repo",
			fullName: "acme/repo",
			defaultBranch: "main",
		},
		head: { sha: "abc123", ref: "refs/heads/main" },
	};
}

function makeDO() {
	const setRepoConfig = vi.fn(async (_cfg: StoredRepoConfig) => {});
	const stub = { setRepoConfig } as unknown as DurableObjectStub<RepoConfigDO>;
	const idFromName = vi.fn(
		(_name: string) => "stub-id" as unknown as DurableObjectId,
	);
	const get = vi.fn((_id: DurableObjectId) => stub);
	const REPO_CONFIG_DO = {
		idFromName,
		get,
	} as unknown as DurableObjectNamespace<RepoConfigDO>;
	return { REPO_CONFIG_DO, idFromName, get, setRepoConfig };
}

describe("runSyncRepoConfig", () => {
	test("happy path — runs full step sequence and writes StoredRepoConfig to DO", async () => {
		const { step, calls } = makeStep();
		const { REPO_CONFIG_DO, idFromName, get, setRepoConfig } = makeDO();
		const toml = [
			"[sandbox]",
			'size = "large"',
			"docker = true",
			"",
			"[harness]",
			'provider = "codex"',
			"",
		].join("\n");
		const github = {
			getRepoContentFile: vi.fn(async () => ({ contentBase64: toBase64(toml) })),
		} as unknown as GitHubClient;
		const event = makeEvent();

		await runSyncRepoConfig({
			step,
			github,
			env: { REPO_CONFIG_DO },
			event,
			logger: noopLogger,
		});

		expect(calls.map((c) => c.name)).toEqual([
			"fetch-config-file",
			"parse-and-validate",
			"store-repo-config",
		]);
		expect(idFromName).toHaveBeenCalledWith("acme/repo");
		expect(get).toHaveBeenCalledTimes(1);
		expect(setRepoConfig).toHaveBeenCalledWith({
			repositoryId: 42,
			repositoryFullName: "acme/repo",
			installationId: 100,
			settings: {
				sandbox: { size: "large", docker: true },
				harness: { provider: "codex" },
			},
		});
	});

	test("file absent — only runs fetch-config-file and makes no DO writes", async () => {
		const { step, calls } = makeStep();
		const { REPO_CONFIG_DO, idFromName, get, setRepoConfig } = makeDO();
		const github = {
			getRepoContentFile: vi.fn(async () => null),
		} as unknown as GitHubClient;
		const event = makeEvent();

		await runSyncRepoConfig({
			step,
			github,
			env: { REPO_CONFIG_DO },
			event,
			logger: noopLogger,
		});

		expect(calls.map((c) => c.name)).toEqual(["fetch-config-file"]);
		expect(idFromName).not.toHaveBeenCalled();
		expect(get).not.toHaveBeenCalled();
		expect(setRepoConfig).not.toHaveBeenCalled();
	});

	test("TOML syntax invalid — parse-and-validate throws; store-repo-config not invoked", async () => {
		const { step, calls } = makeStep();
		const { REPO_CONFIG_DO, setRepoConfig } = makeDO();
		const github = {
			getRepoContentFile: vi.fn(async () => ({
				contentBase64: toBase64("this is = not = valid = toml ["),
			})),
		} as unknown as GitHubClient;
		const event = makeEvent();

		await expect(
			runSyncRepoConfig({
				step,
				github,
				env: { REPO_CONFIG_DO },
				event,
				logger: noopLogger,
			}),
		).rejects.toThrow(/Invalid TOML/);

		expect(calls.map((c) => c.name)).toEqual([
			"fetch-config-file",
			"parse-and-validate",
		]);
		expect(setRepoConfig).not.toHaveBeenCalled();
	});

	test("Zod invalid — parse-and-validate throws; store-repo-config not invoked", async () => {
		const { step, calls } = makeStep();
		const { REPO_CONFIG_DO, setRepoConfig } = makeDO();
		const toml = ["[sandbox]", 'size = "huge"', ""].join("\n");
		const github = {
			getRepoContentFile: vi.fn(async () => ({ contentBase64: toBase64(toml) })),
		} as unknown as GitHubClient;
		const event = makeEvent();

		await expect(
			runSyncRepoConfig({
				step,
				github,
				env: { REPO_CONFIG_DO },
				event,
				logger: noopLogger,
			}),
		).rejects.toThrow(/Invalid RepoConfig/);

		expect(calls.map((c) => c.name)).toEqual([
			"fetch-config-file",
			"parse-and-validate",
		]);
		expect(setRepoConfig).not.toHaveBeenCalled();
	});

	test("sparse settings preserved — no default materialization on the write path", async () => {
		const { step } = makeStep();
		const { REPO_CONFIG_DO, setRepoConfig } = makeDO();
		const toml = ["[sandbox]", "docker = true", ""].join("\n");
		const github = {
			getRepoContentFile: vi.fn(async () => ({ contentBase64: toBase64(toml) })),
		} as unknown as GitHubClient;
		const event = makeEvent();

		await runSyncRepoConfig({
			step,
			github,
			env: { REPO_CONFIG_DO },
			event,
			logger: noopLogger,
		});

		expect(setRepoConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				settings: { sandbox: { docker: true } },
			}),
		);
	});
});
