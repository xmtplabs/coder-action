import type { WorkflowStep } from "cloudflare:workers";
import { generateTaskName } from "../../actions/task-naming";
import type { AppConfig } from "../../config/app-config";
import type { TaskRequestedEvent } from "../../events/types";
import type { CoderService } from "../../services/coder/service";
import type { GitHubClient } from "../../services/github/client";

export interface RunCreateTaskContext {
	step: WorkflowStep;
	coder: CoderService;
	github: GitHubClient;
	config: AppConfig;
	event: TaskRequestedEvent;
}

/**
 * Workflow step factory for `task_requested`. Each external side-effect is
 * wrapped in a `step.do` so Workflows can retry individual steps, persist
 * their results, and resume from partial progress on replay.
 *
 * Step callbacks return only plain scalar objects — never class instances or
 * raw SDK responses (EARS-REQ-16a).
 */
export async function runCreateTask(ctx: RunCreateTaskContext): Promise<void> {
	const { step, coder, github, config, event } = ctx;

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

	const hasPermission = await step.do(
		"check-github-permission",
		async () =>
			github.checkActorPermission(
				event.repository.owner,
				event.repository.name,
				event.requester.login,
			),
	);

	if (!hasPermission) {
		return;
	}

	const prompt = event.issue.url; // Default prompt = issue URL
	const created = await step.do("create-coder-task", async () => {
		const task = await coder.create({ taskName, owner, input: prompt });
		return {
			taskName: task.name,
			owner: task.owner,
			url: task.url,
			status: task.status,
		};
	});

	await step.do("comment-on-issue", async () => {
		await github.commentOnIssue(
			event.repository.owner,
			event.repository.name,
			event.issue.number,
			`Task created: ${created.url}`,
			"Task created:",
		);
	});
}
