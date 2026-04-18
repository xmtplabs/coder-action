export type EventSource = { type: "github"; installationId: number };

export type TaskRequestedEvent = {
	type: "task_requested";
	source: EventSource;
	repository: { owner: string; name: string };
	issue: { number: number; url: string };
	requester: { login: string; externalId: number };
};

export type TaskClosedEvent = {
	type: "task_closed";
	source: EventSource;
	repository: { owner: string; name: string };
	issue: { number: number };
};

export type CommentPostedEvent = {
	type: "comment_posted";
	source: EventSource;
	repository: { owner: string; name: string };
	target: {
		kind: "issue" | "pull_request";
		number: number;
		authorLogin: string;
	};
	comment: {
		id: number;
		body: string;
		url: string;
		createdAt: string;
		authorLogin: string;
		isReviewComment: boolean;
		isReviewSubmission: boolean;
	};
};

export type CheckFailedEvent = {
	type: "check_failed";
	source: EventSource;
	repository: { owner: string; name: string };
	run: {
		id: number;
		url: string;
		headSha: string;
		workflowName: string;
		workflowFile: string;
	};
	pullRequestNumbers: number[];
};

export type Event =
	| TaskRequestedEvent
	| TaskClosedEvent
	| CommentPostedEvent
	| CheckFailedEvent;
