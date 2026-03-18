# Coder API Reference

## Experimental tasks endpoints

| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/experimental/tasks?q=owner:{username}` | List tasks; no dedicated single-lookup endpoint |
| `POST` | `/api/experimental/tasks/{owner}` | Create task |
| `GET` | `/api/experimental/tasks/{owner}/{taskId}` | Get task by ID |
| `POST` | `/api/experimental/tasks/{owner}/{taskId}/send` | Send input to task |

## Stable endpoints

| Method | Endpoint |
|---|---|
| `GET` | `/api/v2/users?q=github_com_user_id:{id}` |
| `GET` | `/api/v2/organizations/{org}/templates/{name}` |
| `GET` | `/api/v2/templateversions/{id}/presets` |
| `POST` | `/api/v2/workspaces/{id}/builds` (stop/delete via `transition`) |

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
