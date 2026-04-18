import { z } from "zod";

export const TaskNameSchema = z.string().min(1).brand("TaskName");
export type TaskName = z.infer<typeof TaskNameSchema>;

export const TaskIdSchema = z.string().uuid().brand("TaskId");
export type TaskId = z.infer<typeof TaskIdSchema>;

export type TaskStatus = "initializing" | "ready" | "stopped" | "error";

export interface Task {
	id: string; // task-provider-internal task identifier (e.g. Coder task UUID)
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

/**
 * Narrowed primitive interface matching `CoderService`. Workflow step factories
 * compose these primitives (plus `ensureTaskReady`) to implement the behaviors
 * that the old sendInput-with-polling method used to provide internally.
 */
export interface TaskRunner {
	/**
	 * Resolve a source-control identity to a task-provider owner identifier.
	 */
	lookupUser(params: { user: GithubUser }): Promise<string>;

	/**
	 * Look up an existing task by name. Returns `null` when no task matches.
	 * Returns a raw provider-specific task (the caller narrows as needed).
	 */
	findTaskByName(taskName: TaskName, owner?: string): Promise<unknown | null>;

	/**
	 * Fetch a single task by (owner, id). Returns the raw provider task.
	 * Throws on non-2xx responses.
	 */
	getTaskById(taskId: TaskId, owner: string): Promise<unknown>;

	/**
	 * Create a task. Returns the existing one if `(taskName, owner)` collides.
	 */
	create(params: {
		taskName: TaskName;
		owner: string;
		input: string;
	}): Promise<Task>;

	/**
	 * Resume a paused workspace by issuing a workspace build transition.
	 */
	resumeWorkspace(workspaceId: string): Promise<void>;

	/**
	 * Send input to a task that the caller has already ensured is ready.
	 * No polling, no retry.
	 */
	sendTaskInput(taskId: TaskId, owner: string, input: string): Promise<void>;

	/**
	 * Delete the task. Idempotent — `{deleted: false}` when missing.
	 */
	delete(params: {
		taskName: TaskName;
		owner?: string;
	}): Promise<{ deleted: boolean }>;
}
