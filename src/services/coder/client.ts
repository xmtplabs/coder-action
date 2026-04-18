import type {
	CoderSDKGetUsersResponse,
	CoderSDKTemplate,
	CoderSDKTemplateVersionPreset,
	CoderSDKTemplateVersionPresetsResponse,
	CoderSDKUser,
	ExperimentalCoderSDKCreateTaskRequest,
	ExperimentalCoderSDKTask,
	ExperimentalCoderSDKTaskListResponse,
	ExperimentalCoderSDKTaskStateEntry,
	ExperimentalCoderSDKTaskStatus,
	TaskId,
	TaskName,
	Workspace,
} from "./schemas";

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
