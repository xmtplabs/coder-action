import type { TaskRunner } from "../services/task-runner";
import type { GitHubClient } from "../services/github/client";
import type { Logger } from "../infra/logger";
import type { ActionOutputs, HandlerConfig } from "../config/handler-config";
import { generateTaskName } from "./task-naming";

export interface IssueContext {
	owner: string;
	repo: string;
	issueNumber: number;
	issueUrl: string;
	issueTitle: string;
	issueLabels: string[];
	senderLogin: string;
	senderId: number;
}

export class CreateTaskAction {
	constructor(
		private readonly runner: TaskRunner,
		private readonly github: GitHubClient,
		private readonly inputs: HandlerConfig,
		private readonly context: IssueContext,
		private readonly logger: Logger,
	) {}

	async run(): Promise<ActionOutputs> {
		// 1. Validate actor has write access to the repo
		const hasAccess = await this.github.checkActorPermission(
			this.context.owner,
			this.context.repo,
			this.context.senderLogin,
		);
		if (!hasAccess) {
			this.logger.info(
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
		this.logger.info(`Task name: ${taskName}`);

		// 3. Resolve owner
		const owner = await this.runner.lookupUser({
			user: {
				type: "github",
				id: String(this.context.senderId),
				username: this.context.senderLogin,
			},
		});

		// 4. Check existing task — return immediately if found, no wait/create
		const existing = await this.runner.getStatus({ taskName, owner });
		if (existing) {
			this.logger.info(
				`Task ${taskName} already exists (status: ${existing.status})`,
			);
			return {
				taskName,
				taskUrl: existing.url,
				taskStatus: existing.status,
				skipped: false,
			};
		}

		// 5. Build prompt
		const input = this.inputs.prompt
			? `${this.inputs.prompt}\n\n${this.context.issueUrl}`
			: this.context.issueUrl;

		// 6. Create task
		const task = await this.runner.create({ taskName, owner, input });
		this.logger.info(`Task created: ${task.url}`);

		// 7. Comment on issue
		await this.github.commentOnIssue(
			this.context.owner,
			this.context.repo,
			this.context.issueNumber,
			`Task created: ${task.url}`,
			"Task created:",
		);

		// 8. Return
		return {
			taskName,
			taskUrl: task.url,
			taskStatus: task.status,
			skipped: false,
		};
	}
}
