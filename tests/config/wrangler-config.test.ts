import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("wrangler.toml", () => {
	const content = readFileSync(
		path.join(process.cwd(), "wrangler.toml"),
		"utf8",
	);

	test("declares the worker name and main entry", () => {
		expect(content).toMatch(/^name\s*=\s*"coder-action"/m);
		expect(content).toMatch(/^main\s*=\s*"src\/main\.ts"/m);
	});

	test("enables nodejs_compat", () => {
		expect(content).toMatch(/compatibility_flags\s*=\s*\[\s*"nodejs_compat"\s*\]/);
	});

	test("declares the CODER_TASK_WORKFLOW binding", () => {
		expect(content).toMatch(
			/\[\[workflows\]\][\s\S]*binding\s*=\s*"CODER_TASK_WORKFLOW"/,
		);
		expect(content).toMatch(/class_name\s*=\s*"CoderTaskWorkflow"/);
	});

	test("enables observability for Workers Logs", () => {
		expect(content).toMatch(/\[observability\][\s\S]*enabled\s*=\s*true/);
	});

	test("sets a cpu_ms limit", () => {
		expect(content).toMatch(/\[limits\][\s\S]*cpu_ms/);
	});
});
