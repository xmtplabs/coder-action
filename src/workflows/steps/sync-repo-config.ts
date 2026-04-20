import { Buffer } from "node:buffer";
import type { WorkflowStep } from "cloudflare:workers";
import {
	parseRepoConfigToml,
	type StoredRepoConfig,
} from "../../config/repo-config-schema";
import type { RepoConfigDO } from "../../durable-objects/repo-config-do";
import type { ConfigPushEvent } from "../../events/types";
import type { GitHubClient } from "../../services/github/client";
import type { Logger } from "../../utils/logger";

const CONFIG_PATH = ".code-factory/config.toml";

export interface RunSyncRepoConfigContext {
	step: WorkflowStep;
	github: GitHubClient;
	env: { REPO_CONFIG_DO: DurableObjectNamespace<RepoConfigDO> };
	event: ConfigPushEvent;
	logger: Logger;
}

/**
 * Workflow step factory for `config_push`. Fetches `.code-factory/config.toml`
 * at the pushed head SHA, parses + validates it, and writes the sparse
 * `StoredRepoConfig` envelope into the per-repo `RepoConfigDO`.
 *
 * Replay-safety:
 *   - Each step callback returns only structured-cloneable JSON
 *     (no Buffer, no Octokit/DO stubs leaking out of the closure).
 *   - `parseRepoConfigToml` throws `NonRetryableError` on syntax/schema
 *     violations — we let it propagate so the Workflow engine sees the
 *     instance as terminally errored.
 */
export async function runSyncRepoConfig(
	ctx: RunSyncRepoConfigContext,
): Promise<void> {
	const { step, github, env, event, logger } = ctx;
	const { owner, name, fullName, id: repositoryId } = event.repository;
	const { installationId } = event.source;

	const fileResult = await step.do("fetch-config-file", async () => {
		const res = await github.getRepoContentFile(
			owner,
			name,
			CONFIG_PATH,
			event.head.sha,
		);
		if (res === null) return { present: false as const };
		return { present: true as const, contentBase64: res.contentBase64 };
	});

	if (!fileResult.present) {
		logger.info("No repo config file present; skipping DO write", {
			fullName,
			sha: event.head.sha,
		});
		return;
	}

	const parseResult = await step.do("parse-and-validate", async () => {
		const raw = Buffer.from(fileResult.contentBase64, "base64").toString("utf8");
		const settings = parseRepoConfigToml(raw);
		return { settings };
	});

	await step.do("store-repo-config", async () => {
		const id = env.REPO_CONFIG_DO.idFromName(fullName);
		const stub = env.REPO_CONFIG_DO.get(id);
		const cfg: StoredRepoConfig = {
			repositoryId,
			repositoryFullName: fullName,
			installationId,
			settings: parseResult.settings,
		};
		await stub.setRepoConfig(cfg);
		return { ok: true as const };
	});
}
