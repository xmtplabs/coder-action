import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "../config/app-config";
import type { Event } from "../events/types";
import { createLogger } from "../infra/logger";
import { CoderService } from "../services/coder/service";
import { GitHubClient } from "../services/github/client";
import { runCloseTask } from "./steps/close-task";
import { runComment } from "./steps/comment";
import { runCreateTask } from "./steps/create-task";
import { runFailedCheck } from "./steps/failed-check";

/**
 * Environment bindings expected on the Worker. Secrets come in via
 * `wrangler secret put` in production and `.dev.vars` locally; `[vars]`
 * entries in `wrangler.toml` supply non-secret config.
 */
export interface CoderTaskWorkflowEnv {
	APP_ID: string;
	PRIVATE_KEY: string;
	WEBHOOK_SECRET: string;
	AGENT_GITHUB_USERNAME: string;
	CODER_URL: string;
	CODER_TOKEN: string;
	CODER_TASK_NAME_PREFIX: string;
	CODER_TEMPLATE_NAME: string;
	CODER_TEMPLATE_NAME_CODEX: string;
	CODER_TEMPLATE_PRESET?: string;
	CODER_ORGANIZATION: string;
	LOG_FORMAT?: string;
	CODER_TASK_WORKFLOW: Workflow;
}

/**
 * `CoderTaskWorkflow` runs one instance per GitHub delivery that our webhook
 * router accepts. It dispatches on `event.payload.type` to the appropriate
 * step factory, each of which wraps external side-effects in `step.do` calls
 * so they can be retried, cached across replays, and inspected via
 * `wrangler workflows instances describe`.
 *
 * Clients (Octokit, GitHubClient, CoderService) are constructed at the top
 * of `run()` once per replay. They must NOT be returned from any `step.do`
 * callback — class instances are not structured-cloneable and the workflow
 * engine throws on attempted persistence (EARS-REQ-16a).
 */
export class CoderTaskWorkflow extends WorkflowEntrypoint<
	CoderTaskWorkflowEnv,
	Event
> {
	async run(event: WorkflowEvent<Event>, step: WorkflowStep): Promise<void> {
		const payload = event.payload;
		const config = loadConfig(this.env as Record<string, string | undefined>);
		const logger = createLogger({ logFormat: this.env.LOG_FORMAT });

		const octokit = new Octokit({
			authStrategy: createAppAuth,
			auth: {
				appId: config.appId,
				privateKey: config.privateKey,
				installationId: payload.source.installationId,
			},
		});
		const github = new GitHubClient(octokit, logger);
		const coder = new CoderService({
			serverURL: config.coderURL,
			apiToken: config.coderToken,
			config: {
				organization: config.coderOrganization,
				templateName: config.coderTemplateName,
				templatePreset: config.coderTemplatePreset,
			},
			logger,
		});

		switch (payload.type) {
			case "task_requested":
				await runCreateTask({ step, coder, github, config, event: payload });
				break;
			case "task_closed":
				await runCloseTask({ step, coder, github, config, event: payload });
				break;
			case "comment_posted":
				await runComment({ step, coder, github, config, event: payload });
				break;
			case "check_failed":
				await runFailedCheck({ step, coder, github, config, event: payload });
				break;
		}
	}
}
