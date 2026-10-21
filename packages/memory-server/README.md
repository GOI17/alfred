# Alfred Memory Server

Alfred Memory is a local HTTP service. The managed hosted service is retired.
It preserves tenant isolation, API keys, optional OAuth, HTTP MCP, memory CRUD,
search, and policy-governed capture. SQLite and user-chosen Postgres storage are
supported; storage location does not enable remote HTTP access.

## Quick start

```bash
alfred init --profile=coding --backend=sqlite --name my-memory
ALFRED_MEMORY_REQUIRE_AUTH=true alfred serve
```

Save the key printed by `init`, open <http://127.0.0.1:3000/console/>, and unlock
the console with that key. Keep the process running. The console calls the API
on the same origin, including when you select another loopback address or port.
Cloud ChatGPT Actions and Google AI Studio cannot reach the local service.

From this repository use `node packages/memory-server/scripts/alfred.mjs` in
place of `alfred`.

## CLI

```bash
node packages/memory-server/scripts/alfred.mjs init --cwd ~/clients/acme --profile=coding --backend=sqlite
node packages/memory-server/scripts/alfred.mjs list
node packages/memory-server/scripts/alfred.mjs validate-policy
node packages/memory-server/scripts/alfred.mjs key rotate --tenant usr_xxx
node packages/memory-server/scripts/alfred.mjs key list --tenant usr_xxx
```

The CLI is published as `alfred` bin (see `package.json` → `bin`).

## Architecture

| File | Purpose |
|---|---|
| `src/server.js` | HTTP server factory: loadServerConfig, createApp, createServer, startServer |
| `src/init.js` | Init flow: scan conflicts, prompt (a)/(b)/(c), provision |
| `migrations/000_alfred_registry.sql` | Postgres registry schema with TRIGGERs (W5 readers block delete, W6 no dual Postgres) |
| `migrations/sqlite/000_alfred_registry.sqlite.sql` | SQLite twin |
| `test/init.test.mjs` | Init flow tests |
| `test/server.test.mjs` | Server handler tests (via fake req/res) |
| `test/cli.test.mjs` | CLI subprocess tests |
| `test/cross-tenant-isolation.test.mjs` | 15 vectors of intentional leak attempts |

## Storage policy

Storage backend selection follows `.ai/policies/memory-hosting-policy.md`:

- Human agents: Postgres only.
- Coding agents: ask at init time.
- The local registry uses SQLite; tenant Postgres connections may point to a user-chosen database.
- `web` and `both` are compatibility profile names, not hosted-service options.

The check constraints, the application validation, and the CLI prompts all enforce this independently. The cross-tenant isolation tests verify the in-memory implementation; the same suite runs against the SQL migration via `node:test` when a Postgres instance is available.

## Workspace policy

The (a)/(b)/(c) safety guard fires when `alfred init` detects existing workspaces in the directory tree. See `.ai/policies/memory-workspace-policy.md`.

## Tests

```bash
npm run check
npm test
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ALFRED_MEMORY_HOSTING` | `local` | Only supported mode; other values fail startup |
| `ALFRED_MEMORY_PORT` | `3000` | Integer 0–65535; 0 assigns an available local port |
| `ALFRED_MEMORY_BIND` | `127.0.0.1` | `localhost`, IPv4 loopback, or `::1` only |
| `ALFRED_MEMORY_REQUIRE_AUTH` | `false` | Set `true` as in the quickstart to require API keys |
| `ALFRED_MEMORY_ALLOWED_ORIGINS` | none | Optional explicit browser origins; no wildcard default |
| `ALFRED_MEMORY_REGISTRY` | `~/.alfred/registry.sqlite` | Local registry path |
| `ALFRED_PUBLIC_URL` | none | Canonical URL for optional OAuth configuration |
| `ALFRED_OAUTH_CLIENT_ID` | none | Optional OAuth client ID |
| `ALFRED_OAUTH_CLIENT_SECRET` | none | Optional OAuth secret; 32+ characters |
| `ALFRED_OAUTH_REDIRECT_URIS` | none | Optional exact redirect allowlist |
| `ALFRED_SMTP_HOST` | none | Email verification and key recovery transport |
| `ALFRED_SMTP_PORT` | `587` | SMTP port |
| `ALFRED_SMTP_USER` | none | Authenticated SMTP username |
| `ALFRED_SMTP_PASSWORD` | none | Authenticated SMTP password |
| `ALFRED_SMTP_FROM` | `noreply@alfred.local` | Sender address |

`alfred serve --port=4321 --bind=localhost` overrides the corresponding env vars.
Invalid values fail before opening the registry. `createServer` and `startServer`
enforce the same local contract, including direct `server.listen(...)` calls.
`ALFRED_CONSOLE_URL` and nonlocal hosting modes are unsupported.

OAuth remains disabled when all three `ALFRED_OAUTH_*` settings are absent.
Supplying only part of the OAuth configuration fails startup rather than
falling back to an insecure mode.

Key recovery checks the SMTP transport before looking up an address. If the
transport is not configured or cannot authenticate, the endpoint returns
`503 recovery_unavailable` for every address. Once SMTP is ready, registered
and unregistered addresses share the same generic response to prevent account
enumeration.

### Recovery result negotiation

Opening `GET /console/api/recover?token=...` in a browser returns an accessible
HTML result page by default. The page sends `Cache-Control: no-store`, does not
load external assets, and shows a newly issued key only on the first successful
use of the link. Direct recovery uses the same-origin `/console/` fallback.
Recovery started from OAuth uses only a canonical internal `/oauth/authorize`
continuation after Alfred revalidates the OAuth client, exact callback
allowlist, state, and scopes. External continuation targets are rejected.

Machine clients must explicitly send `Accept: application/json`. A successful
JSON response retains the existing fields:

```json
{
  "ok": true,
  "tenant_id": "usr_...",
  "email": "user@example.com",
  "api_key": "alk_...",
  "key_prefix": "alk_...",
  "key_id": "key_...",
  "old_key_id": "key_...",
  "consumed_at": "2026-09-03T00:00:00.000Z",
  "continue_url": "/console/",
  "continue_label": "Continue with Alfred"
}
```

Invalid tokens return `400 invalid_token`; expired and already-used tokens
return `410 token_expired` and `410 token_used`, respectively. Missing,
wildcard, browser-style, and `application/json;q=0` Accept headers select HTML,
not JSON. Recovery GET responses carry the same no-store and restrictive
security headers in both representations. The secret-bearing recovery GET is
not exposed through browser CORS; machine clients should call it directly.
Clients must never persist or log the returned `api_key`.

The emailed recovery link remains unchanged: continuation context is stored
server-side with the recovery record and is revalidated when consumed. The
browser page attempts the OAuth return only after giving the user time to copy
the new key, and always provides an explicit **Continue with Alfred** action.

## Web console

The local server serves the packaged console at `/console/`. In a repository
checkout it discovers `packages/console-web/dist/index.html` automatically.
To rebuild it with existing dependencies:

```bash
node packages/console-web/scripts/build.mjs
```

For another package layout, set `ALFRED_CONSOLE_DIR` to the absolute path of that
built `dist/` directory before starting `alfred serve`. The console and API must
share an origin; `ALFRED_API_BASE` overrides and remote console redirects are not
supported. The public website serves local-start instructions only.

If the build cannot be found, `/console/` returns `503 console_not_installed`
with local build/path instructions. JSON endpoints remain available.

## Memory history and observed agent activity

The authenticated console exposes read-only tenant views:

- `GET /console/api/tenants/:tenantId/memories`: existing `listMemories` results,
  newest `createdAt` first and descending ID for ties. Default 25 records;
  `limit` (1–100), `offset` (0–100000), `namespace`, `projectId`, `type` and `tag`
  preserve the existing Memory service filters. History shows current saved
  records, not revisions or deleted memories. Pages can change during concurrent
  writes; they are not a snapshot.
- `GET /console/api/tenants/:tenantId/agents`: observed clients grouped by verified
  credential and transport, with last observed timestamp and status. Tenant path
  must equal the authenticated API key's tenant; a mismatch returns 404. Both
  views use `Cache-Control: no-store`, and failures return generic errors.

`alfred serve` shares one bounded `createAgentActivity` observer between the
console, authenticated OpenAPI memory/search routes and remote HTTP MCP. The
fallback `createApp` Memory route also accepts the same observer. Console reads,
registration, manifests, health checks and API key `last_used_at` do not count
as agent activity. Standalone routers must receive the shared observer explicitly;
an unwired activity view returns 503 rather than an invented empty success.

| Status | Evidence |
| --- | --- |
| `connected` | At least one authenticated request is still open within its 5-minute observation lease. |
| `recently_active` | An observed request completed within the previous 60 seconds (including failed requests). |
| `inactive` | No recent activity, or the maximum request lease expired. |
| `disconnected` | The latest tracked request aborted or its transport closed before completion; other concurrent open requests still take precedence. |
| `revoked` | The observed API key is revoked or no longer available in this tenant. |

Activity is server-process-local: restart clears it, replicas are not aggregated,
old records expire after 24 hours, and no persistent client connection or
background heartbeat is inferred. At most 1000 credential/transport entries and
100 concurrent requests per entry are tracked. Old inactive entries are evicted
first; additional observations are ignored when all capacity is active. An absent
row is not proof that an agent is offline everywhere. Shared credentials may
represent multiple runtimes; OAuth clients group by the verified client ID across
token refreshes. Tokens, key secrets and hashes are never exposed by this view.
Filesystem workspace membership is unknown; namespace/project filters narrow
history inside the authenticated tenant but do not create workspace authorization.
