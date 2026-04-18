import type {
	IssuesAssignedPayload,
	WorkflowRunCompletedPayload,
	PRReviewSubmittedPayload,
} from "./payload-types";

// ── Pure guard predicates ─────────────────────────────────────────────────────
//
// These predicates extract the boolean routing decisions from the router methods.
// Each function is pure: no I/O, no logging, no mutation.

/**
 * Returns true if the given login is in the ignored logins set
 * (either the agent's GitHub username or the app bot login).
 */
export function isIgnoredLogin(
	login: string | null | undefined,
	{ agentLogin, appBotLogin }: { agentLogin: string; appBotLogin: string },
): boolean {
	if (!login) return false;
	return login === agentLogin || login === appBotLogin;
}

/**
 * Returns true if the assignee on an issues.assigned payload is the agent.
 */
export function isAssigneeAgent(
	payload: IssuesAssignedPayload,
	agentLogin: string,
): boolean {
	return payload.assignee?.login === agentLogin;
}

/**
 * Returns true if the PR was authored by the agent.
 */
export function isPrAuthoredByAgent(
	prAuthorLogin: string | undefined,
	agentLogin: string,
): boolean {
	return prAuthorLogin === agentLogin;
}

/**
 * Returns true if the workflow_run concluded with a "failure" conclusion.
 */
export function isWorkflowFailure(
	payload: WorkflowRunCompletedPayload,
): boolean {
	return payload.workflow_run.conclusion === "failure";
}

/**
 * Returns true if the review body is empty or null/undefined.
 */
export function isEmptyReviewBody(payload: PRReviewSubmittedPayload): boolean {
	return !payload.review.body;
}
