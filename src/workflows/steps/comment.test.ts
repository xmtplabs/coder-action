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
		).rejects.toThrow();
	});
});
