import { z } from "zod";

// ── Shared base inputs (required for all modes) ─────────────────────────────

const BaseInputsSchema = z.object({
	coderURL: z.string().url(),
	coderToken: z.string().min(1),
	coderUsername: z.string().min(1).default("xmtp-coder-agent"),
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
export type CreateTaskInputs = z.infer<typeof CreateTaskInputsSchema>;
export type CloseTaskInputs = z.infer<typeof CloseTaskInputsSchema>;
export type PRCommentInputs = z.infer<typeof PRCommentInputsSchema>;
export type IssueCommentInputs = z.infer<typeof IssueCommentInputsSchema>;
export type FailedCheckInputs = z.infer<typeof FailedCheckInputsSchema>;

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
