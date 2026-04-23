export const MAX_FAILED_JOBS = 5;

interface CommentMessageParams {
	commentUrl: string;
	commenter: string;
	timestamp: string;
	body: string;
	filePath?: string;
	lineNumber?: number;
}

interface FailedCheckParams {
	prUrl: string;
	workflowName: string;
	runUrl: string;
	workflowFile: string;
	failedJobs: Array<{ name: string; logs: string }>;
}

export function formatPRCommentMessage(params: CommentMessageParams): string {
	const locationLine =
		params.filePath != null
			? `\nFile: ${params.filePath}${params.lineNumber != null ? `:${params.lineNumber}` : ""}`
			: "";
	return `New Comment on PR: ${params.commentUrl}
Commenter: ${params.commenter}
Timestamp: ${params.timestamp}${locationLine}

[INSTRUCTIONS]
Use the /receiving-feedback skill to handle the following comment.
[END INSTRUCTIONS]

[COMMENT]
${params.body}
[END COMMENT]`;
}

export function formatIssueCommentMessage(
	params: CommentMessageParams,
): string {
	return `New Comment on Issue: ${params.commentUrl}
Commenter: ${params.commenter}
Timestamp: ${params.timestamp}

[INSTRUCTIONS]
Use the /receiving-feedback skill to handle the following comment.
[END INSTRUCTIONS]

[COMMENT]
${params.body}
[END COMMENT]`;
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
