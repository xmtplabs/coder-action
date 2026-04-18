import { TaskNameSchema, type TaskName } from "../services/task-runner";

const MAX_TASK_NAME_LENGTH = 32;

export function generateTaskName(
	prefix: string,
	repo: string,
	issueNumber: number,
): TaskName {
	const issueStr = String(issueNumber);
	// Format: {prefix}-{repo}-{issueNumber}
	// Coder API enforces a 32-character limit on task names.
	const overhead = prefix.length + 1 + 1 + issueStr.length; // prefix + "-" + "-" + issueNumber
	const maxRepoLength = MAX_TASK_NAME_LENGTH - overhead;
	if (maxRepoLength <= 0) {
		throw new Error(
			`Task name prefix "${prefix}" and issue number ${issueNumber} leave no room for the repo name (max ${MAX_TASK_NAME_LENGTH} chars)`,
		);
	}
	const truncatedRepo =
		repo.length > maxRepoLength
			? repo.slice(0, maxRepoLength).replace(/-+$/, "")
			: repo;
	return TaskNameSchema.parse(`${prefix}-${truncatedRepo}-${issueStr}`);
}
