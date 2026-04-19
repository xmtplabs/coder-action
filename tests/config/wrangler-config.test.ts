import { describe, expect, test } from "vitest";
// Import the wrangler.toml as a raw string at build time (Vite ?raw suffix).
// This avoids relying on filesystem access from inside workerd.
import content from "../../wrangler.toml?raw";

describe("wrangler.toml", () => {
	test("declares the worker name and main entry", () => {
		expect(content).toMatch(/^name\s*=\s*"task-action"/m);
		expect(content).toMatch(/^main\s*=\s*"src\/main\.ts"/m);
	});

	test("enables nodejs_compat", () => {
		expect(content).toMatch(/compatibility_flags\s*=\s*\[\s*"nodejs_compat"\s*\]/);
	});

	test("declares the TASK_RUNNER_WORKFLOW binding", () => {
		expect(content).toMatch(
			/\[\[workflows\]\][\s\S]*binding\s*=\s*"TASK_RUNNER_WORKFLOW"/,
		);
		expect(content).toMatch(/class_name\s*=\s*"TaskRunnerWorkflow"/);
	});

	test("enables observability for Workers Logs", () => {
		expect(content).toMatch(/\[observability\][\s\S]*enabled\s*=\s*true/);
	});

	test("sets a cpu_ms limit", () => {
		expect(content).toMatch(/\[limits\][\s\S]*cpu_ms/);
	});
});
