import { env, introspectWorkflowInstance } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";
import type {
	CheckFailedEvent,
	CommentPostedEvent,
	ConfigPushEvent,
	TaskClosedEvent,
	TaskRequestedEvent,
} from "../events/types";
import { TaskRunnerWorkflow } from "./task-runner-workflow";

// ── Smoke: binding shape ─────────────────────────────────────────────────────

describe("TaskRunnerWorkflow", () => {
	test("class is exported and its name matches wrangler.toml class_name", () => {
		// A rename would orphan in-flight instances — this guards against that.
		expect(typeof TaskRunnerWorkflow).toBe("function");
		expect(TaskRunnerWorkflow.name).toBe("TaskRunnerWorkflow");
	});

	test("env.TASK_RUNNER_WORKFLOW binding exists and is callable", () => {
		expect(env.TASK_RUNNER_WORKFLOW).toBeDefined();
		expect(typeof env.TASK_RUNNER_WORKFLOW.create).toBe("function");
	});
});

// ── Introspection-driven per-event tests ─────────────────────────────────────
//
// Each test:
//   1. Registers an introspector BEFORE creating the instance so every step.do
//      result and step.sleep call is mocked (no live Coder / GitHub fetches).
//   2. Uses `await using` for automatic disposal (see src/testing/AGENTS.md).
//   3. Creates the workflow instance with a representative `Event` payload.
//   4. Asserts the instance reaches the `complete` status.

describe("TaskRunnerWorkflow dispatch — task_requested", () => {
	test("executes lookup → permission → create → comment and completes", async () => {
		const instanceId = "task_requested-repo-1-test-delivery";
		await using instance = await introspectWorkflowInstance(
			env.TASK_RUNNER_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "lookup-coder-user" }, "coder-user");
			await m.mockStepResult({ name: "check-github-permission" }, true);
			await m.mockStepResult(
				{ name: "create-coder-task" },
				{
					taskName: "gh-repo-1",
					owner: "coder-user",
					taskId: "11111111-1111-4111-8111-111111111111",
					url: "https://coder.example.com/tasks/coder-user/abc",
					status: "ready",
				},
			);
			await m.mockStepResult({ name: "comment-on-issue" }, {});
			// waitForTaskActive pre-poll hits 'active' → fast-path, no loop steps.
			await m.mockStepResult(
				{ name: "wait-lookup-task" },
				{ status: "active" },
			);
			await m.mockStepResult({ name: "update-status-comment" }, {});
		});

		const params: TaskRequestedEvent = {
			type: "task_requested",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			issue: {
				id: 1001,
				number: 1,
				url: "https://github.com/acme/repo/issues/1",
			},
			requester: { login: "alice", externalId: 42 },
		};
		await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});

	// Early-return on `check-github-permission === false` is covered by
	// `src/workflows/steps/create-task.test.ts` (unit test with a fake step).
	// Workflow-introspection-level coverage is omitted because miniflare's
	// `mockStepResult` stores falsy values (`false`, `null`) in a way that the
	// workflow engine treats as "no mock set" — the real callback then runs and
	// hits the live GitHub API. This is a pool-workers/miniflare limitation,
	// not a defect in our workflow logic.

	test("run() binds instanceId onto logger so step emissions carry it", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			const instanceId = "task_requested-repo-1-trace-delivery";
			await using instance = await introspectWorkflowInstance(
				env.TASK_RUNNER_WORKFLOW,
				instanceId,
			);
			await instance.modify(async (m) => {
				await m.disableSleeps();
				await m.mockStepResult({ name: "lookup-coder-user" }, "coder-user");
				await m.mockStepResult({ name: "check-github-permission" }, true);
				await m.mockStepResult(
					{ name: "create-coder-task" },
					{
						taskName: "gh-repo-1",
						owner: "coder-user",
						taskId: "11111111-1111-4111-8111-111111111111",
						url: "https://coder.example.com/tasks/coder-user/abc",
						status: "ready",
					},
				);
				await m.mockStepResult({ name: "comment-on-issue" }, {});
				await m.mockStepResult(
					{ name: "wait-lookup-task" },
					{ status: "active" },
				);
				await m.mockStepResult({ name: "update-status-comment" }, {});
			});

			const params: TaskRequestedEvent = {
				type: "task_requested",
				source: { type: "github", installationId: 1 },
				repository: { owner: "acme", name: "repo" },
				issue: {
					id: 1001,
					number: 1,
					url: "https://github.com/acme/repo/issues/1",
				},
				requester: { login: "alice", externalId: 42 },
			};
			await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
			await instance.waitForStatus("complete");

			const withInstanceId = spy.mock.calls
				.map((c) => c[0])
				.filter((s): s is string => typeof s === "string")
				.map((s) => {
					try {
						return JSON.parse(s);
					} catch {
						return null;
					}
				})
				.filter((o): o is Record<string, unknown> => o !== null)
				.filter((o) => o.instanceId === instanceId);

			expect(withInstanceId.length).toBeGreaterThan(0);
		} finally {
			spy.mockRestore();
		}
	});

	test("run() propagates source.trace fields (rayId/traceId/spanId) onto logger", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			const instanceId = "task_requested-repo-1-trace-propagated";
			await using instance = await introspectWorkflowInstance(
				env.TASK_RUNNER_WORKFLOW,
				instanceId,
			);
			await instance.modify(async (m) => {
				await m.disableSleeps();
				await m.mockStepResult({ name: "lookup-coder-user" }, "coder-user");
				await m.mockStepResult({ name: "check-github-permission" }, true);
				await m.mockStepResult(
					{ name: "create-coder-task" },
					{
						taskName: "gh-repo-1",
						owner: "coder-user",
						taskId: "22222222-2222-4222-8222-222222222222",
						url: "https://coder.example.com/tasks/coder-user/abc",
						status: "ready",
					},
				);
				await m.mockStepResult({ name: "comment-on-issue" }, {});
				await m.mockStepResult(
					{ name: "wait-lookup-task" },
					{ status: "active" },
				);
				await m.mockStepResult({ name: "update-status-comment" }, {});
			});

			const params: TaskRequestedEvent = {
				type: "task_requested",
				source: {
					type: "github",
					installationId: 1,
					trace: {
						rayId: "8a1-SJC",
						traceId: "0af7651916cd43dd8448eb211c80319c",
						spanId: "b7ad6b7169203331",
					},
				},
				repository: { owner: "acme", name: "repo" },
				issue: {
					id: 1001,
					number: 1,
					url: "https://github.com/acme/repo/issues/1",
				},
				requester: { login: "alice", externalId: 42 },
			};
			await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
			await instance.waitForStatus("complete");

			const matching = spy.mock.calls
				.map((c) => c[0])
				.filter((s): s is string => typeof s === "string")
				.map((s) => {
					try {
						return JSON.parse(s);
					} catch {
						return null;
					}
				})
				.filter((o): o is Record<string, unknown> => o !== null)
				.filter((o) => o.instanceId === instanceId);

			expect(matching.length).toBeGreaterThan(0);
			const first = matching[0];
			expect(first).toBeDefined();
			expect(first?.rayId).toBe("8a1-SJC");
			expect(first?.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
			expect(first?.spanId).toBe("b7ad6b7169203331");
		} finally {
			spy.mockRestore();
		}
	});

	test("run() omits rayId/traceId/spanId when source.trace is absent", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			const instanceId = "task_requested-repo-1-no-trace";
			await using instance = await introspectWorkflowInstance(
				env.TASK_RUNNER_WORKFLOW,
				instanceId,
			);
			await instance.modify(async (m) => {
				await m.disableSleeps();
				await m.mockStepResult({ name: "lookup-coder-user" }, "coder-user");
				await m.mockStepResult({ name: "check-github-permission" }, true);
				await m.mockStepResult(
					{ name: "create-coder-task" },
					{
						taskName: "gh-repo-1",
						owner: "coder-user",
						taskId: "33333333-3333-4333-8333-333333333333",
						url: "https://coder.example.com/tasks/coder-user/abc",
						status: "ready",
					},
				);
				await m.mockStepResult({ name: "comment-on-issue" }, {});
				await m.mockStepResult(
					{ name: "wait-lookup-task" },
					{ status: "active" },
				);
				await m.mockStepResult({ name: "update-status-comment" }, {});
			});

			const params: TaskRequestedEvent = {
				type: "task_requested",
				source: { type: "github", installationId: 1 },
				repository: { owner: "acme", name: "repo" },
				issue: {
					id: 1001,
					number: 1,
					url: "https://github.com/acme/repo/issues/1",
				},
				requester: { login: "alice", externalId: 42 },
			};
			await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
			await instance.waitForStatus("complete");

			const matching = spy.mock.calls
				.map((c) => c[0])
				.filter((s): s is string => typeof s === "string")
				.map((s) => {
					try {
						return JSON.parse(s);
					} catch {
						return null;
					}
				})
				.filter((o): o is Record<string, unknown> => o !== null)
				.filter((o) => o.instanceId === instanceId);

			expect(matching.length).toBeGreaterThan(0);
			for (const entry of matching) {
				expect("rayId" in entry).toBe(false);
				expect("traceId" in entry).toBe(false);
				expect("spanId" in entry).toBe(false);
			}
		} finally {
			spy.mockRestore();
		}
	});
});

describe("TaskRunnerWorkflow dispatch — task_closed", () => {
	test("executes delete → comment and completes", async () => {
		const instanceId = "task_closed-repo-1-test-delivery";
		await using instance = await introspectWorkflowInstance(
			env.TASK_RUNNER_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "delete-coder-task" }, { deleted: true });
			await m.mockStepResult({ name: "comment-on-issue" }, {});
		});

		const params: TaskClosedEvent = {
			type: "task_closed",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			issue: { number: 1 },
		};
		await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});

	test("no-op when task not found (deleted: false) — comment step is skipped", async () => {
		const instanceId = "task_closed-repo-2-noop";
		await using instance = await introspectWorkflowInstance(
			env.TASK_RUNNER_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "delete-coder-task" }, { deleted: false });
			// comment-on-issue deliberately NOT mocked — if the workflow tried
			// to run it unmocked it would fail, exposing a regression.
		});

		const params: TaskClosedEvent = {
			type: "task_closed",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			issue: { number: 2 },
		};
		await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});
});

describe("TaskRunnerWorkflow dispatch — comment_posted", () => {
	test("issue-kind comment: locate → ensureReady → send → react completes", async () => {
		const instanceId = "comment_posted-repo-1-issue";
		await using instance = await introspectWorkflowInstance(
			env.TASK_RUNNER_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult(
				{ name: "locate-task" },
				{ taskId: "11111111-1111-4111-8111-111111111111", owner: "coder-user" },
			);
			// ensureTaskReady fast-path: lookup-task returns active+idle → early return
			await m.mockStepResult(
				{ name: "lookup-task" },
				{ status: "active", state: "idle", workspaceId: "ws-1" },
			);
			await m.mockStepResult({ name: "react-to-comment" }, {});
			await m.mockStepResult({ name: "send-task-input" }, {});
		});

		const params: CommentPostedEvent = {
			type: "comment_posted",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			target: { kind: "issue", number: 1, authorLogin: "alice" },
			comment: {
				id: 100,
				body: "please also handle the edge case",
				url: "https://github.com/acme/repo/issues/1#issuecomment-100",
				createdAt: "2026-04-18T00:00:00Z",
				authorLogin: "alice",
				isReviewComment: false,
				isReviewSubmission: false,
			},
		};
		await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});

	test("pr-kind review comment dispatches react-to-review-comment variant", async () => {
		const instanceId = "comment_posted-repo-2-pr-review";
		await using instance = await introspectWorkflowInstance(
			env.TASK_RUNNER_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			// PR-kind comments resolve the linked issue first — the task is
			// keyed on the issue number, not the PR number.
			await m.mockStepResult({ name: "find-linked-issues" }, [{ number: 7 }]);
			await m.mockStepResult(
				{ name: "locate-task" },
				{ taskId: "22222222-2222-4222-8222-222222222222", owner: "coder-user" },
			);
			await m.mockStepResult(
				{ name: "lookup-task" },
				{ status: "active", state: "idle", workspaceId: "ws-2" },
			);
			await m.mockStepResult({ name: "react-to-comment" }, {});
			await m.mockStepResult({ name: "send-task-input" }, {});
		});

		const params: CommentPostedEvent = {
			type: "comment_posted",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			target: {
				kind: "pull_request",
				number: 42,
				authorLogin: "xmtp-coder-agent",
			},
			comment: {
				id: 200,
				body: "fix the linter error at src/foo.ts:5",
				url: "https://github.com/acme/repo/pull/42#discussion_r200",
				createdAt: "2026-04-18T00:00:00Z",
				authorLogin: "bob",
				isReviewComment: true,
				isReviewSubmission: false,
				filePath: "src/foo.ts",
				lineNumber: 5,
			},
		};
		await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});

	test("paused task triggers resume step in ensureTaskReady pre-poll dispatch", async () => {
		const instanceId = "comment_posted-repo-3-paused-resume";
		await using instance = await introspectWorkflowInstance(
			env.TASK_RUNNER_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult(
				{ name: "locate-task" },
				{ taskId: "33333333-3333-4333-8333-333333333333", owner: "coder-user" },
			);
			// Pre-poll sees paused → triggers resume → first poll sees idle
			await m.mockStepResult(
				{ name: "lookup-task" },
				{ status: "paused", state: null, workspaceId: "ws-3" },
			);
			await m.mockStepResult({ name: "resume-paused-task" }, {});
			await m.mockStepResult(
				{ name: "check-status-1" },
				{ status: "active", state: "idle" },
			);
			await m.mockStepResult({ name: "react-to-comment" }, {});
			await m.mockStepResult({ name: "send-task-input" }, {});
		});

		const params: CommentPostedEvent = {
			type: "comment_posted",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			target: { kind: "issue", number: 3, authorLogin: "alice" },
			comment: {
				id: 300,
				body: "anything",
				url: "https://github.com/acme/repo/issues/3#issuecomment-300",
				createdAt: "2026-04-18T00:00:00Z",
				authorLogin: "alice",
				isReviewComment: false,
				isReviewSubmission: false,
			},
		};
		await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});
});

describe("TaskRunnerWorkflow dispatch — check_failed", () => {
	test("fetches PR → linked issues → locate task → logs → send, completes", async () => {
		const instanceId = "check_failed-repo-1-test-delivery";
		await using instance = await introspectWorkflowInstance(
			env.TASK_RUNNER_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult(
				{ name: "fetch-pr-info" },
				{
					number: 42,
					authorLogin: "xmtp-coder-agent",
					headSha: "abc123",
				},
			);
			await m.mockStepResult({ name: "find-linked-issues" }, [{ number: 1 }]);
			await m.mockStepResult(
				{ name: "locate-task" },
				{ taskId: "44444444-4444-4444-8444-444444444444", owner: "coder-user" },
			);
			await m.mockStepResult({ name: "fetch-failed-jobs" }, [
				{ id: 7, name: "test", conclusion: "failure" },
			]);
			await m.mockStepResult(
				{ name: "fetch-job-logs-7" },
				"Error: test failed\n",
			);
			await m.mockStepResult(
				{ name: "lookup-task" },
				{ status: "active", state: "idle", workspaceId: "ws-4" },
			);
			await m.mockStepResult({ name: "send-task-input" }, {});
		});

		const params: CheckFailedEvent = {
			type: "check_failed",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			run: {
				id: 999,
				url: "https://github.com/acme/repo/actions/runs/999",
				headSha: "abc123",
				workflowName: "CI",
				workflowFile: "ci.yml",
			},
			pullRequestNumbers: [42],
		};
		await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});

	// Early-return on `fetch-pr-info === null` is covered by
	// `src/workflows/steps/failed-check.test.ts` (unit test). Omitting the
	// workflow-introspection variant for the same reason as task_requested
	// above: miniflare's `mockStepResult` treats `null` as "no mock set".
});

describe("TaskRunnerWorkflow guards — config_push", () => {
	test("config_push payload is rejected by TaskRunnerWorkflow (wrong workflow)", async () => {
		const instanceId = "config_push-wrongly-dispatched";
		await using instance = await introspectWorkflowInstance(
			env.TASK_RUNNER_WORKFLOW,
			instanceId,
		);
		await instance.modify(async (m) => {
			await m.disableSleeps();
		});
		const params: ConfigPushEvent = {
			type: "config_push",
			source: { type: "github", installationId: 1 },
			repository: {
				id: 1,
				owner: "a",
				name: "r",
				fullName: "a/r",
				defaultBranch: "main",
			},
			head: { sha: "abc", ref: "refs/heads/main" },
		};
		await env.TASK_RUNNER_WORKFLOW.create({ id: instanceId, params });
		await expect(instance.waitForStatus("errored")).resolves.not.toThrow();
	});
});
