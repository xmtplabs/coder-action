/**
 * Hidden HTML-comment marker prepended to every workflow-written issue comment
 * that may be edited in place across steps (create → update → close). The
 * marker is invisible in rendered markdown; GitHub's `listComments` response
 * preserves it, so `GitHubClient.commentOnIssue`'s `startsWith(matchPrefix)`
 * upsert resolves the same comment regardless of the visible body each writer
 * chose. Always pair with `matchPrefix = TASK_STATUS_COMMENT_MARKER`.
 */
export const TASK_STATUS_COMMENT_MARKER = "<!-- coder-factory:task-status -->";

/**
 * Prepend the marker on its own line, followed by the human-readable content.
 * The hidden first line is what makes every subsequent edit resolve the same
 * existing comment via the upsert-by-prefix behavior in
 * `GitHubClient.commentOnIssue`.
 */
export function buildTaskStatusCommentBody(content: string): string {
	return `${TASK_STATUS_COMMENT_MARKER}\n${content}`;
}
