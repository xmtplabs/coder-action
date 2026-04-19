import type { WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
	formatIssueCommentMessage,
	formatPRCommentMessage,
} from "../../actions/messages";
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

function buildCommentMessage(event: CommentPostedEvent): string {
	const params = {
		commentUrl: event.comment.url,
		commenter: event.comment.authorLogin,
		timestamp: event.comment.createdAt,
		body: event.comment.body,
		filePath: event.comment.filePath,
		lineNumber: event.comment.lineNumber,
	};
	return event.target.kind === "pull_request"
		? formatPRCommentMessage(params)
		: formatIssueCommentMessage(params);
}

/**
 * Resolve the *issue* number that the comment's task should be keyed under.
 *
 * Tasks are named `{prefix}-{repo}-{issueNumber}` — deterministic per ISSUE,
 * not per PR. For issue-kind comments `event.target.number` is already the
 * issue number, so no resolution is needed. For PR-kind comments
 * `event.target.number` is the PR number; the backing task was originally
 * created for an issue, and the PR's `closingIssuesReferences` GraphQL field
 * is what links them. We look up the first linked issue and use its number.
 *
 * Returns `null` when the PR has no linked issue — meaning no task was ever
 * created for this change, and the comment has nothing to route to.
 */
async function resolveIssueNumber(
	step: WorkflowStep,
	github: GitHubClient,
	event: CommentPostedEvent,
): Promise<number | null> {
	if (event.target.kind === "issue") {
		return event.target.number;
	}
	const linked = await step.do("find-linked-issues", async () => {
		const issues = await github.findLinkedIssues(
			event.repository.owner,
			event.repository.name,
			event.target.number,
		);
		return issues.map((i) => ({ number: i.number }));
	});
	return linked[0]?.number ?? null;
}

/**
 * Workflow step factory for `comment_posted` (both PR and issue kinds).
 *
 * Flow: [find-linked-issues for PR comments] → locate-task → ensureTaskReady
 * → send-task-input → react-to-comment. Throws `NonRetryableError` if the
 * task doesn't exist — there's nothing to send to, and retrying won't create
 * it.
 *
 * The task input is wrapped in the same `[INSTRUCTIONS]` / `[COMMENT]` template
 * the pre-migration action classes used (`formatPRCommentMessage` /
 * `formatIssueCommentMessage` from `src/actions/messages.ts`) so the agent
 * continues to see commenter, URL, timestamp, and (for PR reviews) file:line
 * context — a regression here would silently strip the prompt structure.
 */
export async function runComment(ctx: RunCommentContext): Promise<void> {
	const { step, coder, github, config, event } = ctx;

	const issueNumber = await resolveIssueNumber(step, github, event);
	if (issueNumber == null) {
		// PR comment on a PR with no linked issue → no task exists for it.
		// Silently skip (matches failed-check.ts's "no linked issue" short-circuit).
		return;
	}

	const taskName = generateTaskName(
		config.coderTaskNamePrefix,
		event.repository.name,
		issueNumber,
	);

	const located = await step.do("locate-task", async () => {
		const raw = await coder.findTaskByName(taskName);
		if (!raw) {
			throw new NonRetryableError(`task ${taskName} not found`);
		}
		// `findTaskByName` returns `ExperimentalCoderSDKTask | null` (narrowed via
		// Zod inside CoderService). Validate the scalar fields we depend on before
		// projecting into the step return — defensive against upstream SDK shape
		// changes.
		const task = raw as unknown as { id?: unknown; owner_id?: unknown };
		if (typeof task.id !== "string" || typeof task.owner_id !== "string") {
			throw new NonRetryableError(
				`locate-task: task ${taskName} missing id/owner_id scalars`,
			);
		}
		return { taskId: task.id, owner: task.owner_id };
	});

	const taskId = TaskIdSchema.parse(located.taskId);

	// React immediately after locating the task so the user sees the eyes
	// reaction without waiting on readiness-poll latency.
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

	await ensureTaskReady({ step, coder, taskId, owner: located.owner });

	const message = buildCommentMessage(event);
	await step.do("send-task-input", async () => {
		await coder.sendTaskInput(taskId, located.owner, message);
	});
}
