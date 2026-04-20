import { NonRetryableError } from "cloudflare:workflows";
import { parse } from "smol-toml";
import { z } from "zod";

// ── Shared enums ─────────────────────────────────────────────────────────────

/** Allowed values for `sandbox.size`. */
export const SandboxSizeSchema = z.enum(["small", "medium", "large"]);

/** Allowed values for `harness.provider`. */
export const HarnessProviderSchema = z.enum(["claude", "codex"]);

// ── Sparse (stored) schemas ──────────────────────────────────────────────────
// Sparse schemas mirror what users actually wrote in TOML. No `.default()`:
// defaults are applied at read time, not write time, so we can distinguish
// "unset" from "explicitly set to the default value" when needed.

/** Sparse shape for a single sandbox volume entry. `path` is required. */
export const StoredSandboxVolumeSchema = z.object({
	path: z.string(),
	size: z.string().optional(),
});

/** Sparse shape for the `[sandbox]` section. */
export const StoredSandboxSchema = z.object({
	size: SandboxSizeSchema.optional(),
	docker: z.boolean().optional(),
	volumes: z.array(StoredSandboxVolumeSchema).optional(),
});

/** Sparse shape for the `[harness]` section. */
export const StoredHarnessSchema = z.object({
	provider: HarnessProviderSchema.optional(),
});

/**
 * A scheduled job entry. Leaf entries — either present with all fields, or
 * absent entirely. No partial storage.
 */
export const ScheduledJobSchema = z.object({
	name: z.string(),
	branch: z.string(),
	schedule: z.string(),
	prompt: z.string(),
});

/** Top-level sparse shape as stored by the DO. */
export const StoredRepoConfigSettingsSchema = z.object({
	sandbox: StoredSandboxSchema.optional(),
	harness: StoredHarnessSchema.optional(),
	scheduled_jobs: z.array(ScheduledJobSchema).optional(),
});

// ── Resolved (read-side) schemas ─────────────────────────────────────────────
// Resolved schemas apply defaults on read so every consumer sees a fully
// populated object without worrying about whether a field was written.

/** Resolved volume: `size` defaults to `"10gb"` when absent. */
export const ResolvedSandboxVolumeSchema = z.object({
	path: z.string(),
	size: z.string().default("10gb"),
});

/** Resolved sandbox: size/docker/volumes all have defaults. */
export const ResolvedSandboxSchema = z.object({
	size: SandboxSizeSchema.default("medium"),
	docker: z.boolean().default(false),
	volumes: z.array(ResolvedSandboxVolumeSchema).default([]),
});

/** Resolved harness: provider defaults to `"claude"`. */
export const ResolvedHarnessSchema = z.object({
	provider: HarnessProviderSchema.default("claude"),
});

/**
 * Top-level resolved shape — always fully populated after `.parse()`.
 *
 * We use `.prefault({})` on object sub-schemas (not `.default({})`) because
 * in Zod v4, `.default(value)` bypasses validation and returns `value` as-is,
 * so inner field defaults would NOT be applied. `.prefault({})` substitutes
 * `{}` as the input and then runs it through the child schema, correctly
 * triggering each inner `.default(...)`.
 */
export const RepoConfigSettingsSchema = z.object({
	sandbox: ResolvedSandboxSchema.prefault({}),
	harness: ResolvedHarnessSchema.prefault({}),
	scheduled_jobs: z.array(ScheduledJobSchema).default([]),
});

// ── Types ────────────────────────────────────────────────────────────────────

/** Sparse settings as stored in the DO (fields may be missing). */
export type StoredRepoConfigSettings = z.infer<
	typeof StoredRepoConfigSettingsSchema
>;

/** Fully resolved settings with defaults applied — safe to consume. */
export type RepoConfigSettings = z.infer<typeof RepoConfigSettingsSchema>;

/** Stored RepoConfig envelope (DO record). */
export type StoredRepoConfig = {
	repositoryId: number;
	repositoryFullName: string;
	installationId: number;
	settings: StoredRepoConfigSettings;
};

/** Resolved RepoConfig envelope — defaults applied for consumers. */
export type RepoConfig = {
	repositoryId: number;
	repositoryFullName: string;
	installationId: number;
	settings: RepoConfigSettings;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Apply read-side defaults to a (possibly undefined) sparse settings object.
 * Pure — no I/O, no side effects. Safe to call inside `step.do` callbacks.
 */
export function resolveRepoConfigSettings(
	stored?: StoredRepoConfigSettings | undefined,
): RepoConfigSettings {
	return RepoConfigSettingsSchema.parse(stored ?? {});
}

/**
 * Parse a TOML string into a sparse, validated `StoredRepoConfigSettings`.
 *
 * Invariants:
 *   - Unknown keys are silently dropped (Zod default `.strip()` behavior) so
 *     repos can land forward-compatible config before the server knows about
 *     it.
 *   - No defaults are materialized here — this is the write path. Defaults
 *     live in `resolveRepoConfigSettings`.
 *   - Error messages NEVER include raw input values. We assemble messages from
 *     `issue.path` + `issue.message` only, so a malformed value that happens
 *     to contain a secret cannot leak into logs or thrown exceptions.
 *
 * Throws `NonRetryableError` on any failure — TOML syntax or schema violation.
 */
export function parseRepoConfigToml(raw: string): StoredRepoConfigSettings {
	let parsed: unknown;
	try {
		parsed = parse(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new NonRetryableError(`Invalid TOML: ${message}`);
	}

	const result = StoredRepoConfigSettingsSchema.safeParse(parsed);
	if (!result.success) {
		// Build the error message from Zod issue paths + messages ONLY — never
		// include `issue.input` or any raw value. See module docstring for the
		// secret-leak invariant.
		const issues = result.error.issues
			.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
			.join("; ");
		throw new NonRetryableError(`Invalid RepoConfig: ${issues}`);
	}

	return result.data;
}
