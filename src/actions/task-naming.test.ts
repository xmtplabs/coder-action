import { describe, expect, test } from "bun:test";
import { TaskNameSchema } from "../services/task-runner";
import { generateTaskName } from "./task-naming";

describe("generateTaskName", () => {
	test("generates correct name", () => {
		expect(generateTaskName("gh", "libxmtp", 42)).toBe(
			TaskNameSchema.parse("gh-libxmtp-42"),
		);
	});

	test("handles custom prefix", () => {
		expect(generateTaskName("coder", "myrepo", 1)).toBe(
			TaskNameSchema.parse("coder-myrepo-1"),
		);
	});

	test("truncates long repo names to fit 32-char limit", () => {
		const name = generateTaskName("gh", "a-very-long-repository-name-here", 42);
		expect(name.length).toBeLessThanOrEqual(32);
		expect(name).toBe(TaskNameSchema.parse("gh-a-very-long-repository-nam-42"));
	});

	test("truncates repo with 5-digit issue number", () => {
		const name = generateTaskName(
			"gh",
			"a-very-long-repository-name-here",
			99999,
		);
		expect(name.length).toBeLessThanOrEqual(32);
		expect(name).toBe(TaskNameSchema.parse("gh-a-very-long-repository-99999"));
	});

	test("does not truncate short repo names", () => {
		expect(generateTaskName("gh", "short", 1)).toBe(
			TaskNameSchema.parse("gh-short-1"),
		);
	});

	test("throws when prefix and issue number leave no room for repo", () => {
		expect(() =>
			generateTaskName("a-very-long-prefix-that-is-huge", "repo", 12345),
		).toThrow("leave no room for the repo name");
	});
});
