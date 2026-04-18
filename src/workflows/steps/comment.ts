import type { WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { generateTaskName } from "../../actions/task-naming";
import type { AppConfig } from "../../config/app-config";
import type { CommentPostedEvent } from "../../events/types";
import type { CoderService } from "../../services/coder/service";
import type { GitHubClient } from "../../services/github/client";
import { TaskIdSchema } from "../../services/task-runner";
import { ensureTaskReady } from "../ensure-task-ready";

export interface RunCommentContext {
	step: WorkflowStep;
	coder: CoderService;
	github: GitHubClient;
	config: AppConfig;
	event: CommentPostedEvent;
}

/**
 * Workflow step factory for `comment_posted` (both PR and issue kinds).
 *
 * Flow: locate-task → ensureTaskReady → send-task-input → react-to-comment.
 * Throws `NonRetryableError` if the task doesn't exist — there's nothing to
 * send to, and retrying won't create it.
 */
export async function runComment(ctx: RunCommentContext): Promise<void> {
	const { step, coder, github, config, event } = ctx;

	const taskName = generateTaskName(
		config.coderTaskNamePrefix,
		event.repository.name,
		event.target.number,
	);

	const located = await step.do("locate-task", async () => {
		const raw = await coder.findTaskByName(taskName);
		if (!raw) {
			throw new NonRetryableError(`task ${taskName} not found`);
		}
		// Return scalars only — never the raw SDK task.
		const task = raw as {
			id: string;
			owner_id: string;
		};
		return { taskId: task.id, owner: task.owner_id };
	});

	const taskId = TaskIdSchema.parse(located.taskId);

	await ensureTaskReady({ step, coder, taskId, owner: located.owner });

	await step.do("send-task-input", async () => {
		await coder.sendTaskInput(taskId, located.owner, event.comment.body);
	});

	await step.do("react-to-comment", async () => {
		if (event.comment.isReviewComment) {
			await github.addReactionToReviewComment(
				event.repository.owner,
				event.repository.name,
				event.comment.id,
			);
		} else {
			await github.addReactionToComment(
				event.repository.owner,
				event.repository.name,
				event.comment.id,
			);
		}
	});
}
