# xmtplabs/coder-action

A Cloudflare Worker that receives GitHub webhooks and drives the lifecycle of [Coder](https://coder.com) AI tasks. When an issue is assigned to the agent, a PR comment is posted, or CI fails, the Worker signature-verifies the webhook and enqueues a durable [Cloudflare Workflow](https://developers.cloudflare.com/workflows/) instance that talks to the Coder API: creating task workspaces, forwarding comments as input, relaying failure logs, and cleaning up on issue closure.

## How It Works

```
GitHub ──POST /webhooks/github──▶  Worker (fetch handler)
                                  │  verify signature
                                  │  parse + route
                                  ▼
                            TASK_RUNNER_WORKFLOW.create(…)
                                  │
                                  ▼
                        TaskRunnerWorkflow (durable)
                                  │  step.do / step.sleep
                                  ▼
                        Coder API  +  GitHub API
```

Worker responds `202 Accepted` in milliseconds; the Workflow processes the event durably across isolate restarts and API failures, with automatic per-step retry and replay.

Two GitHub identities work together:
- **`@xmtp-coder-agent`** — forks repos, pushes code, opens pull requests
- **App bot (`@<app-slug>[bot]`)** — posts status comments and reacts to comments (never forwarded back to the agent as task input)

## Event Modes

| Trigger | Workflow does |
|---|---|
| `issues.assigned` to the coder agent | Creates a Coder task with the issue URL as input |
| `issues.closed` | Deletes the Coder task |
| `issue_comment` / `pull_request_review_comment` / `pull_request_review` on an agent PR | Forwards the comment (with structured context) to the task |
| `workflow_run.completed` with failure on an agent PR | Fetches job logs and forwards a failure summary to the task |

## Installation

See [docs/github-app-setup.md](docs/github-app-setup.md) for step-by-step instructions: creating the GitHub App, configuring webhook delivery, and installing it on your repositories.

## Configuration

All non-secret config lives in [`wrangler.toml`](wrangler.toml) under `[vars]`. Secrets are provisioned via `wrangler secret put` in production and `.dev.vars` locally (see [`.dev.vars.example`](.dev.vars.example)).

| Variable | Source | Description |
|---|---|---|
| `APP_ID` | secret | GitHub App ID |
| `PRIVATE_KEY` | secret | GitHub App private key (PEM format) |
| `WEBHOOK_SECRET` | secret | GitHub App webhook secret |
| `CODER_TOKEN` | secret | Coder API token |
| `CODER_URL` | var | Coder deployment URL |
| `AGENT_GITHUB_USERNAME` | var | GitHub username of the designated coder agent (default: `xmtp-coder-agent`) |
| `CODER_TASK_NAME_PREFIX` | var | Prefix for deterministic task names (default: `gh`) |
| `CODER_TEMPLATE_NAME` | var | Coder template for workspace creation (default: `task-template`) |
| `CODER_TEMPLATE_PRESET` | var (optional) | Template preset to use for `create_task` |
| `CODER_ORGANIZATION` | var | Coder organization (default: `default`) |
| `LOG_FORMAT` | var | `json` (production) or `pretty` (local dev) |

### Per-repo configuration

Consuming repositories may define a `.code-factory/config.toml` file to customize sandbox sizing, harness selection, scheduled jobs, and event hooks. See [docs/repo-config.md](docs/repo-config.md) for the full reference. A machine-readable JSON Schema is served at `/schema.json` for editor integration (Taplo, VS Code).

## Running

```bash
npm install

npm run dev         # wrangler dev — local Miniflare + Workflow emulation on :8787
npm run deploy      # wrangler deploy
npm test            # vitest inside workerd
npm run check       # typecheck + lint + format:check + test
```

### Local webhooks

`wrangler dev` binds the Worker locally but GitHub can't reach `localhost`. Pipe a public URL with `cloudflared`:

```bash
npx cloudflared tunnel --url http://localhost:8787
# Point the GitHub App's webhook URL at the resulting trycloudflare.com URL.
```

Workflows are not supported as remote bindings, so `wrangler dev --remote` will not work for this project.

## Task Naming

Tasks use deterministic names: `{prefix}-{repo}-{issue_number}` (e.g., `gh-libxmtp-42`). Every handler locates the correct task from just the repo name and issue number — no separate lookup needed.

## Architecture + Development

See [CLAUDE.md](CLAUDE.md) for the architecture overview and conventions.

## License

MIT
