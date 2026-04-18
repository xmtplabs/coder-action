import { describe, expect, test } from "vitest";
import type { TaskRunner } from "../services/task-runner";
import { MockTaskRunner } from "./helpers";

describe("MockTaskRunner", () => {
	test("satisfies TaskRunner", () => {
		const r: TaskRunner = new MockTaskRunner();
		expect(typeof r.create).toBe("function");
		expect(typeof r.sendTaskInput).toBe("function");
		expect(typeof r.findTaskByName).toBe("function");
		expect(typeof r.getTaskById).toBe("function");
		expect(typeof r.resumeWorkspace).toBe("function");
		expect(typeof r.delete).toBe("function");
		expect(typeof r.lookupUser).toBe("function");
	});
});
