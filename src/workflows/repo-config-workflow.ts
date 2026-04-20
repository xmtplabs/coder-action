import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "../config/app-config";
import type { ConfigPushEvent } from "../events/types";
import { GitHubClient } from "../services/github/client";
import { createLogger } from "../utils/logger";
import { runSyncRepoConfig } from "./steps/sync-repo-config";
import type { TaskRunnerWorkflowEnv } from "./task-runner-workflow";

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
 *
 * The env type is shared with `TaskRunnerWorkflow`: the Worker entry's `env`
 * is a single object dispatched to both workflows, so divergent env interfaces
 * would drift as new bindings are added. Sharing `TaskRunnerWorkflowEnv`
 * keeps the contract centralized even if this workflow only reads a subset.
 */
export class RepoConfigWorkflow extends WorkflowEntrypoint<
	TaskRunnerWorkflowEnv,
	ConfigPushEvent
> {
	async run(
		event: WorkflowEvent<ConfigPushEvent>,
		step: WorkflowStep,
	): Promise<void> {
		const payload = event.payload;
		const config = loadConfig(
			this.env as unknown as Record<string, string | undefined>,
		);
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
				appId: config.appId,
				privateKey: config.privateKey,
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
