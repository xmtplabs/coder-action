export interface LinkedIssue {
	number: number;
	title: string;
	state: string;
	url: string;
}

export interface FailedJob {
	id: number;
	name: string;
	conclusion: string;
}

export interface PRInfo {
	number: number;
	user: { login: string };
	head: { sha: string };
}
