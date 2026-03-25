import type { CoderClient } from "./coder-client";
import { GitHubClient, type Octokit } from "./github-client";
import { CloseTaskHandler } from "./handlers/close-task";
import { CreateTaskHandler } from "./handlers/create-task";
import { FailedCheckHandler } from "./handlers/failed-check";
import { IssueCommentHandler } from "./handlers/issue-comment";
import { PRCommentHandler } from "./handlers/pr-comment";
import type { Logger } from "./logger";
import type { ActionOutputs, HandlerConfig } from "./schemas";
import type { AppConfig } from "./config";
import type { RouteResult } from "./webhook-router";

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

// ── Dispatcher ────────────────────────────────────────────────────────────────

export class HandlerDispatcher {
	constructor(private readonly options: HandlerDispatcherOptions) {}

	async dispatch(
		result: RouteResult & { dispatched: true },
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
			coderTemplatePreset: this.options.config.coderTemplatePreset,
			coderOrganization: this.options.config.coderOrganization,
			agentGithubUsername: this.options.config.agentGithubUsername,
		};

		const ctx = result.context;

		switch (result.handler) {
			case "create_task": {
				// Resolve coder username from sender GitHub user ID
				const senderId =
					typeof ctx.senderId === "number" ? ctx.senderId : undefined;
				const coderUser =
					await this.options.coderClient.getCoderUserByGitHubId(senderId);
				const config = { ...handlerConfig, coderUsername: coderUser.username };
				const handler = new CreateTaskHandler(
					this.options.coderClient,
					github,
					config,
					{
						owner: String(ctx.repoOwner),
						repo: String(ctx.repoName),
						issueNumber: Number(ctx.issueNumber),
						issueUrl: String(ctx.issueUrl),
						senderLogin: String(ctx.senderLogin),
					},
					logger,
				);
				return handler.run();
			}

			case "close_task": {
				const handler = new CloseTaskHandler(
					this.options.coderClient,
					github,
					handlerConfig,
					{
						owner: String(ctx.repoOwner),
						repo: String(ctx.repoName),
						issueNumber: Number(ctx.issueNumber),
					},
					logger,
				);
				return handler.run();
			}

			case "pr_comment": {
				const handler = new PRCommentHandler(
					this.options.coderClient,
					github,
					handlerConfig,
					{
						owner: String(ctx.repoOwner),
						repo: String(ctx.repoName),
						prNumber: Number(ctx.issueNumber),
						prAuthor: String(ctx.prAuthor),
						commenterLogin: String(ctx.commenterLogin),
						commentId: Number(ctx.commentId),
						commentUrl: String(ctx.commentUrl),
						commentBody: String(ctx.commentBody),
						commentCreatedAt: String(ctx.commentCreatedAt),
						isReviewComment: Boolean(ctx.isReviewComment),
						isReviewSubmission: Boolean(ctx.isReviewSubmission),
					},
					logger,
				);
				return handler.run();
			}

			case "issue_comment": {
				const handler = new IssueCommentHandler(
					this.options.coderClient,
					github,
					handlerConfig,
					{
						owner: String(ctx.repoOwner),
						repo: String(ctx.repoName),
						issueNumber: Number(ctx.issueNumber),
						commentId: Number(ctx.commentId),
						commenterLogin: String(ctx.commenterLogin),
						commentUrl: String(ctx.commentUrl),
						commentBody: String(ctx.commentBody),
						commentCreatedAt: String(ctx.commentCreatedAt),
					},
					logger,
				);
				return handler.run();
			}

			case "failed_check": {
				const pullRequestNumbers = Array.isArray(ctx.pullRequestNumbers)
					? (ctx.pullRequestNumbers as number[])
					: [];
				const handler = new FailedCheckHandler(
					this.options.coderClient,
					github,
					handlerConfig,
					{
						owner: String(ctx.repoOwner),
						repo: String(ctx.repoName),
						runId: Number(ctx.workflowRunId),
						runUrl: String(ctx.workflowRunUrl),
						headSha: String(ctx.headSha),
						workflowName: String(ctx.workflowName),
						workflowFile:
							ctx.workflowPath != null
								? (String(ctx.workflowPath).split("/").pop() ?? "unknown")
								: "unknown",
						pullRequests: pullRequestNumbers.map((n) => ({ number: n })),
					},
					logger,
				);
				return handler.run();
			}
		}
	}
}
