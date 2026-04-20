import { env, introspectWorkflowInstance } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import type { ConfigPushEvent } from "../events/types";
import { RepoConfigWorkflow } from "./repo-config-workflow";

// ── Smoke: binding shape ─────────────────────────────────────────────────────

const base: ConfigPushEvent = {
	type: "config_push",
	source: { type: "github", installationId: 1 },
	repository: {
		id: 10,
		owner: "acme",
		name: "repo",
		fullName: "acme/repo",
		defaultBranch: "main",
	},
	head: { sha: "abc", ref: "refs/heads/main" },
};

describe("RepoConfigWorkflow", () => {
	test("class is exported and its name matches wrangler.toml class_name", () => {
		// A rename would orphan in-flight instances — this guards against that.
		expect(typeof RepoConfigWorkflow).toBe("function");
		expect(RepoConfigWorkflow.name).toBe("RepoConfigWorkflow");
	});

	test("env.REPO_CONFIG_WORKFLOW binding exists and is callable", () => {
		expect(env.REPO_CONFIG_WORKFLOW).toBeDefined();
		expect(typeof env.REPO_CONFIG_WORKFLOW.create).toBe("function");
	});
});

// ── Introspection-driven dispatch tests ──────────────────────────────────────
//
// Each test mocks every `step.do` result so no live GitHub / DO calls fire.

describe("RepoConfigWorkflow dispatch — happy path", () => {
	test("fetch → parse → store reaches complete", async () => {
		const instanceId = "config_push-repo-abc-test-delivery-1";
		await using instance = await introspectWorkflowInstance(
			env.REPO_CONFIG_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.mockStepResult(
				{ name: "fetch-config-file" },
				{ present: true, contentBase64: "" },
			);
			await m.mockStepResult({ name: "parse-and-validate" }, { settings: {} });
			await m.mockStepResult({ name: "store-repo-config" }, { ok: true });
		});
		await env.REPO_CONFIG_WORKFLOW.create({ id: instanceId, params: base });
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});
});

describe("RepoConfigWorkflow dispatch — file absent", () => {
	test("present=false → early return, no DO write, complete", async () => {
		const instanceId = "config_push-repo-missing-delivery-2";
		await using instance = await introspectWorkflowInstance(
			env.REPO_CONFIG_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.mockStepResult(
				{ name: "fetch-config-file" },
				{ present: false },
			);
			// parse-and-validate / store-repo-config intentionally NOT mocked — if
			// the workflow tried to run them unmocked it would fail, exposing a
			// regression in the early-exit branch.
		});
		await env.REPO_CONFIG_WORKFLOW.create({ id: instanceId, params: base });
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});
});
