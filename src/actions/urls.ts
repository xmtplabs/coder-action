export function parseIssueURL(url: string): {
	owner: string;
	repo: string;
	issueNumber: number;
} {
	const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
	if (!match) {
		throw new Error(`Invalid GitHub issue URL: ${url}`);
	}
	return {
		owner: match[1],
		repo: match[2],
		issueNumber: Number.parseInt(match[3], 10),
	};
}
