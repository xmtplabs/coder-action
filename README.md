# xmtplabs/coder-action

A GitHub App webhook server that manages [Coder](https://coder.com) AI task lifecycle from GitHub events. It creates task workspaces from issue assignments, forwards PR and issue comments to the running agent, relays CI failure logs, and cleans up when issues are closed.

## How It Works

The app runs as an HTTP server that receives GitHub webhook payloads. When a relevant event arrives (issue assigned, comment posted, CI failed), the server routes it to the appropriate handler, which interacts with the Coder API to create, update, or stop a task workspace.

Two GitHub identities work together:
- **`@xmtp-coder-agent`** — Forks repos, pushes code, opens pull requests
- **App bot** — Posts status comments and reacts to comments

## Installation

See [docs/github-app-setup.md](docs/github-app-setup.md) for step-by-step instructions on creating the GitHub App, configuring webhook delivery, and installing it on your repositories.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CODER_URL` | Yes | Coder deployment URL (e.g. `https://coder.example.com`) |
| `CODER_TOKEN` | Yes | Coder API token with task creation and send permissions |
| `CODER_USERNAME` | No | Coder username that owns tasks (default: `xmtp-coder-agent`) |
| `CODER_TASK_NAME_PREFIX` | No | Prefix for deterministic task names (default: `gh`) |
| `CODER_TEMPLATE_NAME` | No | Coder template for workspace creation (default: `task-template`) |
| `CODER_TEMPLATE_PRESET` | No | Template preset to use for `create_task` |
| `CODER_ORGANIZATION` | No | Coder organization (default: `default`) |
| `GITHUB_APP_ID` | Yes | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | Yes | GitHub App private key (PEM format) |
| `GITHUB_APP_WEBHOOK_SECRET` | Yes | GitHub App webhook secret for payload verification |
| `GITHUB_AGENT_USERNAME` | No | GitHub username of the designated coder agent (default: `xmtp-coder-agent`) |
| `PORT` | No | HTTP server port (default: `3000`) |
| `PROMPT` | No | Custom prompt text — issue URL is always appended (`create_task` only) |

## Running

```bash
# Install dependencies
bun install

# Start production server
bun run start

# Start with watch mode (development)
bun run dev
```

## Task Naming

Tasks use deterministic names: `{prefix}-{repo}-{issue_number}` (e.g., `gh-libxmtp-42`). This lets any handler locate the correct task from just the repo name and issue number, without a separate lookup.

## Development

See [AGENTS.md](AGENTS.md) for architecture, key files, development commands, and conventions.

```bash
bun run check        # typecheck + lint + format:check + test
```

## License

MIT
