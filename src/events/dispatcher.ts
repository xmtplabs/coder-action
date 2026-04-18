import type { CoderClient } from "../services/coder/client";
import { GitHubClient, type Octokit } from "../services/github/client";
import { CloseTaskHandler } from "../handlers/close-task";
import { CreateTaskHandler } from "../handlers/create-task";
import { FailedCheckHandler } from "../handlers/failed-check";
import { IssueCommentHandler } from "../handlers/issue-comment";
import { PRCommentHandler } from "../handlers/pr-comment";
import type { Logger } from "../infra/logger";
import type { ActionOutputs, HandlerConfig } from "../config/handler-config";
import type { AppConfig } from "../config/app-config";
import type { RouteResult } from "../webhooks/github/router";

// ── Public interface ──────────────────────────────────────────────────────────

export interface HandlerDispatcherOptions {
	config: AppConfig;
	createInstallationOctokit: (installationId: number) => Octokit;
	coderClient: CoderClient;
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
				// Resolve coder username from sender GitHub user ID
				const coderUser = await this.options.coderClient.getCoderUserByGitHubId(
					ctx.senderId,
				);
				const config = { ...handlerConfig, coderUsername: coderUser.username };
				const handler = new CreateTaskHandler(
					this.options.coderClient,
					github,
					config,
					{
						owner: ctx.repoOwner,
						repo: ctx.repoName,
						issueNumber: ctx.issueNumber,
						issueUrl: ctx.issueUrl,
						issueTitle: ctx.issueTitle,
						issueLabels: ctx.issueLabels,
						senderLogin: ctx.senderLogin,
					},
					logger,
				);
				return handler.run();
			}

			case "close_task": {
				const ctx = result.context;
				const handler = new CloseTaskHandler(
					this.options.coderClient,
					github,
					handlerConfig,
					{
						owner: ctx.repoOwner,
						repo: ctx.repoName,
						issueNumber: ctx.issueNumber,
					},
					logger,
				);
				return handler.run();
			}

			case "pr_comment": {
				const ctx = result.context;
				const handler = new PRCommentHandler(
					this.options.coderClient,
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
				return handler.run();
			}

			case "issue_comment": {
				const ctx = result.context;
				const handler = new IssueCommentHandler(
					this.options.coderClient,
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
				return handler.run();
			}

			case "failed_check": {
				const ctx = result.context;
				const handler = new FailedCheckHandler(
					this.options.coderClient,
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
				return handler.run();
			}
		}
	}
}
