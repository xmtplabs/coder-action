import { describe, expect, test } from "vitest";
import type { ConfigPushEvent, Event } from "../events/types";
import { buildInstanceId, isDuplicateInstanceError } from "./instance-id";

describe("buildInstanceId", () => {
	test("task_requested → '{type}-{repo}-{issue}-{delivery}'", () => {
		const event: Event = {
			type: "task_requested",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			issue: { number: 42, url: "u" },
			requester: { login: "u", externalId: 1 },
		};
		const id = buildInstanceId(event, "abc-123");
		expect(id).toBe("task_requested-repo-42-abc-123");
	});

	test("task_closed includes issue number", () => {
		const event: Event = {
			type: "task_closed",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			issue: { number: 7 },
		};
		const id = buildInstanceId(event, "d");
		expect(id).toBe("task_closed-repo-7-d");
	});

	test("comment_posted uses target.number", () => {
		const event: Event = {
			type: "comment_posted",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			target: { kind: "pull_request", number: 99, authorLogin: "alice" },
			comment: {
				id: 1,
				body: "hi",
				url: "u",
				createdAt: "2026-01-01",
				authorLogin: "alice",
				isReviewComment: false,
				isReviewSubmission: false,
			},
		};
		const id = buildInstanceId(event, "d");
		expect(id).toBe("comment_posted-repo-99-d");
	});

	test("check_failed with no PR → 'check_failed-{runId}-{delivery}' (sanitized)", () => {
		const event: Event = {
			type: "check_failed",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			run: {
				id: 999,
				url: "u",
				headSha: "sha",
				workflowName: "wf",
				workflowFile: "f.yml",
			},
			pullRequestNumbers: [],
		};
		const id = buildInstanceId(event, "delivery-xyz");
		// `_` in event.type is sanitized to `-` by the charset regex.
		expect(id).toBe("check_failed-999-delivery-xyz");
	});

	test("check_failed WITH PR → 'check_failed-repo-{prNumber}-{delivery}'", () => {
		const event: Event = {
			type: "check_failed",
			source: { type: "github", installationId: 1 },
			repository: { owner: "acme", name: "repo" },
			run: {
				id: 999,
				url: "u",
				headSha: "sha",
				workflowName: "wf",
				workflowFile: "f.yml",
			},
			pullRequestNumbers: [5],
		};
		const id = buildInstanceId(event, "d");
		expect(id).toBe("check_failed-repo-5-d");
	});

	test("sanitizes disallowed characters to '-'", () => {
		const event: Event = {
			type: "task_requested",
			source: { type: "github", installationId: 1 },
			repository: { owner: "ACME", name: "Repo.With.Dots" },
			issue: { number: 1, url: "u" },
			requester: { login: "u", externalId: 1 },
		};
		const id = buildInstanceId(event, "d/e/l");
		expect(id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
	});

	test("truncates to 64 chars", () => {
		const event: Event = {
			type: "task_requested",
			source: { type: "github", installationId: 1 },
			repository: { owner: "o", name: "a".repeat(100) },
			issue: { number: 1, url: "u" },
			requester: { login: "u", externalId: 1 },
		};
		const id = buildInstanceId(event, "d");
		expect(id.length).toBeLessThanOrEqual(64);
	});
});

const baseConfigPush: ConfigPushEvent = {
	type: "config_push",
	source: { type: "github", installationId: 1 },
	repository: {
		id: 1,
		owner: "acme",
		name: "repo",
		fullName: "acme/repo",
		defaultBranch: "main",
	},
	head: {
		sha: "abcdef1234567890abcdef1234567890abcdef12",
		ref: "refs/heads/main",
	},
};

describe("buildInstanceId — config_push", () => {
	test("composite includes event type, repo name, head SHA, delivery ID", () => {
		const id = buildInstanceId(baseConfigPush, "delivery-xyz");
		expect(id.startsWith("config_push-repo-")).toBe(true);
		expect(id).toContain("abcdef1234567890");
	});
	test("length is <= 64 after sanitize + truncate", () => {
		const id = buildInstanceId(baseConfigPush, "delivery-xyz");
		expect(id.length).toBeLessThanOrEqual(64);
	});
	test("output charset is [a-zA-Z0-9_-]", () => {
		const id = buildInstanceId(baseConfigPush, "delivery/with.dots");
		expect(/^[a-zA-Z0-9_-]+$/.test(id)).toBe(true);
	});
	test("identical delivery IDs collide (dedupe anchor)", () => {
		const a = buildInstanceId(baseConfigPush, "same-delivery");
		const b = buildInstanceId(baseConfigPush, "same-delivery");
		expect(a).toBe(b);
	});
});

describe("isDuplicateInstanceError", () => {
	test("true when error message contains 'already exists'", () => {
		expect(isDuplicateInstanceError(new Error("instance already exists"))).toBe(
			true,
		);
	});
	test("true case-insensitive", () => {
		expect(isDuplicateInstanceError(new Error("ALREADY EXISTS: foo"))).toBe(
			true,
		);
	});
	test("false for unrelated error", () => {
		expect(isDuplicateInstanceError(new Error("network down"))).toBe(false);
	});
	test("false for non-error values", () => {
		expect(isDuplicateInstanceError(null)).toBe(false);
		expect(isDuplicateInstanceError(undefined)).toBe(false);
		expect(isDuplicateInstanceError("string")).toBe(false);
	});
});
