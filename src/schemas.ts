import { z } from "zod";

// ── Shared base inputs (required for all modes) ─────────────────────────────

const BaseInputsSchema = z.object({
	coderURL: z.string().url(),
	coderToken: z.string().min(1),
	coderTaskNamePrefix: z.string().min(1).default("gh"),
	githubToken: z.string().min(1),
	coderGithubUsername: z.string().min(1).default("xmtp-coder-agent"),
});

// ── Mode-specific schemas ───────────────────────────────────────────────────

const CreateTaskInputsSchema = BaseInputsSchema.extend({
	action: z.literal("create_task"),
	coderTemplateName: z.string().min(1).default("task-template"),
	coderTemplatePreset: z.string().min(1).optional(),
	coderOrganization: z.string().min(1).default("default"),
	prompt: z.string().optional(),
});

const CloseTaskInputsSchema = BaseInputsSchema.extend({
	action: z.literal("close_task"),
});

const PRCommentInputsSchema = BaseInputsSchema.extend({
	action: z.literal("pr_comment"),
});

const IssueCommentInputsSchema = BaseInputsSchema.extend({
	action: z.literal("issue_comment"),
});

const FailedCheckInputsSchema = BaseInputsSchema.extend({
	action: z.literal("failed_check"),
});

// ── Discriminated union ─────────────────────────────────────────────────────

const ActionInputsSchema = z.discriminatedUnion("action", [
	CreateTaskInputsSchema,
	CloseTaskInputsSchema,
	PRCommentInputsSchema,
	IssueCommentInputsSchema,
	FailedCheckInputsSchema,
]);

export type ActionInputs = z.infer<typeof ActionInputsSchema>;

// Resolved types include coderUsername, which is resolved at runtime from GitHub sender ID.
// It is only required for create_task (where the task is created under a specific user's account);
// other actions derive the owner from the task itself after lookup.
type WithCoderUsername<T> = T & { coderUsername?: string };
export type CreateTaskInputs = WithCoderUsername<
	z.infer<typeof CreateTaskInputsSchema>
>;
export type CloseTaskInputs = WithCoderUsername<
	z.infer<typeof CloseTaskInputsSchema>
>;
export type PRCommentInputs = WithCoderUsername<
	z.infer<typeof PRCommentInputsSchema>
>;
export type IssueCommentInputs = WithCoderUsername<
	z.infer<typeof IssueCommentInputsSchema>
>;
export type FailedCheckInputs = WithCoderUsername<
	z.infer<typeof FailedCheckInputsSchema>
>;
export type ResolvedInputs = WithCoderUsername<ActionInputs>;

export function parseInputs(raw: unknown): ActionInputs {
	return ActionInputsSchema.parse(raw);
}

// ── Output schema ───────────────────────────────────────────────────────────

export const ActionOutputsSchema = z.object({
	taskName: z.string().optional(),
	taskUrl: z.string().optional(),
	taskStatus: z.string().optional(),
	skipped: z.boolean(),
	skipReason: z.string().optional(),
});

export type ActionOutputs = z.infer<typeof ActionOutputsSchema>;
