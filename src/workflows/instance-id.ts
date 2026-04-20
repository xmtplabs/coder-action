import type { Event } from "../events/types";

const SANITIZE = /[^a-zA-Z0-9_-]/g;
const MAX_LEN = 64;

/**
 * Produce a deterministic Workflow instance ID for an event + delivery. The
 * composite format `${eventType}-${repo}-${issueOrPr}-${deliveryId}` makes
 * duplicate GitHub deliveries (same `X-GitHub-Delivery`) collapse to the same
 * instance — `WORKFLOW.create()` then errors with "already exists", which the
 * Worker catches via `isDuplicateInstanceError` and returns `200` for.
 *
 * The output is sanitized to the Workflow instance charset `[a-zA-Z0-9_-]{1,64}`.
 */
export function buildInstanceId(event: Event, deliveryId: string): string {
	const raw = (() => {
		switch (event.type) {
			case "task_requested":
			case "task_closed":
				return `${event.type}-${event.repository.name}-${event.issue.number}-${deliveryId}`;
			case "comment_posted":
				return `${event.type}-${event.repository.name}-${event.target.number}-${deliveryId}`;
			case "check_failed": {
				const n = event.pullRequestNumbers[0];
				// Always use `event.type` as the prefix so log/grep patterns are
				// uniform across the event taxonomy. The trailing segment is either
				// the linked PR number (preferred) or the run id fallback.
				return n != null
					? `${event.type}-${event.repository.name}-${n}-${deliveryId}`
					: `${event.type}-${event.run.id}-${deliveryId}`;
			}
			case "config_push":
				return `${event.type}-${event.repository.name}-${event.head.sha}-${deliveryId}`;
		}
	})();
	return raw.replace(SANITIZE, "-").slice(0, MAX_LEN);
}

/**
 * Match the Workflows engine error that indicates an instance with the given
 * ID already exists. The handler treats this as success (natural dedupe).
 */
export function isDuplicateInstanceError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return /already exists/i.test(err.message);
}
