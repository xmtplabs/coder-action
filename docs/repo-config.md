# Repo Config (`.code-factory/config.toml`)

## Overview

Each repository that uses coder-action may include an optional `.code-factory/config.toml` file at the repository root. The file uses standard TOML syntax. Unknown keys are silently stripped (Zod `.strip()` behavior), so repositories can land forward-compatible config before the server knows about a new field. Validation runs on the write path via `parseRepoConfigToml` whenever a config push event is processed.

## Editor integration

Point [Taplo](https://taplo.tamasfe.dev/) or the VS Code TOML extension at the served `/schema.json` endpoint to get hover docs and inline validation.

Top-of-file directive (no extra tooling required):

```toml
#:schema https://task-action.xmtp.team/schema.json
```

Or add a `.taplo.toml` file at the repository root:

```toml
[schema]
path = "https://task-action.xmtp.team/schema.json"
include = [".code-factory/config.toml"]
```

The schema is generated from the fully resolved Zod shape in input mode, so `default` values are visible in editor hover tooltips.

## `[sandbox]`

| Field | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `size` | `"small"` \| `"medium"` \| `"large"` | `"medium"` | No | Controls sandbox instance sizing. |
| `docker` | boolean | `false` | No | Enables docker-in-docker inside the sandbox. |
| `volumes` | array of `[[sandbox.volumes]]` | `[]` | No | Persistent volumes attached to the sandbox. |

## `[[sandbox.volumes]]`

| Field | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `path` | string | — | Yes | Mount point inside the sandbox. |
| `size` | volume-size string | `"10Gi"` | No | Accepts common variants (`10gb`, `10GB`, `10G`, `10gi`, `10Gi`) and is always normalized to the canonical binary-SI form (`10Gi`, `500Mi`, `2Ti`, `64Ki`). Supports K/M/G/T prefixes. |

## `[harness]`

| Field | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `provider` | `"claude_code"` \| `"codex"` | `"claude_code"` | No | Selects the code-agent harness. |

## `[[scheduled_jobs]]`

| Field | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `name` | string | — | Yes | Display name for the scheduled job. |
| `branch` | string | — | Yes | Branch the job runs against. |
| `schedule` | string | — | Yes | Cron expression (e.g. `"0 9 * * 1"`). |
| `prompt` | string | — | Yes | Prompt forwarded to the agent when the job fires. |

## `[[on_event.failed_run]]`

| Field | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `workflows` | array of strings | — | Yes | Workflow names (as they appear in GitHub Actions) to watch. Must be non-empty. |
| `branches` | array of strings | — | Yes | Branches on which a failed `workflow_run` triggers this event. Must be non-empty. |
| `prompt_additions` | string | — | No | Extra prompt context forwarded to the task. |

**Schema-only in this release — no consumer yet.** The block validates today; event dispatch is a future change.

## Examples

Minimal config (sandbox defaults apply):

```toml
[sandbox]
size = "large"
```

Full config (every section populated):

```toml
[sandbox]
size = "large"
docker = true

[[sandbox.volumes]]
path = "/home/user/data"
size = "20Gi"

[[sandbox.volumes]]
path = "/tmp/cache"
size = "5Gi"

[harness]
provider = "claude_code"

[[scheduled_jobs]]
name = "weekly-audit"
branch = "main"
schedule = "0 9 * * 1"
prompt = "Run the dependency audit and open a PR with any updates."

[[on_event.failed_run]]
workflows = ["ci.yml", "deploy.yml"]
branches = ["main", "release"]
prompt_additions = "Focus on the failing step and propose a fix."
```

## JSON Schema

The Worker serves the JSON Schema at `GET /schema.json`. The schema reflects the latest deploy of the Worker and is generated directly from the Zod validation shape, so it always matches what `parseRepoConfigToml` accepts. Use the endpoint URL in Taplo or VS Code as shown in the Editor integration section above.
