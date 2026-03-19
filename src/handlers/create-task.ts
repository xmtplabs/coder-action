import * as core from "@actions/core";
import type { CoderClient } from "../coder-client";
import { TaskNameSchema } from "../coder-client";
import type { GitHubClient } from "../github-client";
import type { ActionOutputs, CreateTaskInputs } from "../schemas";
import { generateTaskName } from "../task-utils";

export interface IssueContext {
	owner: string;
	repo: string;
	issueNumber: number;
	issueUrl: string;
	senderLogin: string;
}

export class CreateTaskHandler {
	constructor(
		private readonly coder: CoderClient,
		private readonly github: GitHubClient,
		private readonly inputs: CreateTaskInputs,
		private readonly context: IssueContext,
	) {}

	async run(): Promise<ActionOutputs> {
		// coderUsername is always resolved for create_task before this handler runs
		const coderUsername = this.inputs.coderUsername;
		if (!coderUsername) {
			throw new Error("coderUsername is required for create_task");
		}

		// 1. Validate actor has write access to the repo
		const hasAccess = await this.github.checkActorPermission(
			this.context.owner,
			this.context.repo,
			this.context.senderLogin,
		);
		if (!hasAccess) {
			core.info(
				`Actor ${this.context.senderLogin} does not have write access to ${this.context.owner}/${this.context.repo}, skipping task creation`,
			);
			return { skipped: true, skipReason: "insufficient-permissions" };
		}

		// 2. Compute task name
		const taskName = generateTaskName(
			this.inputs.coderTaskNamePrefix,
			this.context.repo,
			this.context.issueNumber,
		);
		core.info(`Task name: ${taskName}`);

		// 3. Check existing task
		const parsedName = TaskNameSchema.parse(taskName);
		const existingTask = await this.coder.getTask(coderUsername, parsedName);

		if (existingTask) {
			core.info(
				`Task ${taskName} already exists (status: ${existingTask.status})`,
			);

			if (
				existingTask.status !== "active" ||
				existingTask.current_state?.state !== "idle"
			) {
				await this.coder.waitForTaskActive(
					coderUsername,
					existingTask.id,
					core.debug,
				);
			}

			const taskUrl = this.generateTaskUrl(
				coderUsername,
				String(existingTask.id),
			);
			return {
				taskName,
				taskUrl,
				taskStatus: existingTask.status,
				skipped: false,
			};
		}

		// 4. Build prompt
		const fullPrompt = this.inputs.prompt
			? `${this.inputs.prompt}\n\n${this.context.issueUrl}`
			: this.context.issueUrl;

		// 5. Get template and create task
		const template = await this.coder.getTemplateByOrganizationAndName(
			this.inputs.coderOrganization,
			this.inputs.coderTemplateName,
		);

		const presets = await this.coder.getTemplateVersionPresets(
			template.active_version_id,
		);
		let presetId: string | undefined;
		if (this.inputs.coderTemplatePreset) {
			const found = presets.find(
				(p) => p.Name === this.inputs.coderTemplatePreset,
			);
			if (!found)
				throw new Error(`Preset ${this.inputs.coderTemplatePreset} not found`);
			presetId = found.ID;
		} else {
			const defaultPreset = presets.find((p) => p.Default);
			presetId = defaultPreset?.ID;
		}

		const createdTask = await this.coder.createTask(coderUsername, {
			name: taskName,
			template_version_id: template.active_version_id,
			template_version_preset_id: presetId,
			input: fullPrompt,
		});

		const taskUrl = this.generateTaskUrl(coderUsername, String(createdTask.id));
		core.info(`Task created: ${taskUrl}`);

		// 6. Comment on issue
		await this.github.commentOnIssue(
			this.context.owner,
			this.context.repo,
			this.context.issueNumber,
			`Task created: ${taskUrl}`,
			"Task created:",
		);

		return {
			taskName,
			taskUrl,
			taskStatus: createdTask.status,
			skipped: false,
		};
	}

	private generateTaskUrl(coderUsername: string, taskId: string): string {
		const baseURL = this.inputs.coderURL.replace(/\/$/, "");
		return `${baseURL}/tasks/${coderUsername}/${taskId}`;
	}
}
