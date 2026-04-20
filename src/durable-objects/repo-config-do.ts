import { DurableObject } from "cloudflare:workers";
import {
	type RepoConfig,
	resolveRepoConfigSettings,
	type StoredRepoConfig,
} from "../config/repo-config-schema";

/**
 * Single-key identifier used inside the DO's sqlite-backed KV. The DO is
 * dedicated per-repository (routed by `idFromName(repositoryFullName)`), so a
 * fixed key is sufficient — we never need to store more than one envelope.
 */
const CONFIG_KEY = "config";

/**
 * Sqlite-backed Durable Object that stores a single `StoredRepoConfig`
 * envelope per repository (one DO instance per `repositoryFullName`).
 *
 * Passive store only — the DO performs no GitHub or Coder I/O (EARS-REQ-12).
 * Write-side validation and resolution happen in the RepoConfigWorkflow; this
 * class simply persists a sparse envelope and projects it into a fully
 * resolved `RepoConfig` on read.
 *
 * Storage API: uses the SYNCHRONOUS sqlite KV (`ctx.storage.kv.put/.get`) —
 * not the legacy async `ctx.storage.put/.get`. The migration in
 * `wrangler.toml` registers `RepoConfigDO` under `new_sqlite_classes`, so the
 * sync surface is available.
 */
export class RepoConfigDO extends DurableObject {
	async setRepoConfig(cfg: StoredRepoConfig): Promise<void> {
		this.ctx.storage.kv.put(CONFIG_KEY, cfg);
	}

	async getRepoConfig(): Promise<RepoConfig | null> {
		const stored = this.ctx.storage.kv.get(CONFIG_KEY) as
			| StoredRepoConfig
			| undefined;
		if (stored === undefined) {
			return null;
		}
		return {
			repositoryId: stored.repositoryId,
			repositoryFullName: stored.repositoryFullName,
			installationId: stored.installationId,
			settings: resolveRepoConfigSettings(stored.settings),
		};
	}
}
