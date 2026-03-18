import { describe, expect, mock, test } from "bun:test";
import { GitHubClient } from "./github-client";

function createMockOctokit(overrides: Record<string, unknown> = {}) {
	return {
		rest: {
			repos: {
				getCollaboratorPermissionLevel: mock(() =>
					Promise.resolve({ data: { permission: "write" } }),
				),
				...(overrides.repos as Record<string, unknown>),
			},
			issues: {
				listComments: mock(() => Promise.resolve({ data: [] })),
				createComment: mock(() => Promise.resolve({ data: { id: 1 } })),
				updateComment: mock(() => Promise.resolve({ data: { id: 1 } })),
				...(overrides.issues as Record<string, unknown>),
			},
			pulls: {
				list: mock(() => Promise.resolve({ data: [] })),
				get: mock(() =>
					Promise.resolve({
						data: {
							user: { login: "agent" },
							head: { sha: "abc123" },
						},
					}),
				),
				...(overrides.pulls as Record<string, unknown>),
			},
			actions: {
				listJobsForWorkflowRun: mock(() =>
					Promise.resolve({ data: { jobs: [] } }),
				),
				downloadJobLogsForWorkflowRun: mock(() =>
					Promise.resolve({ data: "log output" }),
				),
				...(overrides.actions as Record<string, unknown>),
			},
			reactions: {
				createForIssueComment: mock(() => Promise.resolve({ data: { id: 1 } })),
				...(overrides.reactions as Record<string, unknown>),
			},
		},
		graphql: mock(() => Promise.resolve({})),
		...overrides,
	} as unknown as ReturnType<typeof import("@actions/github").getOctokit>;
}

describe("GitHubClient", () => {
	describe("checkActorPermission", () => {
		test("returns true for users with write access", async () => {
			const octokit = createMockOctokit();
			const client = new GitHubClient(octokit);
			const result = await client.checkActorPermission("org", "repo", "writer");
			expect(result).toBe(true);
		});

		test("returns true for admins", async () => {
			const octokit = createMockOctokit({
				repos: {
					getCollaboratorPermissionLevel: mock(() =>
						Promise.resolve({ data: { permission: "admin" } }),
					),
				},
			});
			const client = new GitHubClient(octokit);
			const result = await client.checkActorPermission(
				"org",
				"repo",
				"admin-user",
			);
			expect(result).toBe(true);
		});

		test("returns false for read-only users", async () => {
			const octokit = createMockOctokit({
				repos: {
					getCollaboratorPermissionLevel: mock(() =>
						Promise.resolve({ data: { permission: "read" } }),
					),
				},
			});
			const client = new GitHubClient(octokit);
			const result = await client.checkActorPermission("org", "repo", "reader");
			expect(result).toBe(false);
		});

		test("returns false when user not found (404)", async () => {
			const octokit = createMockOctokit({
				repos: {
					getCollaboratorPermissionLevel: mock(() =>
						Promise.reject({ status: 404 }),
					),
				},
			});
			const client = new GitHubClient(octokit);
			const result = await client.checkActorPermission(
				"org",
				"repo",
				"outsider",
			);
			expect(result).toBe(false);
		});
	});

	describe("findLinkedIssues", () => {
		test("returns linked issues from PR", async () => {
			const octokit = createMockOctokit({
				graphql: mock(() =>
					Promise.resolve({
						repository: {
							pullRequest: {
								closingIssuesReferences: {
									nodes: [
										{
											number: 42,
											title: "Bug",
											state: "OPEN",
											url: "https://github.com/org/repo/issues/42",
										},
									],
								},
							},
						},
					}),
				),
			});
			const client = new GitHubClient(octokit);
			const issues = await client.findLinkedIssues("org", "repo", 1);
			expect(issues).toHaveLength(1);
			expect(issues[0].number).toBe(42);
		});

		test("returns empty array when no linked issues", async () => {
			const octokit = createMockOctokit({
				graphql: mock(() =>
					Promise.resolve({
						repository: {
							pullRequest: {
								closingIssuesReferences: { nodes: [] },
							},
						},
					}),
				),
			});
			const client = new GitHubClient(octokit);
			const issues = await client.findLinkedIssues("org", "repo", 1);
			expect(issues).toHaveLength(0);
		});
	});

	describe("commentOnIssue", () => {
		test("creates new comment when none exists", async () => {
			const octokit = createMockOctokit();
			const client = new GitHubClient(octokit);
			await client.commentOnIssue(
				"org",
				"repo",
				42,
				"Task created: url",
				"Task created:",
			);
			expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
		});

		test("updates existing comment with matching prefix", async () => {
			const octokit = createMockOctokit({
				issues: {
					listComments: mock(() =>
						Promise.resolve({
							data: [{ id: 99, body: "Task created: old-url" }],
						}),
					),
					updateComment: mock(() => Promise.resolve({ data: { id: 99 } })),
					createComment: mock(() => Promise.resolve({ data: { id: 1 } })),
				},
			});
			const client = new GitHubClient(octokit);
			await client.commentOnIssue(
				"org",
				"repo",
				42,
				"Task created: new-url",
				"Task created:",
			);
			expect(octokit.rest.issues.updateComment).toHaveBeenCalledTimes(1);
		});
	});

	describe("findPRByHeadSHA", () => {
		test("returns PR when found", async () => {
			const octokit = createMockOctokit({
				pulls: {
					list: mock(() =>
						Promise.resolve({
							data: [
								{
									number: 5,
									user: { login: "agent" },
									head: { sha: "abc" },
								},
							],
						}),
					),
				},
			});
			const client = new GitHubClient(octokit);
			const pr = await client.findPRByHeadSHA("org", "repo", "abc");
			expect(pr).not.toBeNull();
			expect(pr?.number).toBe(5);
		});

		test("returns null when no PR found", async () => {
			const octokit = createMockOctokit();
			const client = new GitHubClient(octokit);
			const pr = await client.findPRByHeadSHA("org", "repo", "deadbeef");
			expect(pr).toBeNull();
		});
	});

	describe("getFailedJobs", () => {
		test("returns only failed jobs", async () => {
			const octokit = createMockOctokit({
				actions: {
					listJobsForWorkflowRun: mock(() =>
						Promise.resolve({
							data: {
								jobs: [
									{ id: 1, name: "build", conclusion: "failure" },
									{ id: 2, name: "lint", conclusion: "success" },
									{ id: 3, name: "test", conclusion: "failure" },
								],
							},
						}),
					),
					downloadJobLogsForWorkflowRun: mock(() =>
						Promise.resolve({ data: "line1\nline2\nline3" }),
					),
				},
			});
			const client = new GitHubClient(octokit);
			const jobs = await client.getFailedJobs("org", "repo", 100);
			expect(jobs).toHaveLength(2);
			expect(jobs[0].name).toBe("build");
			expect(jobs[1].name).toBe("test");
		});
	});

	describe("addReactionToComment", () => {
		test("adds eyes reaction to comment", async () => {
			const octokit = createMockOctokit();
			const client = new GitHubClient(octokit);
			await client.addReactionToComment("org", "repo", 42);
			expect(octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith(
				{
					owner: "org",
					repo: "repo",
					comment_id: 42,
					content: "eyes",
				},
			);
		});
	});

	describe("getJobLogs", () => {
		test("truncates to last N lines", async () => {
			const longLog = Array.from(
				{ length: 200 },
				(_, i) => `line ${i + 1}`,
			).join("\n");
			const octokit = createMockOctokit({
				actions: {
					downloadJobLogsForWorkflowRun: mock(() =>
						Promise.resolve({ data: longLog }),
					),
				},
			});
			const client = new GitHubClient(octokit);
			const log = await client.getJobLogs("org", "repo", 1, 100);
			const lines = log.split("\n");
			expect(lines.length).toBe(100);
			expect(lines[0]).toBe("line 101");
		});
	});
});
