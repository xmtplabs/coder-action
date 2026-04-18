import { describe, expect, test } from "vitest";
import {
	formatFailedCheckMessage,
	formatIssueCommentMessage,
	formatPRCommentMessage,
} from "./messages";

describe("formatPRCommentMessage", () => {
	test("includes all required fields", () => {
		const msg = formatPRCommentMessage({
			commentUrl: "https://github.com/org/repo/pull/1#comment-1",
			commenter: "reviewer",
			timestamp: "2026-03-17T12:00:00Z",
			body: "Please fix the typo on line 42",
		});
		expect(msg).toContain(
			"New Comment on PR: https://github.com/org/repo/pull/1#comment-1",
		);
		expect(msg).toContain("Commenter: reviewer");
		expect(msg).toContain("Timestamp: 2026-03-17T12:00:00Z");
		expect(msg).toContain("Please fix the typo on line 42");
	});

	test("separates instructions from comment body with delimiters", () => {
		const msg = formatPRCommentMessage({
			commentUrl: "https://github.com/org/repo/pull/1#comment-1",
			commenter: "reviewer",
			timestamp: "2026-03-17T12:00:00Z",
			body: "Please fix the typo on line 42",
		});
		expect(msg).toContain("[INSTRUCTIONS]");
		expect(msg).toContain("[END INSTRUCTIONS]");
		expect(msg).toContain("[COMMENT]");
		expect(msg).toContain("[END COMMENT]");
		// Instructions must appear before comment body
		const instrIdx = msg.indexOf("[INSTRUCTIONS]");
		const commentIdx = msg.indexOf("[COMMENT]");
		expect(instrIdx).toBeLessThan(commentIdx);
	});

	test("instructs agent to react with 👍 for automated non-actionable comments", () => {
		const msg = formatPRCommentMessage({
			commentUrl: "https://github.com/org/repo/pull/1#comment-1",
			commenter: "bot",
			timestamp: "2026-03-17T12:00:00Z",
			body: "Approvability check passed",
		});
		expect(msg).toContain("👍");
		expect(msg).toContain("automated");
	});

	test("includes file path and line number for review comments", () => {
		const msg = formatPRCommentMessage({
			commentUrl: "https://github.com/org/repo/pull/1#comment-1",
			commenter: "reviewer",
			timestamp: "2026-03-17T12:00:00Z",
			body: "This variable name is unclear",
			filePath: "src/handlers/pr-comment.ts",
			lineNumber: 42,
		});
		expect(msg).toContain("File: src/handlers/pr-comment.ts:42");
	});

	test("includes file path without line number when line is undefined", () => {
		const msg = formatPRCommentMessage({
			commentUrl: "https://github.com/org/repo/pull/1#comment-1",
			commenter: "reviewer",
			timestamp: "2026-03-17T12:00:00Z",
			body: "This variable name is unclear",
			filePath: "src/handlers/pr-comment.ts",
		});
		expect(msg).toContain("File: src/handlers/pr-comment.ts");
		expect(msg).not.toContain("File: src/handlers/pr-comment.ts:");
	});

	test("omits file line when filePath is not provided", () => {
		const msg = formatPRCommentMessage({
			commentUrl: "https://github.com/org/repo/pull/1#comment-1",
			commenter: "reviewer",
			timestamp: "2026-03-17T12:00:00Z",
			body: "General comment",
		});
		expect(msg).not.toContain("File:");
	});
});

describe("formatIssueCommentMessage", () => {
	test("includes all required fields", () => {
		const msg = formatIssueCommentMessage({
			commentUrl: "https://github.com/org/repo/issues/42#comment-1",
			commenter: "author",
			timestamp: "2026-03-17T12:00:00Z",
			body: "Actually, the requirement changed",
		});
		expect(msg).toContain("New Comment on Issue:");
		expect(msg).toContain("Commenter: author");
		expect(msg).toContain("Actually, the requirement changed");
	});

	test("separates instructions from comment body with delimiters", () => {
		const msg = formatIssueCommentMessage({
			commentUrl: "https://github.com/org/repo/issues/42#comment-1",
			commenter: "author",
			timestamp: "2026-03-17T12:00:00Z",
			body: "Actually, the requirement changed",
		});
		expect(msg).toContain("[INSTRUCTIONS]");
		expect(msg).toContain("[END INSTRUCTIONS]");
		expect(msg).toContain("[COMMENT]");
		expect(msg).toContain("[END COMMENT]");
		// Instructions must appear before comment body
		const instrIdx = msg.indexOf("[INSTRUCTIONS]");
		const commentIdx = msg.indexOf("[COMMENT]");
		expect(instrIdx).toBeLessThan(commentIdx);
	});

	test("instructs agent to react with 👍 for automated non-actionable comments", () => {
		const msg = formatIssueCommentMessage({
			commentUrl: "https://github.com/org/repo/issues/42#comment-1",
			commenter: "github-actions",
			timestamp: "2026-03-17T12:00:00Z",
			body: "Task created: https://coder.example.com/tasks/123",
		});
		expect(msg).toContain("👍");
		expect(msg).toContain("automated");
	});
});

describe("formatFailedCheckMessage", () => {
	test("includes workflow info and job logs", () => {
		const msg = formatFailedCheckMessage({
			prUrl: "https://github.com/org/repo/pull/5",
			workflowName: "CI",
			runUrl: "https://github.com/org/repo/actions/runs/123",
			workflowFile: "ci.yml",
			failedJobs: [
				{ name: "test", logs: "Error: test failed\nassert false" },
				{ name: "lint", logs: "Error: unused import" },
			],
		});
		expect(msg).toContain("CI Check Failed on PR:");
		expect(msg).toContain("Workflow: CI");
		expect(msg).toContain("Failed Jobs: test, lint");
		expect(msg).toContain("## test");
		expect(msg).toContain("assert false");
		expect(msg).toContain("## lint");
		expect(msg).toContain("unused import");
	});

	test("caps at 5 failed jobs", () => {
		const jobs = Array.from({ length: 8 }, (_, i) => ({
			name: `job-${i}`,
			logs: `failure ${i}`,
		}));
		const msg = formatFailedCheckMessage({
			prUrl: "url",
			workflowName: "CI",
			runUrl: "url",
			workflowFile: "ci.yml",
			failedJobs: jobs,
		});
		expect(msg).toContain("## job-0");
		expect(msg).toContain("## job-4");
		expect(msg).not.toContain("## job-5");
	});
});
