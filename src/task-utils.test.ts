import { describe, expect, mock, test } from "bun:test";
import type { CoderClient } from "./coder-client";
import {
	generateTaskName,
	lookupAndEnsureActiveTask,
	parseIssueURL,
} from "./task-utils";

describe("generateTaskName", () => {
	test("generates correct name", () => {
		expect(generateTaskName("gh", "libxmtp", 42)).toBe("gh-libxmtp-42");
	});

	test("handles custom prefix", () => {
		expect(generateTaskName("coder", "myrepo", 1)).toBe("coder-myrepo-1");
	});

	test("truncates long repo names to fit 32-char limit", () => {
		const name = generateTaskName("gh", "a-very-long-repository-name-here", 42);
		expect(name.length).toBeLessThanOrEqual(32);
		expect(name).toBe("gh-a-very-long-repository-nam-42");
	});

	test("truncates repo with 5-digit issue number", () => {
		const name = generateTaskName(
			"gh",
			"a-very-long-repository-name-here",
			99999,
		);
		expect(name.length).toBeLessThanOrEqual(32);
		expect(name).toBe("gh-a-very-long-repository-99999");
	});

	test("does not truncate short repo names", () => {
		expect(generateTaskName("gh", "short", 1)).toBe("gh-short-1");
	});

	test("throws when prefix and issue number leave no room for repo", () => {
		expect(() =>
			generateTaskName("a-very-long-prefix-that-is-huge", "repo", 12345),
		).toThrow("leave no room for the repo name");
	});
});

describe("parseIssueURL", () => {
	test("parses standard issue URL", () => {
		const result = parseIssueURL("https://github.com/xmtp/libxmtp/issues/42");
		expect(result).toEqual({ owner: "xmtp", repo: "libxmtp", issueNumber: 42 });
	});

	test("throws on invalid URL", () => {
		expect(() => parseIssueURL("https://github.com/xmtp/libxmtp")).toThrow();
	});

	test("throws on non-github URL", () => {
		expect(() =>
			parseIssueURL("https://gitlab.com/xmtp/repo/issues/1"),
		).toThrow();
	});
});

describe("lookupAndEnsureActiveTask", () => {
	test("returns task when active", async () => {
		const mockCoder = {
			getTask: mock(() =>
				Promise.resolve({
					id: "uuid",
					owner_id: "owner-uuid",
					name: "gh-repo-42",
					status: "active",
					current_state: { state: "idle" },
				}),
			),
			waitForTaskActive: mock(() => Promise.resolve()),
		};
		const result = await lookupAndEnsureActiveTask(
			mockCoder as unknown as CoderClient,
			undefined,
			"gh-repo-42",
		);
		expect(result).not.toBeNull();
		expect(String(result?.id)).toBe("uuid");
		expect(mockCoder.waitForTaskActive).not.toHaveBeenCalled();
	});

	test("returns null when task not found", async () => {
		const mockCoder = {
			getTask: mock(() => Promise.resolve(null)),
			waitForTaskActive: mock(() => Promise.resolve()),
		};
		const result = await lookupAndEnsureActiveTask(
			mockCoder as unknown as CoderClient,
			undefined,
			"gh-repo-99",
		);
		expect(result).toBeNull();
	});

	test("resumes paused task and waits for active state", async () => {
		const mockCoder = {
			getTask: mock(() =>
				Promise.resolve({
					id: "uuid",
					owner_id: "owner-uuid",
					workspace_id: "ws-uuid",
					name: "gh-repo-42",
					status: "paused",
					current_state: null,
				}),
			),
			startWorkspace: mock(() => Promise.resolve()),
			waitForTaskActive: mock(() => Promise.resolve()),
		};
		const result = await lookupAndEnsureActiveTask(
			mockCoder as unknown as CoderClient,
			undefined,
			"gh-repo-42",
		);
		expect(result).not.toBeNull();
		expect(mockCoder.startWorkspace).toHaveBeenCalledWith("ws-uuid");
		expect(mockCoder.waitForTaskActive).toHaveBeenCalledWith(
			"owner-uuid",
			"uuid",
			expect.any(Function),
		);
	});

	test("returns null when task is in error state", async () => {
		const mockCoder = {
			getTask: mock(() =>
				Promise.resolve({
					id: "uuid",
					owner_id: "owner-uuid",
					name: "gh-repo-42",
					status: "error",
					current_state: null,
				}),
			),
			waitForTaskActive: mock(() => Promise.resolve()),
		};
		const result = await lookupAndEnsureActiveTask(
			mockCoder as unknown as CoderClient,
			undefined,
			"gh-repo-42",
		);
		expect(result).toBeNull();
	});
});
