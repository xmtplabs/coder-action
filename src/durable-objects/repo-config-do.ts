import { DurableObject } from "cloudflare:workers";
import {
	type RepoConfig,
	resolveRepoConfigSettings,
	type StoredRepoConfig,
} from "../config/repo-config-schema";

/**
 * Per-field keys in the DO's sqlite-backed KV. The DO is dedicated
 * per-repository (routed by `idFromName(repositoryFullName)`), so each key
 * holds at most one value. The `config` key holds only the sparse settings
 * from the TOML file; identity fields live in their own keys.
 */
const KEY_REPOSITORY_ID = "repositoryId";
const KEY_REPOSITORY_FULL_NAME = "repositoryFullName";
const KEY_INSTALLATION_ID = "installationId";
const KEY_CONFIG = "config";

/**
 * Sqlite-backed Durable Object that stores a `StoredRepoConfig` per
 * repository (one DO instance per `repositoryFullName`), split across four
 * KV keys: identity fields live in their own keys, and the `config` key holds
 * only the sparse settings parsed from the TOML file.
 *
 * Passive store only — the DO performs no GitHub or Coder I/O (EARS-REQ-12).
 * Write-side validation and resolution happen in the RepoConfigWorkflow; this
 * class simply persists each field and projects into a fully resolved
 * `RepoConfig` on read.
 *
 * Storage API: uses the SYNCHRONOUS sqlite KV (`ctx.storage.kv.put/.get`) —
 * not the legacy async `ctx.storage.put/.get`. The migration in
 * `wrangler.toml` registers `RepoConfigDO` under `new_sqlite_classes`, so the
 * sync surface is available. The four `.put` calls in `setRepoConfig` run
 * back-to-back with no awaits between them, so they commit as a single
 * implicit transaction.
 */
export class RepoConfigDO extends DurableObject {
	async setRepoConfig(cfg: StoredRepoConfig): Promise<void> {
		this.ctx.storage.kv.put(KEY_REPOSITORY_ID, cfg.repositoryId);
		this.ctx.storage.kv.put(KEY_REPOSITORY_FULL_NAME, cfg.repositoryFullName);
		this.ctx.storage.kv.put(KEY_INSTALLATION_ID, cfg.installationId);
		this.ctx.storage.kv.put(KEY_CONFIG, cfg.settings);
	}

	async getRepoConfig(): Promise<RepoConfig | null> {
		const settings = this.ctx.storage.kv.get(KEY_CONFIG) as
			| StoredRepoConfig["settings"]
			| undefined;
		if (settings === undefined) {
			return null;
		}
		return {
			repositoryId: this.ctx.storage.kv.get(KEY_REPOSITORY_ID) as number,
			repositoryFullName: this.ctx.storage.kv.get(
				KEY_REPOSITORY_FULL_NAME,
			) as string,
			installationId: this.ctx.storage.kv.get(KEY_INSTALLATION_ID) as number,
			settings: resolveRepoConfigSettings(settings),
		};
	}
}
