const MAX_FAILED_JOBS = 5;

interface PRCommentParams {
	commentUrl: string;
	commenter: string;
	timestamp: string;
	body: string;
}

interface IssueCommentParams {
	commentUrl: string;
	commenter: string;
	timestamp: string;
	body: string;
}

interface FailedCheckParams {
	prUrl: string;
	workflowName: string;
	runUrl: string;
	workflowFile: string;
	failedJobs: Array<{ name: string; logs: string }>;
}

export function formatPRCommentMessage(params: PRCommentParams): string {
	return `New Comment on PR: ${params.commentUrl}
Commenter: ${params.commenter}
Timestamp: ${params.timestamp}

Validate whether the comment is useful feedback to improve the quality of the task output.

For all valid suggestions in the comment, implement them, ensure the branch is still in a healthy state (all lint and tests continue to pass), then commit and push. Reply to the comment with a succinct and clear explanation of the changes you made.

If you have questions or need clarification, ask them directly in the comment thread and wait for further feedback.

If no changes are needed or the comment is invalid, reply to the comment with a succinct and clear explanation why no action was taken.
---

${params.body}`;
}

export function formatIssueCommentMessage(params: IssueCommentParams): string {
	return `New Comment on Issue: ${params.commentUrl}
Commenter: ${params.commenter}
Timestamp: ${params.timestamp}

Review this comment on the issue you are working on. If it contains new requirements, clarifications, or feedback that affects your current work, adjust your approach accordingly.

If the comment asks a question, reply directly on the issue.
---

${params.body}`;
}

export function formatFailedCheckMessage(params: FailedCheckParams): string {
	const capped = params.failedJobs.slice(0, MAX_FAILED_JOBS);
	const jobNames = capped.map((j) => j.name).join(", ");
	const jobSections = capped.map((j) => `## ${j.name}\n${j.logs}`).join("\n\n");

	return `CI Check Failed on PR: ${params.prUrl}
Workflow: ${params.workflowName}
Run: ${params.runUrl}
Failed Jobs: ${jobNames}

Review the failing checks below. Fix the issues, ensure all checks pass locally, then commit and push.

If you cannot determine the root cause from the logs, check out the workflow definition at .github/workflows/${params.workflowFile} for context.
---

${jobSections}`;
}
