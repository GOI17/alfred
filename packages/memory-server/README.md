# Alfred Memory Server v0.3.0

The Alfred Memory Server is the **self-hosted** deployment shape of Alfred Memory. It exposes:

- `/memories` — CRUD for the durable memory store.
- `/memories/search` — text search.
- `/policy` — run hosting-policy validation against the registry.
- `/health` — liveness probe.
- `/tenants` — list tenants registered to this installation.

## Quick start (local-only)

```bash
ALFRED_MEMORY_HOSTING=local \
ALFRED_MEMORY_PORT=3000 \
  node packages/memory-server/bin/alfred-memory-server.mjs
```

The server binds to `127.0.0.1:3000`. No auth — relies on loopback trust.

## Quick start (self-hosted)

```bash
ALFRED_MEMORY_HOSTING=self-hosted \
ALFRED_MEMORY_PORT=443 \
ALFRED_MEMORY_BIND=0.0.0.0 \
ALFRED_MEMORY_TLS_CERT=/etc/letsencrypt/live/alfred.example.com/fullchain.pem \
ALFRED_MEMORY_TLS_KEY=/etc/letsencrypt/live/alfred.example.com/privkey.pem \
ALFRED_MEMORY_ALLOWED_ORIGINS=https://chat.openai.com,https://claude.ai \
  node packages/memory-server/bin/alfred-memory-server.mjs
```

Required:

- `ALFRED_MEMORY_TLS_CERT` and `ALFRED_MEMORY_TLS_KEY` pointing to valid files.
- API key in `Authorization: Bearer alk_...` header for every non-public route.
- At least one origin in `ALFRED_MEMORY_ALLOWED_ORIGINS` for browser clients (Custom GPT, Claude web).

## CLI

```bash
node packages/memory-server/scripts/alfred.mjs init --cwd ~/clients/acme --kind coding_agent_only --storage-backend sqlite
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
- Self-hosted server: Postgres only for the registry.

The check constraints, the application validation, and the CLI prompts all enforce this independently. The cross-tenant isolation tests verify the in-memory implementation; the same suite runs against the SQL migration via `node:test` when a Postgres instance is available.

## Workspace policy

The (a)/(b)/(c) safety guard fires when `alfred init` detects existing workspaces in the directory tree. See `.ai/policies/memory-workspace-policy.md`.

## Tests

```bash
npm run check
npm test
```

Test counts:

- `init.test.mjs` — 11 tests.
- `server.test.mjs` — 11 tests.
- `cli.test.mjs` — 8 tests.
- `cross-tenant-isolation.test.mjs` — 15 vectors, all green.

## Configuration

| Env var | Default | Required in self-hosted |
|---|---|---|
| `ALFRED_MEMORY_HOSTING` | `local` | yes (set to `self-hosted`) |
| `ALFRED_MEMORY_PORT` | `3000` (local) / `443` (self-hosted) | optional |
| `ALFRED_MEMORY_BIND` | `127.0.0.1` (local) / `0.0.0.0` (self-hosted) | optional |
| `ALFRED_MEMORY_TLS_CERT` | none | **yes** |
| `ALFRED_MEMORY_TLS_KEY` | none | **yes** |
| `ALFRED_MEMORY_ALLOWED_ORIGINS` | none | optional (comma-separated) |
| `ALFRED_MEMORY_REGISTRY` | `~/.alfred/registry.sqlite` | optional |

## Web console

The `/console` route serves the optional web console. The server does not
depend on `@alfred-labs/console-web` at the package level — the operator
wires them together at runtime using one of three modes:

### Mode 1 — Cross-origin deploy (recommended)

Deploy the console to Vercel, Netlify, GitHub Pages, or any static host.
The server only serves the JSON API under `/console/api/*` and redirects
`/console` to the upstream URL.

```bash
# On the server
export ALFRED_CONSOLE_URL=https://alfred-console.vercel.app
alfred serve
```

The console build points at your server via `ALFRED_API_BASE`:

```bash
cd packages/console-web
ALFRED_API_BASE=https://alfred.example.com npm run build
# upload dist/ to your static host
```

Remember to add your console's origin to `ALFRED_MEMORY_ALLOWED_ORIGINS`
on the server so the browser allows API calls.

### Mode 2 — Bundled inline

Build the console and point the server at the `dist/` directory.

```bash
cd packages/console-web
ALFRED_API_BASE=https://alfred.example.com npm run build
# Result: packages/console-web/dist/index.html

# On the server
export ALFRED_CONSOLE_DIR=/opt/alfred/console-web/dist
alfred serve
```

The server serves `index.html` for any `/console/...` path (SPA fallback).
The console and the API are same-origin, so CORS is a non-issue.

### Mode 3 — Auto-discovery (dev only)

If neither env var is set and the server is launched from a workspace
that contains `packages/console-web/dist/index.html`, the server picks it
up automatically. Useful during development. **Do not rely on this in
production** — set `ALFRED_CONSOLE_URL` or `ALFRED_CONSOLE_DIR` explicitly.

### 503 fallback

If none of the above resolves, `/console` returns 503 with an error body
that includes the searched paths and instructions for fixing the
deployment. The `/console/api/*` endpoints continue to work in all
modes (the API is decoupled from the static SPA).

### Env vars

| Env var | Default | Purpose |
|---|---|---|
| `ALFRED_CONSOLE_URL` | none | Cross-origin deploy URL (Mode 1) |
| `ALFRED_CONSOLE_DIR` | none | Path to built `dist/` (Mode 2) |

## Future work (v0.3.1+)

- Real `alfred migrate` SQLite ↔ Postgres data migration.
- Postgres-backed `createPostgresTenantStore` (currently a stub).
- WSGI-style multi-process listen via `cluster` module.
