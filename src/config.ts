import { z } from "zod";

// ── Schema ───────────────────────────────────────────────────────────────────

const AppConfigSchema = z.object({
	appId: z.string().min(1),
	privateKey: z.string().min(1),
	webhookSecret: z.string().min(1),
	agentGithubUsername: z.string().min(1).default("xmtp-coder-agent"),
	coderURL: z.string().url(),
	coderToken: z.string().min(1),
	coderTaskNamePrefix: z.string().min(1).default("gh"),
	coderTemplateName: z.string().min(1).default("task-template"),
	coderTemplatePreset: z.string().min(1).optional(),
	coderOrganization: z.string().min(1).default("default"),
	logFormat: z.string().optional(),
	port: z.coerce.number().default(3000),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * Maps SCREAMING_SNAKE_CASE environment variables to camelCase, validates with
 * Zod, and throws on error WITHOUT including secret values in the error message.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
	const raw = {
		appId: env.APP_ID,
		privateKey: env.PRIVATE_KEY,
		webhookSecret: env.WEBHOOK_SECRET,
		agentGithubUsername: env.AGENT_GITHUB_USERNAME,
		coderURL: env.CODER_URL,
		coderToken: env.CODER_TOKEN,
		coderTaskNamePrefix: env.CODER_TASK_NAME_PREFIX,
		coderTemplateName: env.CODER_TEMPLATE_NAME,
		coderTemplatePreset: env.CODER_TEMPLATE_PRESET,
		coderOrganization: env.CODER_ORGANIZATION,
		logFormat: env.LOG_FORMAT,
		port: env.PORT,
	};

	const result = AppConfigSchema.safeParse(raw);
	if (!result.success) {
		// Build an error message from Zod field errors only — never include values,
		// so secrets are never leaked in logs or exception messages.
		const issues = result.error.issues
			.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
			.join("; ");
		throw new Error(`Invalid configuration: ${issues}`);
	}

	return result.data;
}
