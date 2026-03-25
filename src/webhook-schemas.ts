import { z } from "zod";

// ── Common sub-schemas ────────────────────────────────────────────────────────

export const WebhookInstallationSchema = z
	.object({
		id: z.number(),
	})
	.passthrough();

export const WebhookRepositorySchema = z
	.object({
		name: z.string(),
		owner: z
			.object({
				login: z.string(),
			})
			.passthrough(),
		full_name: z.string(),
	})
	.passthrough();

export const WebhookSenderSchema = z
	.object({
		id: z.number(),
		login: z.string(),
	})
	.passthrough();

// ── Event payload schemas ─────────────────────────────────────────────────────

export const IssuesAssignedPayloadSchema = z
	.object({
		action: z.literal("assigned"),
		assignee: z
			.object({
				login: z.string(),
				id: z.number(),
			})
			.passthrough(),
		issue: z
			.object({
				number: z.number(),
				html_url: z.string(),
			})
			.passthrough(),
		sender: WebhookSenderSchema,
		repository: WebhookRepositorySchema,
		installation: WebhookInstallationSchema,
	})
	.passthrough();

export const IssuesClosedPayloadSchema = z
	.object({
		action: z.literal("closed"),
		issue: z
			.object({
				number: z.number(),
			})
			.passthrough(),
		repository: WebhookRepositorySchema,
		installation: WebhookInstallationSchema,
	})
	.passthrough();

export const IssueCommentCreatedPayloadSchema = z
	.object({
		action: z.string(),
		issue: z
			.object({
				number: z.number(),
				pull_request: z
					.object({
						url: z.string(),
					})
					.passthrough()
					.nullable()
					.optional(),
				user: z
					.object({
						login: z.string(),
					})
					.passthrough(),
			})
			.passthrough(),
		comment: z
			.object({
				id: z.number(),
				body: z.string(),
				html_url: z.string(),
				created_at: z.string(),
				user: z
					.object({
						login: z.string(),
					})
					.passthrough(),
			})
			.passthrough(),
		sender: WebhookSenderSchema,
		repository: WebhookRepositorySchema,
		installation: WebhookInstallationSchema,
	})
	.passthrough();

export const PRReviewCommentCreatedPayloadSchema = z
	.object({
		action: z.string(),
		pull_request: z
			.object({
				number: z.number(),
				user: z
					.object({
						login: z.string(),
					})
					.passthrough(),
			})
			.passthrough(),
		comment: z
			.object({
				id: z.number(),
				body: z.string(),
				html_url: z.string(),
				created_at: z.string(),
				user: z
					.object({
						login: z.string(),
					})
					.passthrough(),
			})
			.passthrough(),
		sender: WebhookSenderSchema,
		repository: WebhookRepositorySchema,
		installation: WebhookInstallationSchema,
	})
	.passthrough();

export const PRReviewSubmittedPayloadSchema = z
	.object({
		action: z.literal("submitted"),
		pull_request: z
			.object({
				number: z.number(),
				user: z
					.object({
						login: z.string(),
					})
					.passthrough(),
			})
			.passthrough(),
		review: z
			.object({
				id: z.number(),
				body: z.string().nullable(),
				html_url: z.string(),
				submitted_at: z.string(),
				user: z
					.object({
						login: z.string(),
					})
					.passthrough(),
			})
			.passthrough(),
		sender: WebhookSenderSchema,
		repository: WebhookRepositorySchema,
		installation: WebhookInstallationSchema,
	})
	.passthrough();

export const WorkflowRunCompletedPayloadSchema = z
	.object({
		action: z.literal("completed"),
		workflow_run: z
			.object({
				id: z.number(),
				name: z.string(),
				path: z.string().nullable().optional(),
				head_sha: z.string(),
				html_url: z.string(),
				conclusion: z.string().nullable(),
				pull_requests: z.array(
					z
						.object({
							number: z.number(),
						})
						.passthrough(),
				),
			})
			.passthrough(),
		repository: WebhookRepositorySchema,
		installation: WebhookInstallationSchema,
	})
	.passthrough();

// ── Inferred types ─────────────────────────────────────────────────────────────

export type IssuesAssignedPayload = z.infer<typeof IssuesAssignedPayloadSchema>;
export type IssuesClosedPayload = z.infer<typeof IssuesClosedPayloadSchema>;
export type IssueCommentCreatedPayload = z.infer<
	typeof IssueCommentCreatedPayloadSchema
>;
export type PRReviewCommentCreatedPayload = z.infer<
	typeof PRReviewCommentCreatedPayloadSchema
>;
export type PRReviewSubmittedPayload = z.infer<
	typeof PRReviewSubmittedPayloadSchema
>;
export type WorkflowRunCompletedPayload = z.infer<
	typeof WorkflowRunCompletedPayloadSchema
>;
