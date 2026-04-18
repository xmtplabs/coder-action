# GitHub App Registration and Setup Guide

This guide walks through registering the XMTP Coder App as a GitHub App, installing it on your organization, and configuring the server.

---

## Identity Model

The system uses **two distinct GitHub identities**:

| Identity | Type | Purpose |
|----------|------|---------|
| `@xmtp-coder-agent` (or your chosen username) | GitHub User with PAT | Used by Coder workspaces to fork repos, push code, and open PRs |
| `@your-app-name[bot]` | GitHub App bot | Receives webhooks and posts status comments (e.g. "Task created") |

Both identities' comments are suppressed during webhook processing to prevent infinite feedback loops. The app's bot login is discovered automatically at startup via `GET /app`; the agent's user login is set via `AGENT_GITHUB_USERNAME`.

---

## Step 1: Register the GitHub App

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
   (or navigate directly to `https://github.com/organizations/<your-org>/settings/apps/new` to create it under your organization)

2. Fill in the registration form:

   | Field | Value |
   |-------|-------|
   | **GitHub App name** | `xmtp-coder-app` (or your preferred name) |
   | **Homepage URL** | `https://github.com/your-org/coder-action` |
   | **Webhook URL** | `https://your-server/api/webhooks` |
   | **Webhook secret** | A strong random string (save this — you will need it for `WEBHOOK_SECRET`) |

3. Leave **"Expire user authorization tokens"** checked (default).

4. Leave **"Request user authorization (OAuth) during installation"** unchecked unless you need OAuth flows.

5. Under **"Where can this GitHub App be installed?"**, select **"Only on this account"** for a private organizational deployment.

---

## Step 2: Set Repository Permissions

Under **Permissions → Repository permissions**, configure:

| Permission | Access level |
|------------|-------------|
| Actions | Read |
| Contents | Read |
| Issues | Read and write |
| Metadata | Read (required, cannot be removed) |
| Pull requests | Read and write |

---

## Step 3: Set Organization Permissions

Under **Permissions → Organization permissions**, configure:

| Permission | Access level |
|------------|-------------|
| Members | Read |

---

## Step 4: Subscribe to Events

Under **Subscribe to events**, check all of the following:

- Issues
- Issue comment
- Pull request review
- Pull request review comment
- Workflow run

---

## Step 5: Save the App

Click **Create GitHub App**. You will be taken to the app's settings page.

---

## Step 6: Note the App ID

On the app settings page, copy the **App ID** shown near the top. You will set this as `APP_ID` in your environment.

---

## Step 7: Generate a Private Key

1. Scroll to the bottom of the app settings page.
2. Click **Generate a private key**.
3. A `.pem` file will be downloaded automatically. Store it securely — it cannot be retrieved again.
4. **Convert the key from PKCS#1 to PKCS#8.** GitHub issues keys in PKCS#1 format (`-----BEGIN RSA PRIVATE KEY-----`), but `universal-github-app-jwt` only accepts PKCS#8 (`-----BEGIN PRIVATE KEY-----`):

   ```bash
   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
     -in your-app.private-key.pem \
     -out your-app.private-key-pkcs8.pem
   ```

5. The contents of the **PKCS#8** file become the `PRIVATE_KEY` environment variable. When setting it as a single-line environment variable, replace literal newlines with `\n`.

---

## Step 8: Install the App on Your Organization

1. In the app settings, click **Install App** in the left sidebar.
2. Click **Install** next to your organization.
3. Choose either:
   - **All repositories** — the app receives events from every repo in the org (recommended for org-wide coverage)
   - **Only select repositories** — restrict to specific repos
4. Click **Install**.

---

## Step 9: Configure Environment Variables

Create a `.env` file (or configure your deployment environment) with the following variables:

```
# GitHub App credentials
APP_ID=123456
PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
WEBHOOK_SECRET=your-webhook-secret

# GitHub User identity used by Coder workspaces
AGENT_GITHUB_USERNAME=xmtp-coder-agent

# Coder configuration
CODER_URL=https://coder.example.com
CODER_TOKEN=your-coder-api-token
CODER_TASK_NAME_PREFIX=gh
CODER_TEMPLATE_NAME=task-template
CODER_ORGANIZATION=default

# Server
PORT=3000
```

**Notes:**
- `APP_ID` — the numeric App ID from Step 6.
- `PRIVATE_KEY` — the full contents of the `.pem` file from Step 7, with literal newlines replaced by `\n`.
- `WEBHOOK_SECRET` — the secret you set in the webhook URL form during registration (Step 1).
- `AGENT_GITHUB_USERNAME` — the GitHub username of the user account whose PAT is injected into Coder workspaces. Comments from this user are suppressed to prevent feedback loops.
- `CODER_TASK_NAME_PREFIX` — prefix for generated Coder task names (e.g. `gh` produces names like `gh-myrepo-42`).

---

## Step 10: Start the Server

```bash
bun install
bun run start
```

The server listens on `http://0.0.0.0:${PORT}` (default: `3000`).

---

## Step 11: Verify the Setup

### Health check

```bash
curl http://localhost:3000/health
```

Expected response: `{"status":"ok"}`

### Webhook deliveries

1. Go to your GitHub App settings → **Advanced** → **Recent Deliveries**.
2. Confirm that deliveries are arriving with **200** responses after you trigger an event (e.g. assign an issue to `@xmtp-coder-agent`).

### Test assignment

1. Open an issue in any repository where the app is installed.
2. Assign the issue to the `@xmtp-coder-agent` GitHub user.
3. Within a few seconds, the app bot (`@your-app-name[bot]`) should post a comment confirming the Coder task was created.
4. Verify the task appears in your Coder dashboard.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Webhook deliveries show `401 Unauthorized` | `WEBHOOK_SECRET` does not match what was set during registration | Copy the exact secret from your app registration and set it in `WEBHOOK_SECRET` |
| Webhook deliveries show `500` and logs say "invalid signature" | Same as above, or the secret contains extra whitespace | Trim the secret value; ensure no trailing newline |
| App posts no comment after issue assignment | `APP_ID` or `PRIVATE_KEY` is wrong | Verify `APP_ID` matches the numeric ID on the app settings page; re-paste the private key ensuring `\n` line endings |
| `PRIVATE_KEY` parse error on startup | PEM is malformed or newlines were not escaped | Use `awk '{printf "%s\\n", $0}' your-key.pem` to produce a single-line escaped value |
| `Private Key is in PKCS#1 format, but only PKCS#8 is supported` | Key was used as downloaded from GitHub | Convert to PKCS#8 (see Step 7): `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in your-app.private-key.pem -out your-app.private-key-pkcs8.pem` |
| "Resource not accessible by integration" error from GitHub API | Missing permission | Review Step 2 and Step 3; re-install the app after saving permission changes |
| Comments from agent trigger new tasks (feedback loop) | `AGENT_GITHUB_USERNAME` is missing or misspelled | Set `AGENT_GITHUB_USERNAME` to the exact GitHub username of the user account (no `@` prefix) |
| Workflow run events not received | `workflow_run` event not subscribed | Go to app settings → Edit → subscribe to **Workflow run** and save |
| App installed but events only arrive for some repos | App installed on select repos only | Re-install and choose **All repositories**, or add the missing repo under the installation settings |
