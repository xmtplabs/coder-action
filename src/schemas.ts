import { z } from "zod";

// ── Handler configuration ────────────────────────────────────────────────────

export interface HandlerConfig {
	coderURL: string;
	coderToken: string;
	coderTaskNamePrefix: string;
	coderTemplateName: string;
	coderTemplateNameCodex: string;
	coderTemplatePreset?: string;
	coderOrganization: string;
	agentGithubUsername: string; // replaces coderGithubUsername
	coderUsername?: string; // resolved from sender.id for create_task
	prompt?: string;
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
