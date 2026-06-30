# Alfred Memory Console v0.3.0

Two ways to manage your Alfred Memory install:

1. **Web Console** (recommended for non-technical users) — a small static page
   served at `http://localhost:3000/console` by the Alfred Memory Server.
2. **TUI Dashboard** (for terminal power users) — `alfred dashboard` from a TTY.

Both show the same information: tenants, API keys, connected services. The
web console is the right entry point for lawyers, consultants, and anyone
who doesn't want to remember CLI flags.

## Web Console

The console is a single static HTML file (no build step) plus a small JSON
API under `/console/api/`. To use it:

1. Start the Alfred Memory Server (`alfred serve`).
2. Open `http://<server-host>:3000/console` in a browser.
3. Paste any tenant API key (one starts with `alk_`) and click **Unlock**.
4. Issue new keys, revoke old ones, see which agents are configured.

The page is small (~12 KB of HTML+JS, no framework) and self-contained.
Run the server over HTTPS in production (self-hosted mode).

## What the page shows

- **Tenants**: every universe of memory Alfred knows about.
- **API keys**: active and revoked, with their prefix and last-used time.
  New keys are shown ONCE when issued.
- **Connected services**: copy-paste instructions for ChatGPT, Claude Desktop,
  Google AI Studio, and coding agents. The console does not store any memory
  data — it only manages the keys and connections.

## TUI Dashboard

`alfred dashboard` opens a terminal dashboard (in your TTY). Keybindings:

- `q` / `Ctrl+C` quit
- `r` refresh
- `Tab` / `Shift+Tab` next/previous tenant
- `n` issue a new key for the selected tenant
- `d` show memory count for the selected tenant

The TUI is a read/write shell around the same JSON API.

## Architecture

```
GET  /console                         → static index.html
GET  /console/api/tenants             → list of tenants (registry)
GET  /console/api/tenants/<id>/keys   → API keys for a tenant
POST /console/api/tenants/<id>/keys   → issue a new key
DELETE /console/api/keys/<id>         → revoke a key
```

Auth: every API endpoint requires `Authorization: Bearer alk_...`. The
console UI itself has no auth — the operator chooses what to expose.

## Non-technical copy

The console copy is deliberately written for someone who has never used a
terminal. The opening panel says:

> *Welcome. This console manages API keys and connected services for your
> Alfred Memory install. Paste an API key from `alfred init` or `alfred
> keys issue` above and click Unlock. Don't have one yet? On a fresh
> install, run `alfred init --profile=web --name my-mem` in a terminal.*

And at the bottom:

> *What is this? Alfred Memory is a multi-tenant memory store. The console
> manages which agents can talk to it and with which credentials. Memory
> is never written here — it lives in each tenant's database (Postgres or
> SQLite). This page only shows the keys and connections.*

## Tests

```bash
npm run check
npm test
```

3 tests in `test/dashboard.test.mjs` covering the TUI --json path, and
9 tests in `packages/memory-server/test/console.test.mjs` covering the
JSON API.
