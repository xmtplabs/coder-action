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
import type { Event } from "./types";

// ── Public interface ──────────────────────────────────────────────────────────

export interface EventDispatcherOptions {
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

// ── Dispatcher ────────────────────────────────────────────────────────────────

export class EventDispatcher {
	private readonly octokitCache = new Map<number, Octokit>();

	constructor(private readonly options: EventDispatcherOptions) {}

	async dispatch(event: Event, requestLogger?: Logger): Promise<ActionOutputs> {
		const logger = requestLogger ?? this.options.logger;

		// Build the per-installation Octokit (cached)
		const installationId = event.source.installationId;
		let octokit = this.octokitCache.get(installationId);
		if (!octokit) {
			octokit = this.options.createInstallationOctokit(installationId);
			this.octokitCache.set(installationId, octokit);
		}

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

		switch (event.type) {
			case "task_requested": {
				const action = new CreateTaskAction(
					this.options.taskRunner,
					github,
					handlerConfig,
					{
						owner: event.repository.owner,
						repo: event.repository.name,
						issueNumber: event.issue.number,
						issueUrl: event.issue.url,
						issueTitle: "",
						issueLabels: [],
						senderLogin: event.requester.login,
						senderId: event.requester.externalId,
					},
					logger,
				);
				return action.run();
			}

			case "task_closed": {
				const action = new CloseTaskAction(
					this.options.taskRunner,
					github,
					handlerConfig,
					{
						owner: event.repository.owner,
						repo: event.repository.name,
						issueNumber: event.issue.number,
					},
					logger,
				);
				return action.run();
			}

			case "comment_posted": {
				if (event.target.kind === "pull_request") {
					const action = new PRCommentAction(
						this.options.taskRunner,
						github,
						handlerConfig,
						{
							owner: event.repository.owner,
							repo: event.repository.name,
							prNumber: event.target.number,
							prAuthor: event.target.authorLogin,
							commenterLogin: event.comment.authorLogin,
							commentId: event.comment.id,
							commentUrl: event.comment.url,
							commentBody: event.comment.body,
							commentCreatedAt: event.comment.createdAt,
							isReviewComment: event.comment.isReviewComment,
							isReviewSubmission: event.comment.isReviewSubmission,
							filePath: event.comment.filePath,
							lineNumber: event.comment.lineNumber,
						},
						logger,
					);
					return action.run();
				}

				// kind === "issue"
				const action = new IssueCommentAction(
					this.options.taskRunner,
					github,
					handlerConfig,
					{
						owner: event.repository.owner,
						repo: event.repository.name,
						issueNumber: event.target.number,
						commentId: event.comment.id,
						commenterLogin: event.comment.authorLogin,
						commentUrl: event.comment.url,
						commentBody: event.comment.body,
						commentCreatedAt: event.comment.createdAt,
					},
					logger,
				);
				return action.run();
			}

			case "check_failed": {
				const action = new FailedCheckAction(
					this.options.taskRunner,
					github,
					handlerConfig,
					{
						owner: event.repository.owner,
						repo: event.repository.name,
						runId: event.run.id,
						runUrl: event.run.url,
						headSha: event.run.headSha,
						workflowName: event.run.workflowName,
						workflowFile: event.run.workflowFile,
						pullRequests: event.pullRequestNumbers.map((n) => ({ number: n })),
					},
					logger,
				);
				return action.run();
			}
		}
	}
}
