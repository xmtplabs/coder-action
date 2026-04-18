import { describe, expect, test } from "bun:test";
import { type ActionOutputs, ActionOutputsSchema } from "./handler-config";

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
