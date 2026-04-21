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

// ── Fixture factories ────────────────────────────────────────────────────────
//
// Tests share a fair amount of mock-client boilerplate; these helpers keep each
// test focused on the one thing it's asserting.

type CoderStub = {
	findTaskByName: ReturnType<typeof vi.fn>;
	resumeWorkspace: ReturnType<typeof vi.fn>;
	getTaskById: ReturnType<typeof vi.fn>;
	sendTaskInput: ReturnType<typeof vi.fn>;
};

type GithubStub = {
	addReactionToComment: ReturnType<typeof vi.fn>;
	addReactionToReviewComment: ReturnType<typeof vi.fn>;
	findLinkedIssues: ReturnType<typeof vi.fn>;
};

function makeCoder(overrides: Partial<CoderStub> = {}): CoderStub {
	return {
		findTaskByName: vi.fn(async () => ({
			id: "11111111-1111-4111-8111-111111111111",
			owner_id: "owner-uuid",
			status: "active",
			current_state: { state: "idle" },
			workspace_id: "ws-1",
		})),
		resumeWorkspace: vi.fn(async () => {}),
		getTaskById: vi.fn(async () => ({
			id: "11111111-1111-4111-8111-111111111111",
			status: "active",
			current_state: { state: "idle" },
			workspace_id: "ws-1",
		})),
		sendTaskInput: vi.fn(async () => {}),
		...overrides,
	};
}

function makeGithub(overrides: Partial<GithubStub> = {}): GithubStub {
	return {
		addReactionToComment: vi.fn(async () => {}),
		addReactionToReviewComment: vi.fn(async () => {}),
		findLinkedIssues: vi.fn(async () => [
			{
				number: 7,
				title: "Bug",
				state: "OPEN",
				url: "https://github.com/acme/repo/issues/7",
			},
		]),
		...overrides,
	};
}

function commentEvent(
	kind: "pull_request" | "issue",
	overrides: Partial<CommentPostedEvent["comment"]> = {},
	targetOverrides: Partial<CommentPostedEvent["target"]> = {},
): CommentPostedEvent {
	return {
		type: "comment_posted",
		source: { type: "github", installationId: 1 },
		repository: { owner: "acme", name: "repo" },
		target: { kind, number: 42, authorLogin: "bob", ...targetOverrides },
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

// ── Step sequencing + reaction routing ───────────────────────────────────────

describe("runComment — step order + reaction routing", () => {
	test("PR comment: find-linked-issues → locate-task → react → ensureReady → send", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("pull_request"),
		});

		// PR-kind comments resolve the linked issue FIRST, then locate the task.
		// react-to-comment fires BEFORE ensureTaskReady so users see the eyes
		// reaction without waiting on poll latency.
		expect(step.calls[0]).toBe("find-linked-issues");
		expect(step.calls[1]).toBe("locate-task");
		expect(step.calls[2]).toBe("react-to-comment");
		expect(step.calls).toContain("lookup-task"); // ensureTaskReady
		expect(step.calls).toContain("send-task-input");
		// react must appear BEFORE ensureTaskReady's lookup-task.
		const reactIdx = step.calls.indexOf("react-to-comment");
		const readyIdx = step.calls.indexOf("lookup-task");
		const sendIdx = step.calls.indexOf("send-task-input");
		expect(reactIdx).toBeLessThan(readyIdx);
		expect(readyIdx).toBeLessThan(sendIdx);
		expect(github.addReactionToComment).toHaveBeenCalled();
		expect(github.addReactionToReviewComment).not.toHaveBeenCalled();
	});

	test("issue comment: locate-task is the FIRST step (no find-linked-issues), then react → ensureReady → send", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("issue"),
		});

		// Issue-kind comments already have the issue number on event.target —
		// no linked-issue lookup needed, and calling findLinkedIssues for a
		// non-PR number would 404 on GitHub.
		expect(step.calls[0]).toBe("locate-task");
		expect(step.calls[1]).toBe("react-to-comment");
		expect(step.calls).not.toContain("find-linked-issues");
		expect(github.findLinkedIssues).not.toHaveBeenCalled();
		expect(step.calls).toContain("send-task-input");
		const reactIdx = step.calls.indexOf("react-to-comment");
		const readyIdx = step.calls.indexOf("lookup-task");
		const sendIdx = step.calls.indexOf("send-task-input");
		expect(reactIdx).toBeLessThan(readyIdx);
		expect(readyIdx).toBeLessThan(sendIdx);
	});

	test("PR review comment uses review-comment reaction endpoint", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();

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
});

// ── The regression guard: PR comment uses LINKED ISSUE number, not PR number ──

describe("runComment — task-name derivation (regression guard)", () => {
	test("PR comment: findTaskByName is called with {prefix}-{repo}-{linkedIssue}, NOT the PR number", async () => {
		const step = makeStep();
		const coder = makeCoder();
		// PR #42 with linked issue #7. Task must be keyed on 7, not 42.
		const github = makeGithub({
			findLinkedIssues: vi.fn(async () => [
				{
					number: 7,
					title: "Bug",
					state: "OPEN",
					url: "https://github.com/acme/repo/issues/7",
				},
			]),
		});

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("pull_request", {}, { number: 42 }),
		});

		expect(coder.findTaskByName).toHaveBeenCalledTimes(1);
		const [taskName] = coder.findTaskByName.mock.calls[0] as [string];
		expect(taskName).toBe("gh-repo-7");
		// Explicit negative: the task must NOT be keyed on the PR number.
		expect(taskName).not.toContain("-42");

		// GitHub linked-issue lookup was called with the PR number.
		expect(github.findLinkedIssues).toHaveBeenCalledWith("acme", "repo", 42);
	});

	test("PR comment with NO linked issue → silent early-return (no locate-task, no send)", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub({
			findLinkedIssues: vi.fn(async () => []),
		});

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("pull_request"),
		});

		expect(step.calls).toEqual(["find-linked-issues"]);
		expect(coder.findTaskByName).not.toHaveBeenCalled();
		expect(coder.sendTaskInput).not.toHaveBeenCalled();
		expect(github.addReactionToComment).not.toHaveBeenCalled();
	});

	test("issue comment: findTaskByName is called with {prefix}-{repo}-{event.target.number}", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("issue", {}, { number: 123 }),
		});

		expect(coder.findTaskByName).toHaveBeenCalledTimes(1);
		const [taskName] = coder.findTaskByName.mock.calls[0] as [string];
		expect(taskName).toBe("gh-repo-123");
	});
});

// ── Task-not-found + structured-message coverage ─────────────────────────────

describe("runComment — error paths + message formatting", () => {
	test("PR comment with no matching task → silent short-circuit (no throw, no send)", async () => {
		// Previously this path threw NonRetryableError, which surfaced the
		// instance as `errored` in workflow listings even though a comment on
		// an issue/PR without an associated Coder task is benign.
		const step = makeStep();
		const coder = makeCoder({ findTaskByName: vi.fn(async () => null) });
		const github = makeGithub();

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("pull_request"),
		});

		expect(step.calls).toEqual(["find-linked-issues", "locate-task"]);
		expect(coder.sendTaskInput).not.toHaveBeenCalled();
		expect(github.addReactionToComment).not.toHaveBeenCalled();
		expect(github.addReactionToReviewComment).not.toHaveBeenCalled();
	});

	test("issue comment with no matching task → silent short-circuit (no throw, no send)", async () => {
		const step = makeStep();
		const coder = makeCoder({ findTaskByName: vi.fn(async () => null) });
		const github = makeGithub();

		await runComment({
			step: step as never,
			coder: coder as never,
			github: github as never,
			config,
			event: commentEvent("issue"),
		});

		expect(step.calls).toEqual(["locate-task"]);
		expect(coder.sendTaskInput).not.toHaveBeenCalled();
		expect(github.addReactionToComment).not.toHaveBeenCalled();
		expect(github.addReactionToReviewComment).not.toHaveBeenCalled();
	});

	test("PR review comment: sendTaskInput receives structured formatPRCommentMessage with file:line", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();

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
		expect(body).toContain("alice");
		expect(body).toContain("please handle this edge case");
		expect(body).toContain("File: src/foo.ts:7");
	});

	test("issue comment: sendTaskInput receives structured formatIssueCommentMessage (no File: line)", async () => {
		const step = makeStep();
		const coder = makeCoder();
		const github = makeGithub();

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
		expect(body).not.toContain("File:");
	});
});
