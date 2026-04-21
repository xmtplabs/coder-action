import type { WorkflowStep } from "cloudflare:workers";
import { generateTaskName } from "../../actions/task-naming";
import type { AppConfig } from "../../config/app-config";
import type { RepoConfig } from "../../config/repo-config-schema";
import type { RepoConfigDO } from "../../durable-objects/repo-config-do";
import type { TaskRequestedEvent } from "../../events/types";
import type { CoderService } from "../../services/coder/service";
import type { GitHubClient } from "../../services/github/client";
import { TaskIdSchema } from "../../services/task-runner";
import {
	TASK_STATUS_COMMENT_MARKER,
	buildTaskStatusCommentBody,
} from "../task-status-comment";
import { waitForTaskActive } from "../wait-for-task-active";
import { buildTemplateInputs } from "./template-inputs";

export interface RunCreateTaskContext {
	step: WorkflowStep;
	coder: CoderService;
	github: GitHubClient;
	config: AppConfig;
	event: TaskRequestedEvent;
	env: { REPO_CONFIG_DO: DurableObjectNamespace<RepoConfigDO> };
}

/**
 * Workflow step factory for `task_requested`. Each external side-effect is
 * wrapped in a `step.do` so Workflows can retry individual steps, persist
 * their results, and resume from partial progress on replay.
 *
 * Order: permission check FIRST so unauthorized actors don't trigger a Coder
 * user lookup. Step callbacks return only plain scalar objects — never class
 * instances or raw SDK responses. See src/workflows/AGENTS.md.
 */
export async function runCreateTask(ctx: RunCreateTaskContext): Promise<void> {
	const { step, coder, github, config, event, env } = ctx;

	const hasPermission = await step.do("check-github-permission", async () =>
		github.checkActorPermission(
			event.repository.owner,
			event.repository.name,
			event.requester.login,
		),
	);

	if (!hasPermission) {
		return;
	}

	const taskName = generateTaskName(
		config.coderTaskNamePrefix,
		event.repository.name,
		event.issue.number,
	);

	const owner = await step.do("lookup-coder-user", async () =>
		coder.lookupUser({
			user: {
				type: "github",
				id: String(event.requester.externalId),
				username: event.requester.login,
			},
		}),
	);

	const repoConfig = await step.do<RepoConfig | null>(
		"lookup-repo-config",
		async () => {
			const fullName = `${event.repository.owner}/${event.repository.name}`;
			const id = env.REPO_CONFIG_DO.idFromName(fullName);
			const stub = env.REPO_CONFIG_DO.get(id);
			return await stub.getRepoConfig();
		},
	);

	// When a repo config is present we target the new template (`task-beta`)
	// with a JSON `TemplateInputs` payload. Otherwise we fall back to the
	// legacy template with the issue URL as a bare prompt.
	const { prompt, templateName } = repoConfig
		? {
				prompt: JSON.stringify(
					buildTemplateInputs({
						repository: event.repository,
						issue: { id: event.issue.id, url: event.issue.url },
						settings: repoConfig.settings,
					}),
				),
				templateName: config.codeFactoryTemplate,
			}
		: { prompt: event.issue.url, templateName: undefined };

	const created = await step.do("create-coder-task", async () => {
		const task = await coder.create({
			taskName,
			owner,
			input: prompt,
			...(templateName ? { templateName } : {}),
		});
		// Scalar projection per spec §4 serialization table. `taskId` keeps the
		// cached step output self-sufficient for any follow-up step that needs
		// to operate on the task by id without re-querying Coder.
		return {
			taskName: task.name,
			owner: task.owner,
			taskId: task.id,
			url: task.url,
			status: task.status,
		};
	});

	await step.do("comment-on-issue", async () => {
		await github.commentOnIssue(
			event.repository.owner,
			event.repository.name,
			event.issue.number,
			buildTaskStatusCommentBody(`Task created: ${created.url}`),
			TASK_STATUS_COMMENT_MARKER,
		);
	});

	// Block until the sandbox reaches raw `status === "active"` (or a terminal
	// error). Looser than `ensureTaskReady`: we don't inspect `current_state`
	// here — the user only needs to see "running" vs "failed" in the issue
	// comment as soon as the sandbox is up.
	const waitResult = await waitForTaskActive({
		step,
		coder,
		taskId: TaskIdSchema.parse(created.taskId),
		owner: created.owner,
	});

	await step.do("update-status-comment", async () => {
		const content =
			waitResult === "active"
				? `Task is running: ${created.url}`
				: `Failed to create task sandbox: ${created.url}`;
		await github.commentOnIssue(
			event.repository.owner,
			event.repository.name,
			event.issue.number,
			buildTaskStatusCommentBody(content),
			TASK_STATUS_COMMENT_MARKER,
		);
	});
}
