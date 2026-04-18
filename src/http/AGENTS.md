# src/http — agent rules

HTTP-layer primitives for the Worker fetch handler. Kept separate from `src/main.ts` so parsing + identity resolution are independently testable.

## Signature verification runs before any header parsing or JSON decode

`parseWebhookRequest` stages are ordered deliberately:

1. Read raw body text
2. **Verify HMAC-SHA256 signature** via `@octokit/webhooks-methods#verify` (timing-safe)
3. Check `X-GitHub-Event` header
4. Parse JSON body

An unsigned request with malformed JSON returns **401, not 400** — unauthenticated callers never learn anything about the body shape. Don't reorder the stages to short-circuit on cheap checks first.

## Typed error classes drive the response

`parseWebhookRequest` throws one of four error classes on failure, each carrying its HTTP `status` + response `body`:

| Class | Status | Body |
|---|---|---|
| `MissingSignatureError` | 401 | "Unauthorized: missing signature" |
| `InvalidSignatureError` | 401 | "Unauthorized: invalid signature" |
| `MissingEventHeaderError` | 400 | "Bad Request: missing X-GitHub-Event" |
| `InvalidJsonError` | 400 | "Bad Request: invalid JSON body" |

The handler (`src/main.ts`) catches via `instanceof WebhookRequestError` and uses `err.status` / `err.body`. If you add a new error shape, extend `WebhookRequestError` and populate both fields.

## App-bot login cache is per-isolate

`resolveAppBotLogin` caches the result of `GET /app` at module scope. Safe because:
- Workers isolate reuse is architecturally fine here: the bot login is account-wide, not request-scoped.
- `@octokit/auth-app` defers the installation-token exchange until the first API call, so construction is pure.
- Isolate eviction re-fetches on the next first request.

Don't add stronger caching (e.g. KV persistence). If the GitHub App is re-registered with a new slug, an isolate eviction naturally picks up the change within minutes.

## Test-only export: `__setAppBotLoginForTests`

The `__`-prefix flags it as test-only. It's technically reachable at runtime (Worker named exports are immutable after deploy), but only via a code path no caller uses. Don't put security-sensitive logic behind an underscore name; this one is acceptable because worst-case misuse is a cached bot login string.
