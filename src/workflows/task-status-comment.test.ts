import { describe, expect, test } from "vitest";
import {
	TASK_STATUS_COMMENT_MARKER,
	buildTaskStatusCommentBody,
} from "./task-status-comment";

describe("buildTaskStatusCommentBody", () => {
	test("prepends the marker on its own line followed by the content", () => {
		const body = buildTaskStatusCommentBody("Task created: https://x");
		expect(body).toBe(`${TASK_STATUS_COMMENT_MARKER}\nTask created: https://x`);
	});

	test("body starts with the marker so startsWith(marker) matches", () => {
		const body = buildTaskStatusCommentBody("Anything here");
		expect(body.startsWith(TASK_STATUS_COMMENT_MARKER)).toBe(true);
	});

	test("marker is a hidden HTML comment (invisible in rendered markdown)", () => {
		expect(TASK_STATUS_COMMENT_MARKER.startsWith("<!--")).toBe(true);
		expect(TASK_STATUS_COMMENT_MARKER.endsWith("-->")).toBe(true);
	});
});
