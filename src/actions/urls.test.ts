import { describe, expect, test } from "bun:test";
import { parseIssueURL } from "./urls";

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
