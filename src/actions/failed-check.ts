import type { TaskRunner } from "../services/task-runner";
import type { GitHubClient, PRInfo } from "../services/github/client";
import type { Logger } from "../infra/logger";
import { MAX_FAILED_JOBS, formatFailedCheckMessage } from "./messages";
import type { ActionOutputs, HandlerConfig } from "../config/handler-config";
import { generateTaskName } from "./task-naming";

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

export class FailedCheckAction {
	constructor(
		private readonly runner: TaskRunner,
		private readonly github: GitHubClient,
		private readonly inputs: HandlerConfig,
		private readonly context: FailedCheckContext,
		private readonly logger: Logger,
	) {}

	async run(): Promise<ActionOutputs> {
		const owner = this.context.owner;
		const repo = this.context.repo;

		// 1. Get PR from event or fall back to SHA lookup
		let pr: PRInfo | null = null;
		if (this.context.pullRequests.length > 0) {
			pr = await this.github.getPR(
				owner,
				repo,
				this.context.pullRequests[0].number,
			);
		} else {
			this.logger.info("No pull_requests in event, looking up by head SHA");
			pr = await this.github.findPRByHeadSHA(owner, repo, this.context.headSha);
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
			owner,
			repo,
			pr.number,
		);
		if (linkedIssues.length === 0) {
			this.logger.info("No linked issue found");
			return { skipped: true, skipReason: "no-linked-issue" };
		}
		const issue = linkedIssues[0];

		// 5. Compute task name and look up via TaskRunner
		const taskName = generateTaskName(
			this.inputs.coderTaskNamePrefix,
			repo,
			issue.number,
		);
		const existing = await this.runner.getStatus({ taskName });
		if (!existing || existing.status === "error") {
			this.logger.info(`Task not found: ${taskName}`);
			return { skipped: true, skipReason: "task-not-found" };
		}

		// 6. Fetch failed jobs (capped)
		const allFailedJobs = await this.github.getFailedJobs(
			owner,
			repo,
			this.context.runId,
		);
		const cappedJobs = allFailedJobs.slice(0, MAX_FAILED_JOBS);

		// 7. Fetch logs per job
		const jobsWithLogs = await Promise.all(
			cappedJobs.map(async (job) => ({
				name: job.name,
				logs: await this.github.getJobLogs(owner, repo, job.id, MAX_LOG_LINES),
			})),
		);

		// 8. Format and send
		const message = formatFailedCheckMessage({
			prUrl: `https://github.com/${owner}/${repo}/pull/${pr.number}`,
			workflowName: this.context.workflowName,
			runUrl: this.context.runUrl,
			workflowFile: this.context.workflowFile,
			failedJobs: jobsWithLogs,
		});
		await this.runner.sendInput({ taskName, input: message, timeout: 120_000 });
		this.logger.info(`Failed check details forwarded to task ${taskName}`);

		return { taskName, taskStatus: existing.status, skipped: false };
	}
}
