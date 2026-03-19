# Issue #35: Failed issue comment run — Design

## Problem

The `pr-comment` job fails with:
```
Resource not accessible by integration
https://docs.github.com/rest/reactions/reactions#create-reaction-for-an-issue-comment
```

The action successfully forwards the PR comment to the Coder task but then crashes when
trying to add an "eyes" reaction (`👀`) to the comment. The GitHub REST API endpoint
`POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions` requires
`pull-requests: write` permission when the comment is on a pull request. The current
workflow only grants `pull-requests: read`.

## Root Cause

Both workflow files set:
```yaml
permissions:
  pull-requests: read   # insufficient for reaction on PR comments
```

The `addReactionToComment` helper in `github-client.ts` calls
`octokit.rest.reactions.createForIssueComment`, which requires `pull-requests: write`
for comments that belong to a pull request.

## EARS Requirements

- **REQ-1**: When: the `pr-comment` action handler successfully forwards a comment,
  Then: the system SHALL add an "eyes" reaction to the comment without error.
- **REQ-2**: The `pr-comment` workflow job SHALL be granted `pull-requests: write`
  permission so it can add reactions to PR comments.
- **REQ-3**: The example workflow (`examples/workflows/coder.yml`) SHALL reflect the
  same updated permission to keep it consistent with the real workflow.
- **REQ-4 (resilience)**: When adding a reaction fails (e.g. insufficient permissions
  or network error), the action SHALL log a warning and complete successfully rather
  than marking the run as failed, because the primary operation (forwarding the comment)
  already succeeded.

## System Design

### Change 1 — Workflow permissions (`.github/workflows/coder.yml`)

```yaml
permissions:
  actions: read
  issues: write
  pull-requests: write   # changed from read
  contents: read
```

### Change 2 — Example workflow (`examples/workflows/coder.yml`)

Same permission change as Change 1.

### Change 3 — Resilient reaction (`src/github-client.ts`)

Wrap the `createForIssueComment` call in a try/catch. On failure, log a warning via
`core.warning` rather than throwing. This way the action never fails solely because of a
reaction error.

Note: both `pr-comment.ts` and `issue-comment.ts` call `addReactionToComment`; making
the client method itself resilient handles both call sites without duplicating
error-handling logic.

## Testing & Validation

- Existing unit tests for `PRCommentHandler` and `IssueCommentHandler` must remain
  green.
- Add a unit test for `addReactionToComment` in `github-client.ts` that verifies:
  - when the API throws, the method does NOT re-throw (resilience).
- `bun run check` (typecheck + lint + format + test) must pass.
- `bun run build` must succeed and `dist/index.js` must be updated.
