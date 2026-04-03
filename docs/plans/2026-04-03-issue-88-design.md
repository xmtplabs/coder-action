# Issue 88 Design

## Summary

Issue 88 requires the `create_task` flow to instruct the downstream coding agent to speak like a pirate when a task is first created. The change should affect only the initial task input payload built by `CreateTaskHandler`, while preserving the existing optional base prompt and required issue URL context.

## Project Goals & Non-Goals

**Goals**

- Add a deterministic pirate-speaking instruction to new task input created from `issues.assigned`.
- Preserve the configured base prompt when `PROMPT` is set.
- Preserve the issue URL in the task input so task creation still points the agent at the source issue.
- Cover the new behavior with focused unit tests in the existing `create-task` handler test suite.

**Non-Goals**

- Changing comment forwarding behavior for PR comments, issue comments, or failed checks.
- Introducing configurable personas or new environment variables.
- Changing task naming, template selection, permission checks, or GitHub commenting behavior.

## Context

- **Catalyst:** [Issue #88](https://github.com/xmtplabs/coder-action/issues/88)
- **Relevant code:** `src/handlers/create-task.ts`, `src/handlers/create-task.test.ts`, `README.md`
- **Impact area:** Initial task prompt construction for the `create_task` handler

## System Design

`CreateTaskHandler.run()` currently builds the task input as either `PROMPT + issue URL` or only the issue URL. The handler will instead build the input from ordered sections:

1. Optional configured base prompt
2. Fixed pirate-speaking instruction
3. Issue URL

The implementation should keep the formatting simple and deterministic by joining only present sections with blank lines. This keeps existing behavior stable while ensuring every newly created task receives the persona instruction.

## Libraries & Utilities Required

**External dependencies:** None

**Internal modules:**

| Module | Path | Purpose |
|--------|------|---------|
| CreateTaskHandler | `src/handlers/create-task.ts` | Builds task input and creates tasks |
| CreateTaskHandler tests | `src/handlers/create-task.test.ts` | Verifies prompt construction and handler behavior |

## Testing & Validation

### Acceptance Criteria

1. WHEN `CreateTaskHandler` creates a new task THE SYSTEM SHALL include an instruction telling the agent to speak like a pirate in the task input.
2. WHEN a configured base prompt exists THE SYSTEM SHALL preserve that prompt and append the pirate instruction before the issue URL.
3. WHEN no configured base prompt exists THE SYSTEM SHALL still include both the pirate instruction and the issue URL in the task input.
4. THE SYSTEM SHALL NOT change task creation behavior for existing-task reuse, permission checks, template selection, or GitHub issue commenting.

### Edge Cases

- Ensure the new instruction is present exactly once when a base prompt exists.
- Ensure blank-line formatting remains stable so tests can assert exact prompt content.
- Ensure existing task reuse path does not attempt to rebuild or send a new task input.

### Verification Commands

- `bun test src/handlers/create-task.test.ts`
- `bun test`
- `bun run typecheck`
- `bun run lint`
