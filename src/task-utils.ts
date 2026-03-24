import * as core from "@actions/core";
import type { CoderClient, ExperimentalCoderSDKTask } from "./coder-client";
import { TaskNameSchema } from "./coder-client";

const MAX_TASK_NAME_LENGTH = 32;

export function generateTaskName(
	prefix: string,
	repo: string,
	issueNumber: number,
): string {
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
	return `${prefix}-${truncatedRepo}-${issueStr}`;
}

export function parseIssueURL(url: string): {
	owner: string;
	repo: string;
	issueNumber: number;
} {
	const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
	if (!match) {
		throw new Error(`Invalid GitHub issue URL: ${url}`);
	}
	return {
		owner: match[1],
		repo: match[2],
		issueNumber: Number.parseInt(match[3], 10),
	};
}

export async function lookupAndEnsureActiveTask(
	coder: CoderClient,
	coderUsername: string | undefined,
	taskName: string,
): Promise<ExperimentalCoderSDKTask | null> {
	const parsedName = TaskNameSchema.parse(taskName);
	const task = await coder.getTask(coderUsername, parsedName);
	if (!task) {
		return null;
	}

	if (task.status === "error") {
		core.warning(`Task ${taskName} is in error state, skipping`);
		return null;
	}

	if (task.status === "active" && task.current_state?.state === "idle") {
		return task;
	}

	// Use task.owner_id (UUID) as the owner identifier — Coder accepts both
	// usernames and UUIDs for user-scoped API paths.
	core.info(`Task ${taskName} is ${task.status}, waiting for active state...`);
	if (task.status === "paused") {
		core.info(`Resuming paused task ${taskName}...`);
		await coder.startWorkspace(task.workspace_id);
	}
	await coder.waitForTaskActive(task.owner_id, task.id, core.debug);
	return task;
}
