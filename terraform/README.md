---
display_name: Task
description: An ephemeral template for autonomous AI coding tasks
icon: ../../../site/static/emojis/1f916.png
maintainer_github: neekolas
verified: true
tags: []
---

# Coder Tasks

Coder Tasks let you assign a GitHub issue to an AI agent that autonomously resolves it — reading the issue, writing code, running tests, and opening a PR. The agent runs in an ephemeral Coder workspace that is created when the task starts and destroyed when the issue closes.

## How It Works

```
Assign issue to agent user
        │
        ▼
GitHub App creates a Coder workspace
        │
        ▼
Agent reads the issue, explores the repo, writes a spec
        │
        ▼
Agent implements the fix/feature and opens a PR
        │
        ▼
Humans review the PR; comments are forwarded to the agent
        │
        ▼
CI failures are automatically sent to the agent to fix
        │
        ▼
Issue closes → workspace is deleted
```

The system has two parts:

- **This template** provisions an ephemeral Kubernetes pod with Claude Code running in fully autonomous mode. It parses a GitHub issue URL from the task prompt, clones the repo, and instructs the agent to resolve the issue.
- **[coder-action](https://github.com/xmtplabs/coder-action)** is a GitHub App that handles the lifecycle — creating workspaces when issues are assigned, forwarding PR comments and CI failures to the agent, and cleaning up when issues close.

## Adding Tasks to Your Repo

### Prerequisites

- A running Coder deployment with this template installed (e.g. [sandbox.xmtp.team](https://sandbox.xmtp.team))
- A GitHub user account for the agent (e.g. `xmtp-coder-agent`). Already exists.

### Setup

Install the [coder-action](https://github.com/xmtplabs/coder-action) GitHub App on your organization (all repos or select repos). The app receives webhooks directly from GitHub — no workflow files are needed in your repository.

The app handles five event types:

| Trigger | What happens |
|---------|-------------|
| Issue assigned to agent user | Creates a Coder workspace and starts the task |
| Issue closed | Stops and deletes the workspace |
| Comment on the issue | Forwarded to the running agent |
| Comment on the agent's PR | Forwarded to the running agent |
| CI check fails on agent's PR | Failed job logs are sent to the agent |

See the [coder-action README](https://github.com/xmtplabs/coder-action/blob/main/README.md) for GitHub App registration, deployment, and configuration details. This is already done for `xmtp` and `xmtplabs` repos.

### Repository Requirements

Your repo should have a `.devcontainer/devcontainer.json` so the workspace can build a development environment with the right toolchain. A minimal example:

```jsonc
// .devcontainer/devcontainer.json
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/docker-outside-of-docker:1": {}
  }
}
```

## Using Tasks

### Assigning an Issue

To start a task, assign a GitHub issue to your agent user (e.g. `xmtp-coder-agent`). The app validates that the assigner has write access to the repo, then creates a workspace.

A comment is posted on the issue with a link to the running task in the Coder dashboard.

### Interacting with the Agent

- **Issue comments** — post a comment on the issue to give the agent new instructions or context. The comment is forwarded to the agent's active session.
- **PR review comments** — review the agent's PR as you would any other. Comments are forwarded to the agent, which will attempt to address them.
- **CI failures** — if a monitored workflow fails on the agent's PR, the failed job logs are automatically sent to the agent so it can self-correct.

### Monitoring Progress

Open the task link from the issue comment to view the agent's terminal session in the Coder dashboard. You can watch it work in real time.

### Stopping a Task

Close the GitHub issue. The app deletes the workspace and frees all resources.

## What the Agent Does

Inside the workspace, the agent follows the [coder-task](https://github.com/xmtplabs/code-factory/blob/main/skills/coder-task/SKILL.md) workflow:

1. Reads the GitHub issue
2. Forks the repo and creates a working branch
3. Explores the codebase to understand relevant code and tests
4. Writes a spec (posted as an issue comment) if the issue doesn't already contain one
5. Decomposes the spec into implementation tasks
6. Implements the changes with tests
7. Opens a PR that references the issue

## Template Details

The template provisions:

- An ephemeral Kubernetes pod (destroyed when the task ends)
- A devcontainer built from the repo's `.devcontainer/devcontainer.json` via [envbuilder](https://github.com/coder/envbuilder)
- Docker-in-Docker sidecar for container builds
- Claude Code in fully autonomous mode with LSP support (Go, Rust, TypeScript)
- 30 GB workspace disk + 1 GB persistent agent state

Resources: 2 CPU / 8 GB memory guaranteed, burst to 8 CPU / 24 GB.
