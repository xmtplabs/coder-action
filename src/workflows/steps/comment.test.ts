import { describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../../config/app-config";
import type { CommentPostedEvent } from "../../events/types";
import { runComment } from "./comment";

function makeStep() {
	const calls: string[] = [];
	const step = {
		calls,
		do: vi.fn(async (name: string, ...rest: unknown[]) => {
			calls.push(name);
			const fn = rest[rest.length - 1] as () => Promise<unknown>;
			return fn();
		}),
		sleep: vi.fn(async () => {}),
	};
	return step;
}

const config = { coderTaskNamePrefix: "gh" } as unknown as AppConfig;

function commentEvent(
	kind: "pull_request" | "issue",
	overrides: Partial<CommentPostedEvent["comment"]> = {},
): CommentPostedEvent {
	return {
		type: "comment_posted",
		source: { type: "github", installationId: 1 },
		repository: { owner: "acme", name: "repo" },
		target: { kind, number: 42, authorLogin: "bob" },
		comment: {
			id: 1001,
			body: "hello",
			url: "u",
			createdAt: "2026-01-01",
			authorLogin: "bob",
			isReviewComment: false,
			isReviewSubmission: false,
			...overrides,
		},
	};
}

describe("runComment", () => {
	test("PR comment: locate → ensureReady → send → react (issue comment endpoint)", async () => {
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				owner_id: "owner-uuid",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			resumeWorkspace: vi.fn(async () => {}),
			getTaskById: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			addReactionToComment: vi.fn(async () => {}),
			addReactionToReviewComment: vi.fn(async () => {}),
		};

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("pull_request"),
		});

		// Order: locate-task → lookup-task (ensureTaskReady) → send-task-input → react-to-comment
		expect(step.calls[0]).toBe("locate-task");
		expect(step.calls).toContain("lookup-task"); // from ensureTaskReady
		expect(step.calls).toContain("send-task-input");
		expect(step.calls).toContain("react-to-comment");
		expect(github.addReactionToComment).toHaveBeenCalled();
		expect(github.addReactionToReviewComment).not.toHaveBeenCalled();
	});

	test("PR review comment uses review-comment reaction endpoint", async () => {
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				owner_id: "owner-uuid",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			resumeWorkspace: vi.fn(async () => {}),
			getTaskById: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			addReactionToComment: vi.fn(async () => {}),
			addReactionToReviewComment: vi.fn(async () => {}),
		};
		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("pull_request", { isReviewComment: true }),
		});
		expect(github.addReactionToReviewComment).toHaveBeenCalled();
		expect(github.addReactionToComment).not.toHaveBeenCalled();
	});

	test("issue comment: locate → ensureReady → send → react", async () => {
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				owner_id: "owner-uuid",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			resumeWorkspace: vi.fn(async () => {}),
			getTaskById: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			addReactionToComment: vi.fn(async () => {}),
			addReactionToReviewComment: vi.fn(async () => {}),
		};
		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("issue"),
		});
		expect(step.calls[0]).toBe("locate-task");
		expect(step.calls).toContain("send-task-input");
	});

	test("throws NonRetryableError when task not found", async () => {
		const { NonRetryableError } = await import("cloudflare:workflows");
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => null),
			resumeWorkspace: vi.fn(async () => {}),
			getTaskById: vi.fn(async () => ({})),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			addReactionToComment: vi.fn(async () => {}),
			addReactionToReviewComment: vi.fn(async () => {}),
		};
		await expect(
			runComment({
				step: step as never,
				coder: coder as never,
				github: github as never,
				config,
				event: commentEvent("pull_request"),
			}),
			// Assert the specific error type so a regression that throws a
			// generic Error (and thus gets retried by the engine instead of
			// terminating the instance) fails this test.
		).rejects.toThrowError(NonRetryableError);
	});

	test("PR review comment passes structured formatPRCommentMessage body with file:line to sendTaskInput", async () => {
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				owner_id: "owner-uuid",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			getTaskById: vi.fn(async () => ({
				id: "11111111-1111-1111-1111-111111111111",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-1",
			})),
			resumeWorkspace: vi.fn(async () => {}),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			addReactionToComment: vi.fn(async () => {}),
			addReactionToReviewComment: vi.fn(async () => {}),
		};

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("pull_request", {
				isReviewComment: true,
				body: "please handle this edge case",
				authorLogin: "alice",
				url: "https://github.com/acme/repo/pull/42#r-700",
				filePath: "src/foo.ts",
				lineNumber: 7,
			}),
		});

		// sendTaskInput should receive the STRUCTURED message, not the raw body.
		expect(coder.sendTaskInput).toHaveBeenCalledTimes(1);
		const call = coder.sendTaskInput.mock.calls[0] as unknown as [
			unknown,
			unknown,
			string,
		];
		const body = call[2];
		expect(body).toContain("New Comment on PR:");
		expect(body).toContain("[INSTRUCTIONS]");
		expect(body).toContain("[COMMENT]");
		// Commenter, body text, and the file:line context must all be wrapped in.
		expect(body).toContain("alice");
		expect(body).toContain("please handle this edge case");
		expect(body).toContain("File: src/foo.ts:7");
	});

	test("issue comment passes structured formatIssueCommentMessage body to sendTaskInput", async () => {
		const step = makeStep();
		const coder = {
			findTaskByName: vi.fn(async () => ({
				id: "22222222-2222-2222-2222-222222222222",
				owner_id: "owner-uuid",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-2",
			})),
			getTaskById: vi.fn(async () => ({
				id: "22222222-2222-2222-2222-222222222222",
				status: "active",
				current_state: { state: "idle" },
				workspace_id: "ws-2",
			})),
			resumeWorkspace: vi.fn(async () => {}),
			sendTaskInput: vi.fn(async () => {}),
		};
		const github = {
			addReactionToComment: vi.fn(async () => {}),
			addReactionToReviewComment: vi.fn(async () => {}),
		};

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("issue"),
		});

		expect(coder.sendTaskInput).toHaveBeenCalledTimes(1);
		const call = coder.sendTaskInput.mock.calls[0] as unknown as [
			unknown,
			unknown,
			string,
		];
		const body = call[2];
		expect(body).toContain("New Comment on Issue:");
		expect(body).toContain("[INSTRUCTIONS]");
		expect(body).toContain("[COMMENT]");
		// PR-only "File:" line MUST be absent from the issue message.
		expect(body).not.toContain("File:");
	});
});
