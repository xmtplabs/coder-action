import { describe, expect, test } from "vitest";
import { CoderTaskWorkflow } from "./coder-task-workflow";

describe("CoderTaskWorkflow", () => {
	test("class is exported and is a constructor", () => {
		expect(typeof CoderTaskWorkflow).toBe("function");
		expect(CoderTaskWorkflow.name).toBe("CoderTaskWorkflow");
	});

	test("class name matches wrangler.toml binding class_name", () => {
		// wrangler.toml declares class_name = "CoderTaskWorkflow"; this guards
		// against renames that would orphan in-flight instances.
		expect(CoderTaskWorkflow.name).toBe("CoderTaskWorkflow");
	});
});
