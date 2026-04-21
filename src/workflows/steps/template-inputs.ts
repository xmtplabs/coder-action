import { z } from "zod";
import type { RepoConfigSettings } from "../../config/repo-config-schema";

/**
 * Zod schema for the JSON payload sent as `input` to the new Coder template
 * (`code-factory`). When a repo has a `.code-factory/config.toml`, the
 * workflow serializes an instance of this shape and passes it verbatim as
 * the task input; the template parses it on the Terraform side.
 */
export const TemplateInputsSchema = z.object({
	repo_url: z.string(),
	base_branch: z.string().optional(),
	repo_name: z.string(),
	ai_prompt: z.string(),
	ai_provider: z.enum(["claude_code", "codex"]),
	extra_volumes: z
		.array(z.object({ path: z.string(), size: z.string() }))
		.optional(),
	size: z.enum(["small", "medium", "large"]),
	docker: z.boolean(),
});

export type TemplateInputs = z.infer<typeof TemplateInputsSchema>;

export interface BuildTemplateInputsParams {
	repository: { owner: string; name: string };
	issue: { number: number; url: string };
	settings: RepoConfigSettings;
}

/**
 * Compose the `ai_prompt` block consumed by the `/coder-task` skill. The
 * fields are fixed key/value lines followed by the instruction to invoke the
 * skill, separated by a blank line. Trailing newline is intentional.
 */
function buildAiPrompt(params: {
	issueUrl: string;
	repoOwner: string;
	repoName: string;
	issueNumber: number;
}): string {
	return `ISSUE_URL: ${params.issueUrl}
REPO_OWNER: ${params.repoOwner}
REPO_NAME: ${params.repoName}
ISSUE_NUMBER: ${params.issueNumber}

Use the /coder-task skill to resolve the issue
`;
}

/**
 * Map a (repository, issue, resolved repo config) triple to the JSON payload
 * that the new Coder template consumes. Pure — no I/O, safe inside `step.do`.
 */
export function buildTemplateInputs(
	params: BuildTemplateInputsParams,
): TemplateInputs {
	const { repository, issue, settings } = params;
	const volumes = settings.sandbox.volumes;
	return {
		repo_url: `https://github.com/${repository.owner}/${repository.name}`,
		repo_name: repository.name,
		ai_prompt: buildAiPrompt({
			issueUrl: issue.url,
			repoOwner: repository.owner,
			repoName: repository.name,
			issueNumber: issue.number,
		}),
		ai_provider: settings.harness.provider,
		...(volumes.length > 0 ? { extra_volumes: volumes } : {}),
		size: settings.sandbox.size,
		docker: settings.sandbox.docker,
	};
}
