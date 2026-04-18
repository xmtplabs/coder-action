import type { CoderClient } from "../coder-client";
import type { GitHubClient, PRInfo } from "../github-client";
import type { Logger } from "../infra/logger";
import { MAX_FAILED_JOBS, formatFailedCheckMessage } from "../messages";
import type { ActionOutputs, HandlerConfig } from "../config/handler-config";
import {
	generateTaskName,
	lookupAndEnsureActiveTask,
	sendInputWithRetry,
} from "../task-utils";

const MAX_LOG_LINES = 100;

export interface FailedCheckContext {
	owner: string;
	repo: string;
	runId: number;
	runUrl: string;
	headSha: string;
	workflowName: string;
	workflowFile: string;
	pullRequests: Array<{ number: number }>;
}

export class FailedCheckHandler {
	constructor(
		private readonly coder: CoderClient,
		private readonly github: GitHubClient,
		private readonly inputs: HandlerConfig,
		private readonly context: FailedCheckContext,
		private readonly logger: Logger,
	) {}

	async run(): Promise<ActionOutputs> {
		// 1. Get PR from event or fall back to SHA lookup
		let pr: PRInfo | null = null;
		if (this.context.pullRequests.length > 0) {
			pr = await this.github.getPR(
				this.context.owner,
				this.context.repo,
				this.context.pullRequests[0].number,
			);
		} else {
			this.logger.info("No pull_requests in event, looking up by head SHA");
			pr = await this.github.findPRByHeadSHA(
				this.context.owner,
				this.context.repo,
				this.context.headSha,
			);
		}

		if (!pr) {
			this.logger.info("No PR found for workflow run");
			return { skipped: true, skipReason: "no-pr-found" };
		}

		// 2. Guard: PR author must be the coder agent
		if (pr.user.login !== this.inputs.agentGithubUsername) {
			this.logger.info(
				`PR #${pr.number} not authored by ${this.inputs.agentGithubUsername}`,
			);
			return { skipped: true, skipReason: "pr-not-by-coder-agent" };
		}

		// 3. Guard: Stale commit
		if (pr.head.sha !== this.context.headSha) {
			this.logger.info(
				`Workflow run is for stale commit ${this.context.headSha}, PR is at ${pr.head.sha}`,
			);
			return { skipped: true, skipReason: "stale-commit" };
		}

		// 4. Find linked issue
		const linkedIssues = await this.github.findLinkedIssues(
			this.context.owner,
			this.context.repo,
			pr.number,
		);
		if (linkedIssues.length === 0) {
			this.logger.info("No linked issue found");
			return { skipped: true, skipReason: "no-linked-issue" };
		}
		const issue = linkedIssues[0];

		// 5. Compute task name and look up
		const taskName = generateTaskName(
			this.inputs.coderTaskNamePrefix,
			this.context.repo,
			issue.number,
		);
		const task = await lookupAndEnsureActiveTask(
			this.coder,
			this.inputs.coderUsername,
			taskName,
			this.logger,
		);
		if (!task) {
			this.logger.info(`Task not found: ${taskName}`);
			return { skipped: true, skipReason: "task-not-found" };
		}

		// 6. Fetch failed jobs (capped)
		const allFailedJobs = await this.github.getFailedJobs(
			this.context.owner,
			this.context.repo,
			this.context.runId,
		);
		const cappedJobs = allFailedJobs.slice(0, MAX_FAILED_JOBS);

		// 7. Fetch logs per job
		const jobsWithLogs = await Promise.all(
			cappedJobs.map(async (job) => ({
				name: job.name,
				logs: await this.github.getJobLogs(
					this.context.owner,
					this.context.repo,
					job.id,
					MAX_LOG_LINES,
				),
			})),
		);

		// 8. Format and send
		const message = formatFailedCheckMessage({
			prUrl: `https://github.com/${this.context.owner}/${this.context.repo}/pull/${pr.number}`,
			workflowName: this.context.workflowName,
			runUrl: this.context.runUrl,
			workflowFile: this.context.workflowFile,
			failedJobs: jobsWithLogs,
		});
		await sendInputWithRetry(this.coder, task, message, this.logger);
		this.logger.info(`Failed check details forwarded to task ${taskName}`);

		return { taskName, taskStatus: task.status, skipped: false };
	}
}
