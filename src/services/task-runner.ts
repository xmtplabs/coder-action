import { z } from "zod";

export const TaskNameSchema = z.string().min(1).brand("TaskName");
export type TaskName = z.infer<typeof TaskNameSchema>;

export const TaskIdSchema = z.string().uuid().brand("TaskId");
export type TaskId = z.infer<typeof TaskIdSchema>;

export type TaskStatus = "initializing" | "ready" | "stopped" | "error";

export interface Task {
	name: TaskName;
	status: TaskStatus;
	owner: string; // task-provider-internal owner identifier
	url: string; // user-facing task URL
}

export interface GithubUser {
	type: "github";
	id: string;
	username: string;
}

export interface TaskRunner {
	/**
	 * Resolve a source-control identity to a task-provider owner identifier
	 * usable in subsequent calls.
	 */
	lookupUser(params: { user: GithubUser }): Promise<string>;

	/**
	 * Create a task owned by `owner` with the given input. Returns once the
	 * provider accepts the creation request; does not wait for the task to
	 * become able to accept input. Callers may use `sendInput` or `getStatus`
	 * to observe readiness.
	 *
	 * If a task with the same `taskName` under `owner` already exists, returns
	 * the existing task without modification.
	 */
	create(params: {
		taskName: TaskName;
		owner: string;
		input: string;
	}): Promise<Task>;

	/**
	 * Send input to an existing task. The service prepares the task as needed
	 * (for example, resuming it from a stopped state or waiting through
	 * initialization) before dispatching the input. Bounded by `timeout`.
	 * Does not retry the dispatch call itself on failure — waiting for the
	 * task to be ready is the sole recovery strategy. `owner` is optional;
	 * when omitted, the service resolves the task by name alone.
	 */
	sendInput(params: {
		taskName: TaskName;
		owner?: string;
		input: string;
		timeout?: number; // default 120_000 ms
	}): Promise<void>;

	/**
	 * Return the task's current status, or null if the task does not exist.
	 * `owner` is optional; when omitted, the service resolves the task by
	 * name alone (may be non-deterministic if names collide across owners).
	 */
	getStatus(params: {
		taskName: TaskName;
		owner?: string;
	}): Promise<Task | null>;

	/**
	 * Delete the task. Idempotent — resolves without error if the task does
	 * not exist. `owner` is optional; when omitted, the service resolves the
	 * task by name alone.
	 *
	 * Returns `{ deleted: true }` when a task was found and removed, or
	 * `{ deleted: false }` when no task was found (no-op).
	 */
	delete(params: {
		taskName: TaskName;
		owner?: string;
	}): Promise<{ deleted: boolean }>;
}
