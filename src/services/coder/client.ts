import {
	CoderSDKGetUsersResponseSchema,
	CoderSDKTemplateSchema,
	CoderSDKTemplateVersionPresetsResponseSchema,
	CoderSDKUserSchema,
	type ExperimentalCoderSDKCreateTaskRequest,
	ExperimentalCoderSDKTaskListResponseSchema,
	ExperimentalCoderSDKTaskSchema,
	type TaskId,
	type TaskName,
	WorkspaceSchema,
} from "./schemas";
import type {
	CoderSDKGetUsersResponse,
	CoderSDKTemplate,
	CoderSDKTemplateVersionPreset,
	CoderSDKTemplateVersionPresetsResponse,
	CoderSDKUser,
	ExperimentalCoderSDKTask,
	ExperimentalCoderSDKTaskListResponse,
	ExperimentalCoderSDKTaskStateEntry,
	ExperimentalCoderSDKTaskStatus,
	Workspace,
} from "./schemas";
import { CoderAPIError } from "./errors";

// Re-export everything so existing importers continue to work
export type {
	TaskId,
	TaskName,
	CoderSDKUser,
	CoderSDKGetUsersResponse,
	CoderSDKTemplate,
	CoderSDKTemplateVersionPreset,
	CoderSDKTemplateVersionPresetsResponse,
	ExperimentalCoderSDKCreateTaskRequest,
	ExperimentalCoderSDKTaskStateEntry,
	ExperimentalCoderSDKTaskStatus,
	ExperimentalCoderSDKTask,
	ExperimentalCoderSDKTaskListResponse,
	Workspace,
};
export {
	TaskIdSchema,
	TaskNameSchema,
	CoderSDKUserSchema,
	CoderSDKGetUsersResponseSchema,
	CoderSDKTemplateSchema,
	CoderSDKTemplateVersionPresetSchema,
	CoderSDKTemplateVersionPresetsResponseSchema,
	ExperimentalCoderSDKCreateTaskRequestSchema,
	ExperimentalCoderSDKTaskStateEntrySchema,
	ExperimentalCoderSDKTaskStatusSchema,
	ExperimentalCoderSDKTaskSchema,
	ExperimentalCoderSDKTaskListResponseSchema,
	WorkspaceSchema,
} from "./schemas";
export { CoderAPIError } from "./errors";

export interface CoderClient {
	getCoderUserByGitHubId(
		githubUserId: number | undefined,
	): Promise<CoderSDKUser>;
	getTemplateByOrganizationAndName(
		organizationName: string,
		templateName: string,
	): Promise<CoderSDKTemplate>;
	getTemplateVersionPresets(
		templateVersionId: string,
	): Promise<CoderSDKTemplateVersionPresetsResponse>;
	getTask(
		owner: string | undefined,
		taskName: TaskName,
	): Promise<ExperimentalCoderSDKTask | null>;
	getTaskById(owner: string, taskId: TaskId): Promise<ExperimentalCoderSDKTask>;
	createTask(
		owner: string,
		params: ExperimentalCoderSDKCreateTaskRequest,
	): Promise<ExperimentalCoderSDKTask>;
	sendTaskInput(owner: string, taskId: TaskId, input: string): Promise<void>;
	waitForTaskActive(
		owner: string,
		taskId: TaskId,
		logFn: (msg: string) => void,
		timeoutMs?: number,
	): Promise<void>;
	getWorkspace(workspaceId: string): Promise<Workspace>;
	startWorkspace(workspaceId: string): Promise<void>;
	stopWorkspace(workspaceId: string): Promise<void>;
	waitForWorkspaceStopped(
		workspaceId: string,
		logFn: (msg: string) => void,
		timeoutMs?: number,
	): Promise<void>;
	deleteWorkspace(workspaceId: string): Promise<void>;
	deleteTask(owner: string, taskId: TaskId): Promise<void>;
}

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// RealCoderClient provides a minimal set of methods for interacting with the Coder API.
export class RealCoderClient implements CoderClient {
	private readonly headers: Record<string, string>;
	private readonly fetchFn: typeof fetch;

	constructor(
		private readonly serverURL: string,
		apiToken: string,
		fetchFn?: typeof fetch,
	) {
		this.headers = {
			"Coder-Session-Token": apiToken,
			"Content-Type": "application/json",
		};
		this.fetchFn = fetchFn ?? globalThis.fetch;
	}

	private async request<T>(
		endpoint: string,
		options?: RequestInit,
	): Promise<T> {
		const url = `${this.serverURL}${endpoint}`;
		const response = await this.fetchFn(url, {
			...options,
			headers: { ...this.headers, ...options?.headers },
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			const detail = body ? `: ${body}` : "";
			throw new CoderAPIError(
				`Coder API error ${response.status} ${response.statusText} (${url})${detail}`,
				response.status,
				body,
			);
		}

		// Handle 204 No Content and other responses with no body
		if (
			response.status === 204 ||
			response.headers?.get("content-length") === "0"
		) {
			return undefined as T;
		}

		return response.json() as Promise<T>;
	}

	/**
	 * getCoderUserByGitHubId retrieves an existing Coder user with the given GitHub user ID.
	 * Throws if more than one user exists with the same GitHub user ID or if the ID is 0.
	 */
	async getCoderUserByGitHubId(
		githubUserId: number | undefined,
	): Promise<CoderSDKUser> {
		if (githubUserId === undefined) {
			throw new CoderAPIError("GitHub user ID cannot be undefined", 400);
		}
		if (githubUserId === 0) {
			throw new Error("GitHub user ID cannot be 0");
		}
		const endpoint = `/api/v2/users?q=${encodeURIComponent(`github_com_user_id:${githubUserId}`)}`;
		const response = await this.request<unknown>(endpoint);
		const userList = CoderSDKGetUsersResponseSchema.parse(response);
		if (userList.users.length === 0) {
			throw new CoderAPIError(
				`No Coder user found with GitHub user ID ${githubUserId}`,
				404,
			);
		}
		if (userList.users.length > 1) {
			throw new CoderAPIError(
				`Multiple Coder users found with GitHub user ID ${githubUserId}`,
				409,
			);
		}
		return CoderSDKUserSchema.parse(userList.users[0]);
	}

	/**
	 * getTemplateByOrganizationAndName retrieves a template via Coder's stable API.
	 */
	async getTemplateByOrganizationAndName(
		organizationName: string,
		templateName: string,
	): Promise<CoderSDKTemplate> {
		const endpoint = `/api/v2/organizations/${encodeURIComponent(organizationName)}/templates/${encodeURIComponent(templateName)}`;
		const response = await this.request<unknown>(endpoint);
		return CoderSDKTemplateSchema.parse(response);
	}

	/**
	 * getTemplateVersionPresets retrieves the presets for a given template version UUID.
	 */
	async getTemplateVersionPresets(
		templateVersionId: string,
	): Promise<CoderSDKTemplateVersionPresetsResponse> {
		const endpoint = `/api/v2/templateversions/${encodeURIComponent(templateVersionId)}/presets`;
		const response = await this.request<unknown>(endpoint);
		return CoderSDKTemplateVersionPresetsResponseSchema.parse(response);
	}

	/**
	 * getTask retrieves an existing task via Coder's experimental Tasks API.
	 * Returns null if the task does not exist.
	 */
	async getTask(
		owner: string | undefined,
		taskName: TaskName,
	): Promise<ExperimentalCoderSDKTask | null> {
		try {
			const query = owner ? `?q=${encodeURIComponent(`owner:${owner}`)}` : "";
			const allTasksResponse = await this.request<unknown>(
				`/api/experimental/tasks${query}`,
			);
			const allTasks =
				ExperimentalCoderSDKTaskListResponseSchema.parse(allTasksResponse);
			const task = allTasks.tasks.find((t) => t.name === taskName);
			return task ?? null;
		} catch (error: unknown) {
			if (error instanceof CoderAPIError && error.statusCode === 404) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * getTaskById retrieves an existing task by ID via Coder's experimental Tasks API.
	 */
	async getTaskById(
		owner: string,
		taskId: TaskId,
	): Promise<ExperimentalCoderSDKTask> {
		const endpoint = `/api/experimental/tasks/${encodeURIComponent(owner)}/${encodeURIComponent(taskId)}`;
		const response = await this.request<unknown>(endpoint);
		return ExperimentalCoderSDKTaskSchema.parse(response);
	}

	/**
	 * createTask creates a new task with the given parameters via Coder's experimental Tasks API.
	 */
	async createTask(
		owner: string,
		params: ExperimentalCoderSDKCreateTaskRequest,
	): Promise<ExperimentalCoderSDKTask> {
		const endpoint = `/api/experimental/tasks/${encodeURIComponent(owner)}`;
		const response = await this.request<unknown>(endpoint, {
			method: "POST",
			body: JSON.stringify(params),
		});
		return ExperimentalCoderSDKTaskSchema.parse(response);
	}

	/**
	 * sendTaskInput sends input to an existing task via Coder's experimental Tasks API.
	 */
	async sendTaskInput(
		owner: string,
		taskId: TaskId,
		input: string,
	): Promise<void> {
		const endpoint = `/api/experimental/tasks/${encodeURIComponent(owner)}/${encodeURIComponent(taskId)}/send`;
		await this.request<unknown>(endpoint, {
			method: "POST",
			body: JSON.stringify({ input }),
		});
	}

	/**
	 * waitForTaskActive polls the task status until it reaches "active/idle" state or times out.
	 */
	async waitForTaskActive(
		owner: string,
		taskId: TaskId,
		logFn: (msg: string) => void,
		timeoutMs = 600000,
	): Promise<void> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			const task = await this.getTaskById(owner, taskId);

			if (task.status === "error") {
				throw new CoderAPIError(
					"Task entered error state while waiting for active state",
					500,
					task,
				);
			}
			logFn(
				`waitForTaskActive: task_id: ${taskId} status: ${task.status} current_state: ${task.current_state?.state}`,
			);
			if (task.status === "active" && task.current_state?.state === "idle") {
				return;
			}

			await sleep(POLL_INTERVAL_MS);
		}

		throw new CoderAPIError(
			`Timeout waiting for task to reach active state (waited ${timeoutMs}ms)`,
			408,
		);
	}

	/**
	 * getWorkspace retrieves workspace details by ID via Coder's stable API.
	 */
	async getWorkspace(workspaceId: string): Promise<Workspace> {
		const response = await this.request<unknown>(
			`/api/v2/workspaces/${encodeURIComponent(workspaceId)}`,
		);
		return WorkspaceSchema.parse(response);
	}

	/**
	 * startWorkspace initiates a start transition for the given workspace (resumes a paused task).
	 */
	async startWorkspace(workspaceId: string): Promise<void> {
		await this.request(
			`/api/v2/workspaces/${encodeURIComponent(workspaceId)}/builds`,
			{
				method: "POST",
				body: JSON.stringify({ transition: "start" }),
			},
		);
	}

	/**
	 * stopWorkspace initiates a stop transition for the given workspace.
	 */
	async stopWorkspace(workspaceId: string): Promise<void> {
		await this.request(
			`/api/v2/workspaces/${encodeURIComponent(workspaceId)}/builds`,
			{
				method: "POST",
				body: JSON.stringify({ transition: "stop" }),
			},
		);
	}

	/**
	 * waitForWorkspaceStopped polls the workspace until it reaches a terminal stopped state or times out.
	 */
	async waitForWorkspaceStopped(
		workspaceId: string,
		logFn: (msg: string) => void,
		timeoutMs = 120000,
	): Promise<void> {
		const terminalStatuses = new Set([
			"stopped",
			"failed",
			"canceled",
			"deleted",
		]);
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			const workspace = await this.getWorkspace(workspaceId);
			const status = workspace.latest_build.status;
			logFn(
				`waitForWorkspaceStopped: workspace_id: ${workspaceId} status: ${status}`,
			);
			if (terminalStatuses.has(status)) {
				return;
			}
			await sleep(POLL_INTERVAL_MS);
		}

		throw new CoderAPIError(
			`Timeout waiting for workspace to stop (waited ${timeoutMs}ms)`,
			408,
		);
	}

	/**
	 * deleteWorkspace initiates a delete transition for the given workspace.
	 */
	async deleteWorkspace(workspaceId: string): Promise<void> {
		await this.request(
			`/api/v2/workspaces/${encodeURIComponent(workspaceId)}/builds`,
			{
				method: "POST",
				body: JSON.stringify({ transition: "delete" }),
			},
		);
	}

	/**
	 * deleteTask deletes a task via Coder's experimental Tasks API.
	 */
	async deleteTask(owner: string, taskId: TaskId): Promise<void> {
		await this.request(
			`/api/experimental/tasks/${encodeURIComponent(owner)}/${encodeURIComponent(taskId)}`,
			{ method: "DELETE" },
		);
	}
}
