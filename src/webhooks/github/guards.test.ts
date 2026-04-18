import { describe, expect, test } from "vitest";
import {
	isIgnoredLogin,
	isAssigneeAgent,
	isPrAuthoredByAgent,
	isWorkflowFailure,
	isEmptyReviewBody,
} from "./guards";
import type {
	IssuesAssignedPayload,
	WorkflowRunCompletedPayload,
	PRReviewSubmittedPayload,
} from "./payload-types";

// ── isIgnoredLogin ────────────────────────────────────────────────────────────

describe("isIgnoredLogin", () => {
	const logins = {
		agentLogin: "xmtp-coder-agent",
		appBotLogin: "coder-action[bot]",
	};

	test("returns true for agent login", () => {
		expect(isIgnoredLogin("xmtp-coder-agent", logins)).toBe(true);
	});

	test("returns true for app bot login", () => {
		expect(isIgnoredLogin("coder-action[bot]", logins)).toBe(true);
	});

	test("returns false for other users", () => {
		expect(isIgnoredLogin("alice", logins)).toBe(false);
	});

	test("returns false for empty string", () => {
		expect(isIgnoredLogin("", logins)).toBe(false);
	});

	test("returns false for null", () => {
		expect(isIgnoredLogin(null, logins)).toBe(false);
	});

	test("returns false for undefined", () => {
		expect(isIgnoredLogin(undefined, logins)).toBe(false);
	});
});

// ── isAssigneeAgent ───────────────────────────────────────────────────────────

describe("isAssigneeAgent", () => {
	const agentLogin = "xmtp-coder-agent";

	test("returns true when assignee login matches agent login", () => {
		const payload = {
			assignee: { login: agentLogin },
		} as unknown as IssuesAssignedPayload;
		expect(isAssigneeAgent(payload, agentLogin)).toBe(true);
	});

	test("returns false when assignee login does not match", () => {
		const payload = {
			assignee: { login: "other-user" },
		} as unknown as IssuesAssignedPayload;
		expect(isAssigneeAgent(payload, agentLogin)).toBe(false);
	});

	test("returns false when assignee is null", () => {
		const payload = {
			assignee: null,
		} as unknown as IssuesAssignedPayload;
		expect(isAssigneeAgent(payload, agentLogin)).toBe(false);
	});

	test("returns false when assignee is undefined", () => {
		const payload = {
			assignee: undefined,
		} as unknown as IssuesAssignedPayload;
		expect(isAssigneeAgent(payload, agentLogin)).toBe(false);
	});
});

// ── isPrAuthoredByAgent ───────────────────────────────────────────────────────

describe("isPrAuthoredByAgent", () => {
	const agentLogin = "xmtp-coder-agent";

	test("returns true when PR author login matches agent login", () => {
		expect(isPrAuthoredByAgent(agentLogin, agentLogin)).toBe(true);
	});

	test("returns false when PR author login does not match", () => {
		expect(isPrAuthoredByAgent("other-user", agentLogin)).toBe(false);
	});

	test("returns false when PR author login is undefined", () => {
		expect(isPrAuthoredByAgent(undefined, agentLogin)).toBe(false);
	});

	test("returns false for empty string", () => {
		expect(isPrAuthoredByAgent("", agentLogin)).toBe(false);
	});
});

// ── isWorkflowFailure ─────────────────────────────────────────────────────────

describe("isWorkflowFailure", () => {
	test("returns true when conclusion is 'failure'", () => {
		const payload = {
			workflow_run: { conclusion: "failure" },
		} as unknown as WorkflowRunCompletedPayload;
		expect(isWorkflowFailure(payload)).toBe(true);
	});

	test("returns false when conclusion is 'success'", () => {
		const payload = {
			workflow_run: { conclusion: "success" },
		} as unknown as WorkflowRunCompletedPayload;
		expect(isWorkflowFailure(payload)).toBe(false);
	});

	test("returns false when conclusion is null", () => {
		const payload = {
			workflow_run: { conclusion: null },
		} as unknown as WorkflowRunCompletedPayload;
		expect(isWorkflowFailure(payload)).toBe(false);
	});

	test("returns false when conclusion is 'cancelled'", () => {
		const payload = {
			workflow_run: { conclusion: "cancelled" },
		} as unknown as WorkflowRunCompletedPayload;
		expect(isWorkflowFailure(payload)).toBe(false);
	});
});

// ── isEmptyReviewBody ─────────────────────────────────────────────────────────

describe("isEmptyReviewBody", () => {
	test("returns true when review body is null", () => {
		const payload = {
			review: { body: null },
		} as unknown as PRReviewSubmittedPayload;
		expect(isEmptyReviewBody(payload)).toBe(true);
	});

	test("returns true when review body is empty string", () => {
		const payload = {
			review: { body: "" },
		} as unknown as PRReviewSubmittedPayload;
		expect(isEmptyReviewBody(payload)).toBe(true);
	});

	test("returns false when review body has content", () => {
		const payload = {
			review: { body: "Please fix the naming" },
		} as unknown as PRReviewSubmittedPayload;
		expect(isEmptyReviewBody(payload)).toBe(false);
	});
});
