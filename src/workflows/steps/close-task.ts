import type { WorkflowStep } from "cloudflare:workers";
import { generateTaskName } from "../../actions/task-naming";
import type { AppConfig } from "../../config/app-config";
import type { TaskClosedEvent } from "../../events/types";
import type { CoderService } from "../../services/coder/service";
import type { GitHubClient } from "../../services/github/client";
import {
	TASK_STATUS_COMMENT_MARKER,
	buildTaskStatusCommentBody,
} from "../task-status-comment";

export interface RunCloseTaskContext {
	step: WorkflowStep;
	coder: CoderService;
	github: GitHubClient;
	config: AppConfig;
	event: TaskClosedEvent;
}

/**
 * Workflow step factory for `task_closed`. Idempotent: `delete-coder-task`
 * returns `{deleted: false}` for tasks that don't exist, and the comment step
 * is skipped in that case (matches existing `CloseTaskAction` semantics).
 */
export async function runCloseTask(ctx: RunCloseTaskContext): Promise<void> {
	const { step, coder, github, config, event } = ctx;

	const taskName = generateTaskName(
		config.coderTaskNamePrefix,
		event.repository.name,
		event.issue.number,
	);

	const result = await step.do("delete-coder-task", async () => {
		const raw = await coder.delete({ taskName });
		// Explicit scalar projection — guards against future callees adding
		// fields that would leak into the cached step output.
		return { deleted: raw.deleted };
	});

	if (!result.deleted) {
		return;
	}

	await step.do("comment-on-issue", async () => {
		await github.commentOnIssue(
			event.repository.owner,
			event.repository.name,
			event.issue.number,
			buildTaskStatusCommentBody("Task completed."),
			TASK_STATUS_COMMENT_MARKER,
		);
	});
}
