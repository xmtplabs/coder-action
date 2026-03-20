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
