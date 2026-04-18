import type { WorkflowStep } from "cloudflare:workers";
import { MAX_FAILED_JOBS, formatFailedCheckMessage } from "../../actions/messages";
import { generateTaskName } from "../../actions/task-naming";
import type { AppConfig } from "../../config/app-config";
import type { CheckFailedEvent } from "../../events/types";
import type { CoderService } from "../../services/coder/service";
import type { GitHubClient } from "../../services/github/client";
import { TaskIdSchema } from "../../services/task-runner";
import { ensureTaskReady } from "../ensure-task-ready";

const MAX_LOG_LINES = 100;

export interface RunFailedCheckContext {
	step: WorkflowStep;
	coder: CoderService;
	github: GitHubClient;
	config: AppConfig;
	event: CheckFailedEvent;
}

/**
 * Workflow step factory for `check_failed`. Linearizes the multi-call pipeline
 * into distinct steps within a single instance (per spec §3). If no PR is
 * linked or no existing task exists, returns early without send.
 */
export async function runFailedCheck(
	ctx: RunFailedCheckContext,
): Promise<void> {
	const { step, coder, github, config, event } = ctx;

	// 1. Fetch PR info (event's linked PR, or fall back to head-SHA lookup)
	const pr = await step.do("fetch-pr-info", async () => {
		if (event.pullRequestNumbers.length > 0 && event.pullRequestNumbers[0]) {
			const found = await github.getPR(
				event.repository.owner,
				event.repository.name,
				event.pullRequestNumbers[0],
			);
			if (!found) return null;
			return {
				number: found.number,
				authorLogin: found.user.login,
				headSha: found.head.sha,
			};
		}
		const found = await github.findPRByHeadSHA(
			event.repository.owner,
			event.repository.name,
			event.run.headSha,
		);
		if (!found) return null;
		return {
			number: found.number,
			authorLogin: found.user.login,
			headSha: found.head.sha,
		};
	});

	if (!pr) return;
	if (pr.authorLogin !== config.agentGithubUsername) return;
	if (pr.headSha !== event.run.headSha) return;

	// 2. Find linked issues
	const linked = await step.do("find-linked-issues", async () => {
		const issues = await github.findLinkedIssues(
			event.repository.owner,
			event.repository.name,
			pr.number,
		);
		return issues.map((i) => ({ number: i.number }));
	});
	if (linked.length === 0 || !linked[0]) return;
	const issueNumber = linked[0].number;

	// 3. Locate task
	const taskName = generateTaskName(
		config.coderTaskNamePrefix,
		event.repository.name,
		issueNumber,
	);
	const located = await step.do("locate-task", async () => {
		const raw = await coder.findTaskByName(taskName);
		if (!raw) return null;
		const task = raw as { id: string; owner_id: string; status: string };
		if (task.status === "error") return null;
		return { taskId: task.id, owner: task.owner_id };
	});
	if (!located) return;

	const taskId = TaskIdSchema.parse(located.taskId);

	// 4. Fetch failed jobs (capped)
	const failedJobs = await step.do("fetch-failed-jobs", async () => {
		const jobs = await github.getFailedJobs(
			event.repository.owner,
			event.repository.name,
			event.run.id,
		);
		return jobs.slice(0, MAX_FAILED_JOBS).map((j) => ({
			id: j.id,
			name: j.name,
			conclusion: j.conclusion,
		}));
	});

	// 5. Fetch logs per job (each as its own step, returning plain strings)
	const jobsWithLogs: Array<{ name: string; logs: string }> = [];
	for (const job of failedJobs) {
		const logs = await step.do(`fetch-job-logs`, async () =>
			github.getJobLogs(
				event.repository.owner,
				event.repository.name,
				job.id,
				MAX_LOG_LINES,
			),
		);
		jobsWithLogs.push({ name: job.name, logs });
	}

	// 6. Ensure task ready, then send
	await ensureTaskReady({ step, coder, taskId, owner: located.owner });

	await step.do("send-task-input", async () => {
		const message = formatFailedCheckMessage({
			prUrl: `https://github.com/${event.repository.owner}/${event.repository.name}/pull/${pr.number}`,
			workflowName: event.run.workflowName,
			runUrl: event.run.url,
			workflowFile: event.run.workflowFile,
			failedJobs: jobsWithLogs,
		});
		await coder.sendTaskInput(taskId, located.owner, message);
	});
}
