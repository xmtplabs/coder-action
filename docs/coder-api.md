# Coder API Reference

Tasks were promoted from `/api/experimental/tasks` to `/api/v2/tasks`; the experimental paths remain as a transitional alias through ~Coder v2.30.0.

## Tasks endpoints

| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/v2/tasks?q=owner:{username}` | List tasks. Supported `q` keys: `owner:`, `organization:`, `status:`. `name:` is NOT supported — filter by name client-side. Response: `{ tasks: Task[], count: number }`. |
| `POST` | `/api/v2/tasks/{owner}` | Create task. Body: `{ template_version_id, template_version_preset_id?, input, name?, display_name? }`. Returns `201 Created` with full `Task`. |
| `GET` | `/api/v2/tasks/{owner}/{task}` | Get task by UUID or name. |
| `POST` | `/api/v2/tasks/{owner}/{task}/send` | Send input to task. Body: `{ input }`. Returns `204 No Content`. Returns `409` if the task app isn't `Stable`. |
| `DELETE` | `/api/v2/tasks/{owner}/{task}` | Delete task. Returns `202 Accepted` — triggers a workspace delete build. |

## Other endpoints

| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/v2/users?q=github_com_user_id:{id}` | User search. Supported `q` keys include `github_com_user_id`, `username`, `email`, `status`, `login_type`, and date filters. |
| `GET` | `/api/v2/users/{id}` | Accepts UUID, username, or the literal `me`. |
| `GET` | `/api/v2/organizations/{org}/templates/{name}` | `{org}` accepts UUID or org name. |
| `GET` | `/api/v2/templateversions/{id}/presets` | Wire format is **PascalCase** (`ID`, `Name`, `Default`) — the swagger docs incorrectly show lowercase. Trust the SDK struct, not the HTML docs. |
| `POST` | `/api/v2/workspaces/{id}/builds` | Body: `{ transition: "start" \| "stop" \| "delete" }`. `template_version_id` is optional — omit to reuse the workspace's current version. |

## GitHub GraphQL — linked issues

`GitHubClient.findLinkedIssues()` uses:
```graphql
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      closingIssuesReferences(first: 10) {
        nodes { number title state url }
      }
    }
  }
}
```
