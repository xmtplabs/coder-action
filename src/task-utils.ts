import * as core from "@actions/core";
import type { CoderClient, ExperimentalCoderSDKTask } from "./coder-client";
import { TaskNameSchema } from "./coder-client";

export function generateTaskName(
	prefix: string,
	repo: string,
	issueNumber: number,
): string {
	return `${prefix}-${repo}-${issueNumber}`;
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
	coderUsername: string,
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

	core.info(`Task ${taskName} is ${task.status}, waiting for active state...`);
	await coder.waitForTaskActive(coderUsername, task.id, core.debug);
	return task;
}
