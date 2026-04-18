import { z } from "zod";
import {
	TaskIdSchema,
	TaskNameSchema,
	type TaskId,
	type TaskName,
} from "../task-runner";

export { TaskIdSchema, TaskNameSchema };
export type { TaskId, TaskName };

// CoderSDKUserSchema is the schema for codersdk.User.
export const CoderSDKUserSchema = z.object({
	id: z.string().uuid(),
	username: z.string(),
	email: z.string().email(),
	organization_ids: z.array(z.string().uuid()),
	github_com_user_id: z.number().optional(),
});
export type CoderSDKUser = z.infer<typeof CoderSDKUserSchema>;

// CoderSDKGetUsersResponseSchema is the schema for codersdk.GetUsersResponse.
export const CoderSDKGetUsersResponseSchema = z.object({
	users: z.array(CoderSDKUserSchema),
});
export type CoderSDKGetUsersResponse = z.infer<
	typeof CoderSDKGetUsersResponseSchema
>;

// CoderSDKTemplateSchema is the schema for codersdk.Template.
export const CoderSDKTemplateSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	description: z.string().optional(),
	organization_id: z.string().uuid(),
	active_version_id: z.string().uuid(),
});
export type CoderSDKTemplate = z.infer<typeof CoderSDKTemplateSchema>;

// CoderSDKTemplateVersionPresetSchema is the schema for codersdk.Preset.
export const CoderSDKTemplateVersionPresetSchema = z.object({
	ID: z.string().uuid(),
	Name: z.string(),
	Default: z.boolean(),
});
export type CoderSDKTemplateVersionPreset = z.infer<
	typeof CoderSDKTemplateVersionPresetSchema
>;

// CoderSDKTemplateVersionPresetsResponseSchema is the schema for []codersdk.Preset.
export const CoderSDKTemplateVersionPresetsResponseSchema = z
	.array(CoderSDKTemplateVersionPresetSchema)
	.nullable()
	.transform((v) => v ?? []);
export type CoderSDKTemplateVersionPresetsResponse = z.infer<
	typeof CoderSDKTemplateVersionPresetsResponseSchema
>;

// ExperimentalCoderSDKTaskStateEntrySchema is the schema for experimental codersdk.TaskState.
export const ExperimentalCoderSDKTaskStateEntrySchema = z.object({
	state: z.enum(["idle", "working", "complete", "failed"]),
});
export type ExperimentalCoderSDKTaskStateEntry = z.infer<
	typeof ExperimentalCoderSDKTaskStateEntrySchema
>;

// ExperimentalCoderSDKTaskStatusSchema is the schema for experimental codersdk.TaskStatus.
export const ExperimentalCoderSDKTaskStatusSchema = z.enum([
	"pending",
	"initializing",
	"active",
	"paused",
	"unknown",
	"error",
]);
export type ExperimentalCoderSDKTaskStatus = z.infer<
	typeof ExperimentalCoderSDKTaskStatusSchema
>;

// ExperimentalCoderSDKTaskSchema is the schema for experimental codersdk.Task.
// workspace_id is included here as it is needed for workspace lifecycle operations.
export const ExperimentalCoderSDKTaskSchema = z.object({
	id: TaskIdSchema,
	name: TaskNameSchema,
	owner_id: z.string().uuid(),
	template_id: z.string().uuid(),
	workspace_id: z.string().uuid(),
	created_at: z.string(),
	updated_at: z.string(),
	status: ExperimentalCoderSDKTaskStatusSchema,
	current_state: ExperimentalCoderSDKTaskStateEntrySchema.nullable(),
});
export type ExperimentalCoderSDKTask = z.infer<
	typeof ExperimentalCoderSDKTaskSchema
>;

// ExperimentalCoderSDKTaskListResponseSchema is the schema for GET /api/v2/tasks.
export const ExperimentalCoderSDKTaskListResponseSchema = z.object({
	tasks: z.array(ExperimentalCoderSDKTaskSchema),
});
export type ExperimentalCoderSDKTaskListResponse = z.infer<
	typeof ExperimentalCoderSDKTaskListResponseSchema
>;
