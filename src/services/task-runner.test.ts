import { describe, expect, test } from "bun:test";
import type { TaskRunner, TaskStatus } from "./task-runner";
import { TaskNameSchema, TaskIdSchema } from "./task-runner";

describe("TaskRunner types", () => {
	test("TaskNameSchema brands strings", () => {
		const name = TaskNameSchema.parse("gh-repo-42");
		expect(name).toBe(TaskNameSchema.parse("gh-repo-42"));
	});

	test("TaskNameSchema rejects empty string", () => {
		expect(() => TaskNameSchema.parse("")).toThrow();
	});

	test("TaskIdSchema brands UUID strings", () => {
		const id = TaskIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");
		expect(id).toBeTruthy();
	});

	test("TaskIdSchema rejects non-UUID strings", () => {
		expect(() => TaskIdSchema.parse("not-a-uuid")).toThrow();
	});

	test("TaskStatus covers exactly four states", () => {
		const all: TaskStatus[] = ["initializing", "ready", "stopped", "error"];
		expect(all).toHaveLength(4);
	});

	test("TaskRunner interface shape compiles", () => {
		const _placeholder: TaskRunner | null = null;
		expect(_placeholder).toBeNull();
	});
});
