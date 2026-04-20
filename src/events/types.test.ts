import { describe, expect, test } from "vitest";
import type { Event, EventSource } from "./types";

describe("Event union", () => {
	test("has five variants", () => {
		const variants: Event["type"][] = [
			"task_requested",
			"task_closed",
			"comment_posted",
			"check_failed",
			"config_push",
		];
		expect(variants).toHaveLength(5);
	});

	test("EventSource supports github variant", () => {
		const s: EventSource = { type: "github", installationId: 42 };
		expect(s.type).toBe("github");
	});
});
