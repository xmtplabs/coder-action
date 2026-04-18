import { describe, expect, test } from "bun:test";
import type { Event, EventSource } from "./types";

describe("Event union", () => {
	test("has four variants", () => {
		const variants: Event["type"][] = [
			"task_requested",
			"task_closed",
			"comment_posted",
			"check_failed",
		];
		expect(variants).toHaveLength(4);
	});

	test("EventSource supports github variant", () => {
		const s: EventSource = { type: "github", installationId: 42 };
		expect(s.type).toBe("github");
	});
});
