import type { Logger } from "./logger";
import type { Octokit as OctokitRest } from "@octokit/rest";

export type Octokit = OctokitRest;

export interface LinkedIssue {
	number: number;
	title: string;
	state: string;
	url: string;
}

export interface FailedJob {
	id: number;
	name: string;
	conclusion: string;
}

export interface PRInfo {
	number: number;
	user: { login: string };
	head: { sha: string };
}

export class GitHubClient {
	constructor(
		private readonly octokit: Octokit,
		private readonly logger: Logger,
	) {}

	async checkActorPermission(
		owner: string,
		repo: string,
		username: string,
	): Promise<boolean> {
		try {
			const { data } =
				await this.octokit.rest.repos.getCollaboratorPermissionLevel({
					owner,
					repo,
					username,
				});
			const allowed = new Set(["admin", "write"]);
			return allowed.has(data.permission);
		} catch (error: unknown) {
			const err = error as { status?: number };
			if (err?.status === 404) return false;
			throw error;
		}
	}

	async findLinkedIssues(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<LinkedIssue[]> {
		const result = await (
			this.octokit as unknown as {
				graphql: <T>(
					query: string,
					variables: Record<string, unknown>,
				) => Promise<T>;
			}
		).graphql<{
			repository: {
				pullRequest: {
					closingIssuesReferences: { nodes: LinkedIssue[] };
				};
			};
		}>(
			`query($owner: String!, $repo: String!, $pr: Int!) {
				repository(owner: $owner, name: $repo) {
					pullRequest(number: $pr) {
						closingIssuesReferences(first: 10) {
							nodes { number title state url }
						}
					}
				}
			}`,
			{ owner, repo, pr: prNumber },
		);
		return result.repository.pullRequest.closingIssuesReferences.nodes;
	}

	async commentOnIssue(
		owner: string,
		repo: string,
		issueNumber: number,
		body: string,
		matchPrefix: string,
	): Promise<void> {
		const { data: comments } = await this.octokit.rest.issues.listComments({
			owner,
			repo,
			issue_number: issueNumber,
		});

		const existing = [...comments]
			.reverse()
			.find((c: { body?: string | null }) => c.body?.startsWith(matchPrefix));

		if (existing) {
			await this.octokit.rest.issues.updateComment({
				owner,
				repo,
				comment_id: existing.id,
				body,
			});
		} else {
			await this.octokit.rest.issues.createComment({
				owner,
				repo,
				issue_number: issueNumber,
				body,
			});
		}
	}

	async findPRByHeadSHA(
		owner: string,
		repo: string,
		sha: string,
	): Promise<PRInfo | null> {
		const { data: prs } = await this.octokit.rest.pulls.list({
			owner,
			repo,
			state: "open",
			sort: "updated",
			direction: "desc",
			per_page: 10,
		});
		const match = prs.find(
			(pr: { head: { sha: string } }) => pr.head.sha === sha,
		);
		if (!match) return null;
		return {
			number: match.number,
			user: match.user as { login: string },
			head: match.head as { sha: string },
		};
	}

	async getPR(owner: string, repo: string, prNumber: number): Promise<PRInfo> {
		const { data } = await this.octokit.rest.pulls.get({
			owner,
			repo,
			pull_number: prNumber,
		});
		return {
			number: data.number,
			user: data.user as { login: string },
			head: data.head as { sha: string },
		};
	}

	async getFailedJobs(
		owner: string,
		repo: string,
		runId: number,
	): Promise<FailedJob[]> {
		const { data } = await this.octokit.rest.actions.listJobsForWorkflowRun({
			owner,
			repo,
			run_id: runId,
		});
		return (
			data.jobs as Array<{
				id: number;
				name: string;
				conclusion: string | null;
			}>
		)
			.filter((j) => j.conclusion === "failure")
			.map((j) => ({
				id: j.id,
				name: j.name,
				conclusion: j.conclusion as string,
			}));
	}

	async getJobLogs(
		owner: string,
		repo: string,
		jobId: number,
		maxLines = 100,
	): Promise<string> {
		const { data } =
			await this.octokit.rest.actions.downloadJobLogsForWorkflowRun({
				owner,
				repo,
				job_id: jobId,
			});
		const log = data as string;
		const lines = log.split("\n");
		if (lines.length <= maxLines) return log;
		return lines.slice(-maxLines).join("\n");
	}

	async addReactionToComment(
		owner: string,
		repo: string,
		commentId: number,
	): Promise<void> {
		try {
			await this.octokit.rest.reactions.createForIssueComment({
				owner,
				repo,
				comment_id: commentId,
				content: "eyes",
			});
		} catch (error: unknown) {
			this.logger.warning(
				`Failed to add reaction to comment ${commentId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async addReactionToReviewComment(
		owner: string,
		repo: string,
		commentId: number,
	): Promise<void> {
		try {
			await this.octokit.rest.reactions.createForPullRequestReviewComment({
				owner,
				repo,
				comment_id: commentId,
				content: "eyes",
			});
		} catch (error: unknown) {
			this.logger.warning(
				`Failed to add reaction to review comment ${commentId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
