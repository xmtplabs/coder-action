import type { Logger } from "../../infra/logger";
import type { GithubUser, Task, TaskRunner, TaskStatus } from "../task-runner";
import type { TaskId, TaskName } from "../task-runner";
import { CoderAPIError } from "./errors";
import {
	CoderSDKGetUsersResponseSchema,
	CoderSDKUserSchema,
	CoderSDKTemplateSchema,
	CoderSDKTemplateVersionPresetsResponseSchema,
	ExperimentalCoderSDKTaskListResponseSchema,
	ExperimentalCoderSDKTaskSchema,
	type ExperimentalCoderSDKTask,
	type ExperimentalCoderSDKTaskStatus,
	type ExperimentalCoderSDKTaskStateEntry,
} from "./schemas";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CoderServiceConfig {
	/** Coder organization name */
	organization: string;
	/** Coder template name */
	templateName: string;
	/** Optional preset name; when omitted the default preset is used (or none if no default). */
	templatePreset?: string;
}

export interface CoderServiceOptions {
	serverURL: string;
	apiToken: string;
	config: CoderServiceConfig;
	/** Defaults to `globalThis.fetch`. Injectable for testing. */
	fetchFn?: typeof fetch;
	/** Defaults to a no-op logger. Injectable for testing. */
	logger?: Logger;
}

// ── No-op logger ──────────────────────────────────────────────────────────────

const noopLogger: Logger = {
	info: () => {},
	debug: () => {},
	warn: () => {},
	error: () => {},
	child: () => noopLogger,
};

// ── Status normalization ──────────────────────────────────────────────────────

/**
 * Normalize a Coder SDK task status + current_state into a provider-agnostic
 * TaskStatus value.
 *
 * Mapping (per design spec §4):
 *
 * | Coder `status`          | Coder `current_state.state` | TaskStatus      |
 * |-------------------------|-----------------------------|-----------------|
 * | `pending`/`initializing`| any                         | `initializing`  |
 * | `active`                | `idle`/`complete`/`failed`  | `ready`         |
 * | `active`                | `working`                   | `initializing`  |
 * | `active`                | `null`                      | `ready`         |
 * | `paused`                | any                         | `stopped`       |
 * | `error`/`unknown`       | any                         | `error`         |
 */
function normalizeStatus(
	status: ExperimentalCoderSDKTaskStatus,
	currentState: ExperimentalCoderSDKTaskStateEntry | null,
): TaskStatus {
	switch (status) {
		case "pending":
		case "initializing":
			return "initializing";

		case "active": {
			const state = currentState?.state ?? null;
			if (state === "idle" || state === "complete" || state === "failed") {
				return "ready";
			}
			if (state === "working") {
				return "initializing";
			}
			// null current_state — treat as ready (spec: active+null after grace → ready;
			// for one-shot getStatus observations we treat it as ready immediately)
			return "ready";
		}

		case "paused":
			return "stopped";

		case "error":
		case "unknown":
			return "error";

		default: {
			const _exhaustive: never = status;
			return "error";
		}
	}
}

// ── URL composition ───────────────────────────────────────────────────────────

function composeTaskUrl(
	serverURL: string,
	ownerUsername: string,
	taskId: string,
): string {
	return `${serverURL}/tasks/${ownerUsername}/${taskId}`;
}

// ── CoderService ──────────────────────────────────────────────────────────────

/**
 * CoderService implements the `TaskRunner` interface using Coder's experimental
 * Tasks API. Lifecycle semantics are aligned with the Coder CLI
 * (`coder/coder/cli/task_*.go`):
 *
 * - `create`: single POST, no post-create wait (matches `task_create.go`).
 * - `delete`: single DELETE, no workspace stop/wait/delete (matches `task_delete.go`).
 * - `sendInput`: resume if paused, wait-for-idle, single send — no retry loop
 *   (matches `task_send.go`).
 */
export class CoderService implements TaskRunner {
	private readonly serverURL: string;
	private readonly headers: Record<string, string>;
	private readonly fetchFn: typeof fetch;
	private readonly config: CoderServiceConfig;
	private readonly logger: Logger;

	constructor(options: CoderServiceOptions) {
		this.serverURL = options.serverURL;
		this.headers = {
			"Coder-Session-Token": options.apiToken,
			"Content-Type": "application/json",
		};
		this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
		this.config = options.config;
		this.logger = options.logger ?? noopLogger;
	}

	// ── HTTP plumbing ───────────────────────────────────────────────────────────

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

	// ── Primitive methods (consumed by the Workflow) ──────────────────────────

	/**
	 * Public look-up by task name. Returns the raw Coder SDK task or null.
	 * When owner is omitted, scans all tasks by name; warns if multiple matches.
	 */
	async findTaskByName(
		taskName: TaskName,
		owner?: string,
	): Promise<ExperimentalCoderSDKTask | null> {
		return this.findTask(taskName, owner);
	}

	/**
	 * Fetch a single task by its (owner, id). Throws CoderAPIError on non-2xx.
	 * Returns the raw Coder SDK task, parsed via Zod.
	 */
	async getTaskById(
		taskId: TaskId,
		owner: string,
	): Promise<ExperimentalCoderSDKTask> {
		const endpoint = `/api/experimental/tasks/${encodeURIComponent(owner)}/${encodeURIComponent(taskId)}`;
		const raw = await this.request<unknown>(endpoint);
		return ExperimentalCoderSDKTaskSchema.parse(raw);
	}

	/**
	 * Issue a workspace start build transition (resumes a paused workspace).
	 */
	async resumeWorkspace(workspaceId: string): Promise<void> {
		await this.request(
			`/api/v2/workspaces/${encodeURIComponent(workspaceId)}/builds`,
			{
				method: "POST",
				body: JSON.stringify({ transition: "start" }),
			},
		);
	}

	/**
	 * Send input to an already-ready task. No polling — the workflow caller is
	 * expected to have ensured the task is in a ready state via ensureTaskReady.
	 */
	async sendTaskInput(
		taskId: TaskId,
		owner: string,
		input: string,
	): Promise<void> {
		await this.request(
			`/api/experimental/tasks/${encodeURIComponent(owner)}/${encodeURIComponent(taskId)}/send`,
			{
				method: "POST",
				body: JSON.stringify({ input }),
			},
		);
	}

	// ── Internal helpers ────────────────────────────────────────────────────────

	/**
	 * Look up a task by owner+name. Returns the raw Coder task or null.
	 * When owner is omitted, scans all tasks by name (may log a warning on
	 * multiple matches).
	 */
	private async findTask(
		taskName: TaskName,
		owner?: string,
	): Promise<ExperimentalCoderSDKTask | null> {
		try {
			const query = owner
				? `owner:${owner} name:${taskName}`
				: `name:${taskName}`;
			const endpoint = `/api/experimental/tasks?q=${encodeURIComponent(query)}`;

			const raw = await this.request<unknown>(endpoint);
			const parsed = ExperimentalCoderSDKTaskListResponseSchema.parse(raw);

			const matches = parsed.tasks.filter((t) => t.name === taskName);

			if (matches.length === 0) return null;

			if (matches.length > 1 && !owner) {
				this.logger.warn(
					"Multiple tasks found with the same name; returning the first match",
					{ taskName, count: matches.length },
				);
			}

			return matches[0] ?? null;
		} catch (error: unknown) {
			if (error instanceof CoderAPIError && error.statusCode === 404) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Build a normalized `Task` from a raw Coder task and the owner username
	 * (which may differ from the owner ID used in API paths).
	 */
	private toTask(raw: ExperimentalCoderSDKTask, ownerUsername: string): Task {
		return {
			id: raw.id,
			name: raw.name,
			status: normalizeStatus(raw.status, raw.current_state),
			owner: ownerUsername,
			url: composeTaskUrl(this.serverURL, ownerUsername, raw.id),
		};
	}

	// ── Owner resolution ────────────────────────────────────────────────────────

	/**
	 * If `userIdOrUsername` looks like a UUID, fetch the Coder user via
	 * `GET /api/v2/users/<id>` and return their username. Otherwise return the
	 * value unchanged (already a username).
	 *
	 * This ensures `Task.owner` and `Task.url` always carry a human-readable
	 * username rather than an internal UUID (spec §4 URL composition).
	 */
	private async resolveOwnerUsername(
		userIdOrUsername: string,
	): Promise<string> {
		const uuidPattern =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidPattern.test(userIdOrUsername)) {
			return userIdOrUsername;
		}
		const raw = await this.request<unknown>(
			`/api/v2/users/${encodeURIComponent(userIdOrUsername)}`,
		);
		const parsed = CoderSDKUserSchema.parse(raw);
		return parsed.username;
	}

	// ── TaskRunner interface ────────────────────────────────────────────────────

	/**
	 * Resolve a GitHub user identity to a Coder username.
	 *
	 * Uses `GET /api/v2/users?q=github_com_user_id:<id>`.
	 */
	async lookupUser(params: { user: GithubUser }): Promise<string> {
		const { user } = params;
		const githubUserId = Number(user.id);

		if (!githubUserId || githubUserId === 0) {
			throw new CoderAPIError("GitHub user ID cannot be 0 or undefined", 400);
		}

		const endpoint = `/api/v2/users?q=${encodeURIComponent(`github_com_user_id:${githubUserId}`)}`;
		const raw = await this.request<unknown>(endpoint);
		const userList = CoderSDKGetUsersResponseSchema.parse(raw);

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

		const coderUser = userList.users[0];
		if (!coderUser) {
			throw new CoderAPIError(
				`No Coder user found with GitHub user ID ${githubUserId}`,
				404,
			);
		}
		return coderUser.username;
	}

	/**
	 * Create a new Coder task (single POST — no post-create wait).
	 *
	 * If a task with the same `(owner, taskName)` already exists, the existing
	 * task is returned without modification.
	 */
	async create(params: {
		taskName: TaskName;
		owner: string;
		input: string;
	}): Promise<Task> {
		const { taskName, owner, input } = params;

		// 1. Check for an existing task
		const existing = await this.findTask(taskName, owner);
		if (existing) {
			this.logger.info("Task already exists; returning existing task", {
				taskName,
				owner,
				taskId: existing.id,
			});
			return this.toTask(existing, owner);
		}

		// 2. Resolve template
		const templateEndpoint = `/api/v2/organizations/${encodeURIComponent(this.config.organization)}/templates/${encodeURIComponent(this.config.templateName)}`;
		const rawTemplate = await this.request<unknown>(templateEndpoint);
		const template = CoderSDKTemplateSchema.parse(rawTemplate);
		const templateVersionId = template.active_version_id;

		// 3. Resolve preset
		const presetsEndpoint = `/api/v2/templateversions/${encodeURIComponent(templateVersionId)}/presets`;
		const rawPresets = await this.request<unknown>(presetsEndpoint);
		const presets =
			CoderSDKTemplateVersionPresetsResponseSchema.parse(rawPresets);

		let presetId: string | undefined;
		if (this.config.templatePreset) {
			const named = presets.find((p) => p.Name === this.config.templatePreset);
			presetId = named?.ID;
		} else {
			const defaultPreset = presets.find((p) => p.Default);
			presetId = defaultPreset?.ID;
		}

		// 4. POST create
		const createEndpoint = `/api/experimental/tasks/${encodeURIComponent(owner)}`;
		const body: Record<string, unknown> = {
			name: taskName,
			template_version_id: templateVersionId,
			input,
		};
		if (presetId) {
			body.template_version_preset_id = presetId;
		}

		const rawCreated = await this.request<unknown>(createEndpoint, {
			method: "POST",
			body: JSON.stringify(body),
		});
		const created = ExperimentalCoderSDKTaskSchema.parse(rawCreated);

		// 5. Return — no wait
		return this.toTask(created, owner);
	}

	/**
	 * Return the current (normalized) status of a task, or null if not found.
	 * Thin wrapper over `findTask` + `toTask` — exercises status normalization
	 * and URL composition for callers that need the provider-agnostic `Task`
	 * shape rather than the raw SDK object.
	 */
	async getStatus(params: {
		taskName: TaskName;
		owner?: string;
	}): Promise<Task | null> {
		const { taskName, owner } = params;
		const raw = await this.findTask(taskName, owner);
		if (!raw) return null;
		const resolvedOwner =
			owner ?? (await this.resolveOwnerUsername(raw.owner_id));
		return this.toTask(raw, resolvedOwner);
	}

	/**
	 * Delete a task by issuing a single DELETE API call.
	 *
	 * Idempotent — resolves without error when the task does not exist
	 *. No workspace stop, wait, or delete.
	 *
	 * Returns `{ deleted: true }` when a task was found and removed, or
	 * `{ deleted: false }` when no task was found (no-op).
	 */
	async delete(params: {
		taskName: TaskName;
		owner?: string;
	}): Promise<{ deleted: boolean }> {
		const { taskName, owner } = params;
		const raw = await this.findTask(taskName, owner);
		if (!raw) return { deleted: false };

		const resolvedOwner =
			owner ?? (await this.resolveOwnerUsername(raw.owner_id));
		await this.request(
			`/api/experimental/tasks/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(raw.id)}`,
			{ method: "DELETE" },
		);
		return { deleted: true };
	}
}
