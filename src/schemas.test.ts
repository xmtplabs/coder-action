import { describe, expect, test } from "bun:test";
import {
	type ActionOutputs,
	ActionOutputsSchema,
	parseInputs,
} from "./schemas";

describe("parseInputs", () => {
	const baseInputs = {
		action: "create_task",
		coderURL: "https://coder.example.com",
		coderToken: "token-123",
		coderUsername: "coder-agent",
		coderTaskNamePrefix: "gh",
		githubToken: "ghp_123",
		githubOrg: "xmtp",
		coderGithubUsername: "xmtp-coder-agent",
	};

	test("validates create_task inputs", () => {
		const result = parseInputs({
			...baseInputs,
			action: "create_task",
			coderTemplateName: "task-template",
			coderOrganization: "default",
		});
		expect(result.action).toBe("create_task");
	});

	test("validates close_task inputs", () => {
		const result = parseInputs({
			...baseInputs,
			action: "close_task",
		});
		expect(result.action).toBe("close_task");
	});

	test("validates pr_comment inputs", () => {
		const result = parseInputs({
			...baseInputs,
			action: "pr_comment",
		});
		expect(result.action).toBe("pr_comment");
	});

	test("validates issue_comment inputs", () => {
		const result = parseInputs({
			...baseInputs,
			action: "issue_comment",
		});
		expect(result.action).toBe("issue_comment");
	});

	test("validates failed_check inputs", () => {
		const result = parseInputs({
			...baseInputs,
			action: "failed_check",
		});
		expect(result.action).toBe("failed_check");
	});

	test("rejects unknown action", () => {
		expect(() => parseInputs({ ...baseInputs, action: "unknown" })).toThrow();
	});

	test("rejects missing coder-url", () => {
		const { coderURL: _, ...rest } = baseInputs;
		expect(() => parseInputs(rest as unknown)).toThrow();
	});

	test("rejects invalid coder-url", () => {
		expect(() =>
			parseInputs({ ...baseInputs, coderURL: "not-a-url" }),
		).toThrow();
	});

	test("create_task requires coderTemplateName", () => {
		const result = parseInputs({
			...baseInputs,
			action: "create_task",
			coderTemplateName: "my-template",
			coderOrganization: "default",
		});
		expect(result.action).toBe("create_task");
		if (result.action === "create_task") {
			expect(result.coderTemplateName).toBe("my-template");
		}
	});

	test("create_task uses default template name when not provided", () => {
		const result = parseInputs({
			...baseInputs,
			action: "create_task",
		});
		if (result.action === "create_task") {
			expect(result.coderTemplateName).toBe("task-template");
		}
	});

	test("applies default prefix when not provided", () => {
		const { coderTaskNamePrefix: _, ...rest } = baseInputs;
		const result = parseInputs(rest as unknown);
		expect(result.coderTaskNamePrefix).toBe("gh");
	});
});

describe("ActionOutputsSchema", () => {
	test("validates complete output", () => {
		const output: ActionOutputs = {
			taskName: "gh-repo-42",
			taskUrl: "https://coder.example.com/tasks/user/uuid",
			taskStatus: "active",
			skipped: false,
		};
		expect(ActionOutputsSchema.parse(output)).toEqual(output);
	});

	test("validates skipped output", () => {
		const output: ActionOutputs = {
			skipped: true,
			skipReason: "non-org-member",
		};
		expect(ActionOutputsSchema.parse(output)).toEqual(output);
	});
});
