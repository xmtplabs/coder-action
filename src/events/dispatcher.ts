import type { TaskRunner } from "../services/task-runner";
import { GitHubClient, type Octokit } from "../services/github/client";
import { CloseTaskAction } from "../actions/close-task";
import { CreateTaskAction } from "../actions/create-task";
import { FailedCheckAction } from "../actions/failed-check";
import { IssueCommentAction } from "../actions/issue-comment";
import { PRCommentAction } from "../actions/pr-comment";
import type { Logger } from "../infra/logger";
import type { ActionOutputs, HandlerConfig } from "../config/handler-config";
import type { AppConfig } from "../config/app-config";
import type { RouteResult } from "../webhooks/github/router";

// ── Public interface ──────────────────────────────────────────────────────────

export interface HandlerDispatcherOptions {
	config: AppConfig;
	createInstallationOctokit: (installationId: number) => Octokit;
	taskRunner: TaskRunner;
	logger: Logger;
	/**
	 * Optional factory for creating a GitHubClient from an Octokit instance.
	 * Defaults to `(octokit) => new GitHubClient(octokit, logger)`.
	 * Override in tests to inject a mock GitHubClient.
	 */
	createGitHubClient?: (octokit: Octokit) => GitHubClient;
}

// Helper type to extract dispatched route results
type DispatchedResult = Extract<RouteResult, { dispatched: true }>;

// ── Dispatcher ────────────────────────────────────────────────────────────────

export class HandlerDispatcher {
	constructor(private readonly options: HandlerDispatcherOptions) {}

	async dispatch(
		result: DispatchedResult,
		requestLogger?: Logger,
	): Promise<ActionOutputs> {
		const logger = requestLogger ?? this.options.logger;
		const octokit = this.options.createInstallationOctokit(
			result.installationId,
		);
		const createGitHubClient =
			this.options.createGitHubClient ??
			((oct: Octokit) => new GitHubClient(oct, logger));
		const github = createGitHubClient(octokit);

		const handlerConfig: HandlerConfig = {
			coderURL: this.options.config.coderURL,
			coderToken: this.options.config.coderToken,
			coderTaskNamePrefix: this.options.config.coderTaskNamePrefix,
			coderTemplateName: this.options.config.coderTemplateName,
			coderTemplateNameCodex: this.options.config.coderTemplateNameCodex,
			coderTemplatePreset: this.options.config.coderTemplatePreset,
			coderOrganization: this.options.config.coderOrganization,
			agentGithubUsername: this.options.config.agentGithubUsername,
		};

		switch (result.handler) {
			case "create_task": {
				const ctx = result.context;
				const action = new CreateTaskAction(
					this.options.taskRunner,
					github,
					handlerConfig,
					{
						owner: ctx.repoOwner,
						repo: ctx.repoName,
						issueNumber: ctx.issueNumber,
						issueUrl: ctx.issueUrl,
						issueTitle: ctx.issueTitle,
						issueLabels: ctx.issueLabels,
						senderLogin: ctx.senderLogin,
						senderId: ctx.senderId,
					},
					logger,
				);
				return action.run();
			}

			case "close_task": {
				const ctx = result.context;
				const action = new CloseTaskAction(
					this.options.taskRunner,
					github,
					handlerConfig,
					{
						owner: ctx.repoOwner,
						repo: ctx.repoName,
						issueNumber: ctx.issueNumber,
					},
					logger,
				);
				return action.run();
			}

			case "pr_comment": {
				const ctx = result.context;
				const action = new PRCommentAction(
					this.options.taskRunner,
					github,
					handlerConfig,
					{
						owner: ctx.repoOwner,
						repo: ctx.repoName,
						prNumber: ctx.issueNumber,
						prAuthor: ctx.prAuthor,
						commenterLogin: ctx.commenterLogin,
						commentId: ctx.commentId,
						commentUrl: ctx.commentUrl,
						commentBody: ctx.commentBody,
						commentCreatedAt: ctx.commentCreatedAt,
						isReviewComment: ctx.isReviewComment,
						isReviewSubmission: ctx.isReviewSubmission,
						filePath: ctx.filePath,
						lineNumber: ctx.lineNumber,
					},
					logger,
				);
				return action.run();
			}

			case "issue_comment": {
				const ctx = result.context;
				const action = new IssueCommentAction(
					this.options.taskRunner,
					github,
					handlerConfig,
					{
						owner: ctx.repoOwner,
						repo: ctx.repoName,
						issueNumber: ctx.issueNumber,
						commentId: ctx.commentId,
						commenterLogin: ctx.commenterLogin,
						commentUrl: ctx.commentUrl,
						commentBody: ctx.commentBody,
						commentCreatedAt: ctx.commentCreatedAt,
					},
					logger,
				);
				return action.run();
			}

			case "failed_check": {
				const ctx = result.context;
				const action = new FailedCheckAction(
					this.options.taskRunner,
					github,
					handlerConfig,
					{
						owner: ctx.repoOwner,
						repo: ctx.repoName,
						runId: ctx.workflowRunId,
						runUrl: ctx.workflowRunUrl,
						headSha: ctx.headSha,
						workflowName: ctx.workflowName ?? "unknown",
						workflowFile:
							ctx.workflowPath != null
								? (ctx.workflowPath.split("/").pop() ?? "unknown")
								: "unknown",
						pullRequests: ctx.pullRequestNumbers.map((n) => ({ number: n })),
					},
					logger,
				);
				return action.run();
			}
		}
	}
}
