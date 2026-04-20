import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { RepoConfigDO } from "../durable-objects/repo-config-do";
import type { ConfigPushEvent } from "../events/types";
import { GitHubClient } from "../services/github/client";
import { createLogger } from "../utils/logger";
import { runSyncRepoConfig } from "./steps/sync-repo-config";

/**
 * Environment bindings required by the repo-config workflow. A superset of the
 * task-runner env is not needed — this workflow only authenticates as the
 * GitHub App (to fetch the config file at a SHA) and writes to the per-repo
 * `RepoConfigDO`. `REPO_CONFIG_WORKFLOW` is included so the binding type on
 * `this.env` matches Wrangler's own resolution.
 */
export interface RepoConfigWorkflowEnv {
	APP_ID: string;
	PRIVATE_KEY: string;
	LOG_FORMAT?: string;
	REPO_CONFIG_WORKFLOW: Workflow;
	REPO_CONFIG_DO: DurableObjectNamespace<RepoConfigDO>;
}

/**
 * `RepoConfigWorkflow` runs one instance per accepted `config_push` delivery
 * (GitHub push to the repo's default branch that touches
 * `.code-factory/config.toml`). It delegates the three-step pipeline
 * (fetch → parse → store) to `runSyncRepoConfig`.
 *
 * Clients (Octokit, GitHubClient) are constructed at the top of `run()` once
 * per replay. They must NOT be returned from any `step.do` callback — class
 * instances are not structured-cloneable and the workflow engine throws on
 * attempted persistence.
 */
export class RepoConfigWorkflow extends WorkflowEntrypoint<
	RepoConfigWorkflowEnv,
	ConfigPushEvent
> {
	async run(
		event: WorkflowEvent<ConfigPushEvent>,
		step: WorkflowStep,
	): Promise<void> {
		const payload = event.payload;
		const sourceTrace = payload.source.trace ?? {};
		const logger = createLogger({ logFormat: this.env.LOG_FORMAT }).child({
			instanceId: event.instanceId,
			eventType: payload.type,
			repository: payload.repository.fullName,
			...(sourceTrace.rayId ? { rayId: sourceTrace.rayId } : {}),
			...(sourceTrace.traceId ? { traceId: sourceTrace.traceId } : {}),
			...(sourceTrace.spanId ? { spanId: sourceTrace.spanId } : {}),
		});
		// Replay-safe breadcrumb: emits an `instanceId`-tagged line on every
		// replay so Workers Logs can correlate the run even when all downstream
		// side-effects are cached in `step.do` results.
		logger.info("Workflow run started", { type: payload.type });

		const octokit = new Octokit({
			authStrategy: createAppAuth,
			auth: {
				appId: this.env.APP_ID,
				privateKey: this.env.PRIVATE_KEY,
				installationId: payload.source.installationId,
			},
		});
		const github = new GitHubClient(octokit, logger);

		await runSyncRepoConfig({
			step,
			github,
			env: this.env,
			event: payload,
			logger,
		});
	}
}
