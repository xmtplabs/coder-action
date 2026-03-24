# xmtplabs/coder-action

A GitHub Action that manages [Coder](https://coder.com) AI task lifecycle from GitHub events. It creates tasks from issue assignments, forwards PR and issue comments to the running agent, relays CI failure logs, and cleans up when issues are closed.

## Modes

| Mode | Trigger | What it does |
|------|---------|--------------|
| `create_task` | Issue assigned | Creates a Coder task for the issue, validates org membership, comments with task URL |
| `close_task` | Issue closed | Stops and deletes the Coder task's workspace |
| `pr_comment` | PR comment | Forwards the comment to the agent working on the linked issue |
| `issue_comment` | Issue comment | Forwards the comment to the agent working on the issue |
| `failed_check` | CI workflow failure | Fetches failed job logs and sends them to the agent so it can self-correct |

## Quick Start

Add one workflow file to your repository. It handles the full lifecycle.

### `.github/workflows/coder.yml`

Handles issue assignment, closure, comment forwarding, and CI failure detection. **Customize the `workflows` list** under `workflow_run` to match the `name:` field of your CI workflow files.

```yaml
name: Coder Agent

on:
  issues:
    types: [assigned, closed]
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
  workflow_run:
    workflows: ["CI"]  # Change this to match your CI workflow names
    types: [completed]

permissions:
  actions: read
  issues: write
  pull-requests: write
  contents: read

jobs:
  create-task:
    runs-on: ubuntu-latest
    if: >-
      github.event_name == 'issues'
      && github.event.action == 'assigned'
      && github.event.assignee.login == 'xmtp-coder-agent'
    steps:
      - name: Create Coder Task
        uses: xmtplabs/coder-action@main
        with:
          action: create_task
          coder-url: ${{ secrets.CODER_URL }}
          coder-token: ${{ secrets.CODER_TOKEN }}
          prompt: |
            You are an autonomous AI agent. Resolve the GitHub issue below.
            Read the issue, develop a plan, post it as a comment, then implement and open a PR.

  close-task:
    runs-on: ubuntu-latest
    if: >-
      github.event_name == 'issues'
      && github.event.action == 'closed'
    steps:
      - name: Close Coder Task
        uses: xmtplabs/coder-action@main
        with:
          action: close_task
          coder-url: ${{ secrets.CODER_URL }}
          coder-token: ${{ secrets.CODER_TOKEN }}

  pr-comment:
    runs-on: ubuntu-latest
    if: >-
      github.event_name == 'issue_comment'
      && github.event.action == 'created'
      && github.event.issue.pull_request
      && github.event.issue.user.login == 'xmtp-coder-agent'
      && github.event.comment.user.login != 'xmtp-coder-agent'
    steps:
      - name: Forward PR Comment to Coder Task
        uses: xmtplabs/coder-action@main
        with:
          action: pr_comment
          coder-url: ${{ secrets.CODER_URL }}
          coder-token: ${{ secrets.CODER_TOKEN }}

  pr-review-comment:
    runs-on: ubuntu-latest
    if: >-
      github.event_name == 'pull_request_review_comment'
      && github.event.action == 'created'
      && github.event.pull_request.user.login == 'xmtp-coder-agent'
      && github.event.comment.user.login != 'xmtp-coder-agent'
    steps:
      - name: Forward PR Review Comment to Coder Task
        uses: xmtplabs/coder-action@main
        with:
          action: pr_comment
          coder-url: ${{ secrets.CODER_URL }}
          coder-token: ${{ secrets.CODER_TOKEN }}

  pr-review:
    runs-on: ubuntu-latest
    if: >-
      github.event_name == 'pull_request_review'
      && github.event.action == 'submitted'
      && github.event.pull_request.user.login == 'xmtp-coder-agent'
      && github.event.review.user.login != 'xmtp-coder-agent'
      && github.event.review.body != ''
    steps:
      - name: Forward PR Review to Coder Task
        uses: xmtplabs/coder-action@main
        with:
          action: pr_comment
          coder-url: ${{ secrets.CODER_URL }}
          coder-token: ${{ secrets.CODER_TOKEN }}

  issue-comment:
    runs-on: ubuntu-latest
    if: >-
      github.event_name == 'issue_comment'
      && github.event.action == 'created'
      && !github.event.issue.pull_request
      && github.event.comment.user.login != 'xmtp-coder-agent'
    steps:
      - name: Forward Issue Comment to Coder Task
        uses: xmtplabs/coder-action@main
        with:
          action: issue_comment
          coder-url: ${{ secrets.CODER_URL }}
          coder-token: ${{ secrets.CODER_TOKEN }}

  failed-check:
    runs-on: ubuntu-latest
    if: >-
      github.event_name == 'workflow_run'
      && github.event.workflow_run.conclusion == 'failure'
    steps:
      - name: Forward Failed Check to Coder Task
        uses: xmtplabs/coder-action@main
        with:
          action: failed_check
          coder-url: ${{ secrets.CODER_URL }}
          coder-token: ${{ secrets.CODER_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `action` | Yes | — | Mode: `create_task`, `close_task`, `pr_comment`, `issue_comment`, `failed_check` |
| `coder-url` | Yes | — | Coder deployment URL |
| `coder-token` | Yes | — | Coder API session token |
| `coder-username` | No | `xmtp-coder-agent` | Coder username that owns tasks |
| `github-token` | No | `GITHUB_TOKEN` | GitHub token for API operations (auto-detected from environment) |
| `coder-task-name-prefix` | No | `gh` | Prefix for deterministic task names |
| `coder-template-name` | No | `task-template` | Coder template for workspace creation (`create_task` only) |
| `coder-template-preset` | No | — | Template preset to use (`create_task` only) |
| `coder-organization` | No | `default` | Coder organization (`create_task` only) |
| `prompt` | No | — | Custom prompt text — issue URL is always appended (`create_task` only) |
| `coder-github-username` | No | `xmtp-coder-agent` | GitHub username of the designated coder agent |

## Outputs

| Output | Description |
|--------|-------------|
| `task-name` | The deterministic task name (e.g., `gh-myrepo-42`) |
| `task-url` | URL to view the task in Coder |
| `task-status` | Task status after the action completes |
| `skipped` | `"true"` if the action was skipped |
| `skip-reason` | Why the action was skipped (e.g., `insufficient-permissions`, `self-comment`, `task-not-found`) |

## Required Secrets

| Secret | Description |
|--------|-------------|
| `CODER_URL` | Coder deployment URL (e.g., `https://sandbox.xmtp.team`) |
| `CODER_TOKEN` | Coder API token with task creation and send permissions |

The `github-token` input uses the default `${{ github.token }}` provided by GitHub Actions. The `coder-username` defaults to `xmtp-coder-agent`. A GitHub PAT for git operations is configured in the Coder task template, not needed at the workflow level.

## How It Works

### Task Naming

Tasks use deterministic names: `{prefix}-{repo}-{issue_number}` (e.g., `gh-libxmtp-42`). This allows any mode to locate the correct task from just the repo name and issue number, without querying the Coder API first.

### Permission Validation

When `create_task` runs, it verifies the actor (the person who assigned the issue) has write access to the repository. Users without write access are rejected with a clear log message. This prevents unauthorized users from spawning Coder tasks.

### Comment Forwarding

PR and issue comments are wrapped in a structured message that gives the agent context:

- **Who** commented and **when**
- A link to the comment
- Instructions to react with a eyes emoji, implement valid suggestions, and reply

### Failed Check Forwarding

When a monitored CI workflow fails on a PR authored by the coder agent:

1. The action checks if the failure is for the PR's current head commit (skips stale failures)
2. Fetches the failed job logs (last 100 lines per job, max 5 jobs)
3. Sends the logs to the agent with instructions to fix and push

### PR to Issue Linking

The `pr_comment` and `failed_check` modes need to find the Coder task for a PR. Since tasks are keyed by issue number, the action uses a GraphQL query to find the PR's linked closing issue (`closingIssuesReferences`).

## Development

```bash
bun install          # Install dependencies
bun test             # Run tests (75 tests)
bun run typecheck    # TypeScript type checking
bun run lint         # Biome linter
bun run format       # Biome formatter
bun run build        # Bundle to dist/index.js
bun run check        # All of the above
```

## License

MIT
