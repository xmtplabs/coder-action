import * as core from "@actions/core";
import * as github from "@actions/github";
import { RealCoderClient } from "./coder-client";
import { GitHubClient } from "./github-client";
import {
	parseInputs,
	type ActionOutputs,
	type ResolvedInputs,
} from "./schemas";
import { CreateTaskHandler } from "./handlers/create-task";
import { CloseTaskHandler } from "./handlers/close-task";
import { PRCommentHandler } from "./handlers/pr-comment";
import { IssueCommentHandler } from "./handlers/issue-comment";
import { FailedCheckHandler } from "./handlers/failed-check";

function requirePayload<T>(
	value: T | null | undefined,
	name: string,
): NonNullable<T> {
	if (value == null) {
		throw new Error(`Expected payload.${name} but it was missing`);
	}
	return value;
}

async function run(): Promise<void> {
	try {
		const rawInputs = {
			action: core.getInput("action", { required: true }),
			coderURL: core.getInput("coder-url", { required: true }),
			coderToken: core.getInput("coder-token", { required: true }),
			coderTaskNamePrefix: core.getInput("coder-task-name-prefix") || undefined,
			coderTemplateName: core.getInput("coder-template-name") || undefined,
			coderTemplatePreset: core.getInput("coder-template-preset") || undefined,
			coderOrganization: core.getInput("coder-organization") || undefined,
			prompt: core.getInput("prompt") || undefined,
			githubToken:
				core.getInput("github-token") || process.env.GITHUB_TOKEN || "",
			coderGithubUsername: core.getInput("coder-github-username") || undefined,
		};

		core.setSecret(rawInputs.coderToken);

		const inputs = parseInputs(rawInputs);
		const context = github.context;

		const coder = new RealCoderClient(inputs.coderURL, inputs.coderToken);
		const octokit = github.getOctokit(inputs.githubToken);
		const gh = new GitHubClient(octokit);

		// Resolve the Coder username from the GitHub sender's ID.
		// The sender is the person who triggered the workflow (e.g. assigned the issue).
		// Their GitHub account is linked to Coder via GitHub OAuth.
		const sender = requirePayload(context.payload.sender, "sender");
		const senderGithubId = sender.id as number;
		core.info(
			`Resolving Coder user for GitHub user ${sender.login} (ID: ${senderGithubId})`,
		);
		const coderUser = await coder.getCoderUserByGitHubId(senderGithubId);
		core.info(`Resolved Coder username: ${coderUser.username}`);

		// Override coderUsername with the resolved value
		const resolvedInputs: ResolvedInputs = {
			...inputs,
			coderUsername: coderUser.username,
		};

		let result: ActionOutputs;

		switch (resolvedInputs.action) {
			case "create_task": {
				const issue = requirePayload(context.payload.issue, "issue");
				const handler = new CreateTaskHandler(coder, gh, resolvedInputs, {
					owner: context.repo.owner,
					repo: context.repo.repo,
					issueNumber: issue.number,
					issueUrl: issue.html_url as string,
					senderLogin: sender.login as string,
				});
				result = await handler.run();
				break;
			}
			case "close_task": {
				const issue = requirePayload(context.payload.issue, "issue");
				const handler = new CloseTaskHandler(coder, gh, resolvedInputs, {
					owner: context.repo.owner,
					repo: context.repo.repo,
					issueNumber: issue.number,
				});
				result = await handler.run();
				break;
			}
			case "pr_comment": {
				const issue = requirePayload(context.payload.issue, "issue");
				const comment = requirePayload(context.payload.comment, "comment");
				const handler = new PRCommentHandler(coder, gh, resolvedInputs, {
					owner: context.repo.owner,
					repo: context.repo.repo,
					prNumber: issue.number,
					prAuthor: issue.user.login,
					commenterLogin: comment.user.login,
					commentUrl: comment.html_url,
					commentBody: comment.body,
					commentCreatedAt: comment.created_at,
				});
				result = await handler.run();
				break;
			}
			case "issue_comment": {
				const issue = requirePayload(context.payload.issue, "issue");
				const comment = requirePayload(context.payload.comment, "comment");
				const handler = new IssueCommentHandler(coder, gh, resolvedInputs, {
					owner: context.repo.owner,
					repo: context.repo.repo,
					issueNumber: issue.number,
					commenterLogin: comment.user.login,
					commentUrl: comment.html_url,
					commentBody: comment.body,
					commentCreatedAt: comment.created_at,
				});
				result = await handler.run();
				break;
			}
			case "failed_check": {
				const workflowRun = requirePayload(
					context.payload.workflow_run,
					"workflow_run",
				);
				const handler = new FailedCheckHandler(coder, gh, resolvedInputs, {
					owner: context.repo.owner,
					repo: context.repo.repo,
					runId: workflowRun.id,
					runUrl: workflowRun.html_url,
					headSha: workflowRun.head_sha,
					workflowName: workflowRun.name,
					workflowFile: workflowRun.path?.split("/").pop() ?? "unknown",
					pullRequests: workflowRun.pull_requests ?? [],
				});
				result = await handler.run();
				break;
			}
			default:
				throw new Error(
					`Unknown action: ${(inputs as { action: string }).action}`,
				);
		}

		if (result.taskName) core.setOutput("task-name", result.taskName);
		if (result.taskUrl) core.setOutput("task-url", result.taskUrl);
		if (result.taskStatus) core.setOutput("task-status", result.taskStatus);
		core.setOutput("skipped", String(result.skipped));
		if (result.skipReason) core.setOutput("skip-reason", result.skipReason);
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	}
}

run();
