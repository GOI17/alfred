# Release 0.3.0: Alfred Memory Multi-Tenant, Self-Hosted

Production-ready v0.3.0. **210 tests passing across 16 release gates.**

## What's new in v0.3.0

### Multi-tenant self-hosted memory

- **Registry** (`~/.alfred/registry.sqlite`) maps API keys to tenants.
- **Tenants** are isolated universes of memory, each with its own storage
  backend (SQLite for coding agents, Postgres for human agents).
- **API keys** are scrypt-hashed (`N=2^14, r=8, p=1`), rotatable, revokable.

### Three init profiles

- `coding` (default) — `coding_agent_only` + SQLite, writes
  `.alfred/config.json` in cwd for the agent.
- `web` — `human_agent` + Postgres, **no workspace binding**, prints
  step-by-step setup for ChatGPT/Claude/Gemini.
- `both` — `hybrid_with_human` + Postgres, workspace + web setup.

```
$ alfred init --profile=web --name=my-mem
$ alfred init --profile=coding --name=acme
$ alfred init --profile=both --name=shared
```

### Web console

`http://localhost:3000/console` after `alfred serve`. A single static HTML
page (~12 KB) that shows tenants, API keys, and copy-paste instructions
for every supported agent. No build step on the server. **Standalone
deployable to GitHub Pages, Vercel, or Netlify** from
`packages/console-web/`:

```bash
cd packages/console-web
ALFRED_API_BASE=https://alfred.example.com npm run build
# upload dist/ to your host
```

### TUI dashboard

```bash
$ alfred dashboard
```

`q` quit, `r` refresh, `Tab`/`Shift+Tab` next/prev, `n` issue new key, `d`
detail. Zero deps. Or `--json` for a snapshot dump.

### Adapters

- **ChatGPT** (Custom GPT Actions) — `packages/chatgpt-adapter/`
- **Anthropic Claude Desktop** (MCP) — `packages/anthropic-adapter/`
- **Google Gemini / AI Studio** (Extension) — `packages/gemini-adapter/`

### Migration tooling

- `alfred migrate --from sqlite --to sqlite --src=... --dst=...` for
  workspace moves.
- `alfred migrate --from sqlite --to postgres --src=... --out=...` for
  Postgres upgrades (emits a SQL dump applied via `psql`).

## Test summary

| Suite | Tests |
|---|---|
| `memory/policy.test.js` | 9 |
| `memory/tenants.test.js` | 28 |
| `memory/users.test.js` | 17 |
| `memory/sqlite-memory-store.test.js` | 9 |
| `memory/sessions.test.js` | 9 |
| `memory-server/registry-schema.test.mjs` | 13 |
| `memory-server/server.test.mjs` | 11 |
| `memory-server/init.test.mjs` | 11 |
| `memory-server/cli.test.mjs` | 8 |
| `memory-server/cross-tenant-isolation.test.mjs` | 15 |
| `memory-server/registry-sqlite-store.test.mjs` | 14 |
| `memory-server/migrate-sqlite.test.mjs` | 3 |
| `memory-server/console.test.mjs` | 9 |
| `chatgpt-adapter/contract.test.mjs` | 11 |
| `anthropic-adapter/contract.test.mjs` | 8 |
| `gemini-adapter/contract.test.mjs` | 10 |
| `console/dashboard.test.mjs` | 3 |
| `console-web/build.test.mjs` | 10 |
| `core/kernel.test.mjs` | 2 |
| `opencode-adapter/runtime.test.mjs` | 4 |
| `codex-adapter/runtime.test.mjs` | 6 |
| **Total** | **210** |

## Install

```bash
# 1-command install for web (most common):
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh \
  | sh -s -- --profile=web --name=my-mem

# 1-command install for coding agents:
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh \
  | sh -s -- --profile=coding --name=acme
```

## 5-minute quick start for non-technical users

See `docs/QUICKSTART.md`. The web console at `http://localhost:3000/console`
shows the same info via a browser, with copy-paste instructions for
ChatGPT/Claude/Gemini.

## Limitations

- **Postgres memory store**: bundled server opens SQLite per-tenant. For
  Postgres, use `alfred migrate --from sqlite --to postgres` to generate
  a SQL dump, apply it with `psql`. (Direct pg-backed memory comes in v0.4.)
- **Federated sync** between machines: deferred to v0.4.
- **Single-process listen**: bundled server is single-process. Use nginx or
  Caddy in front for high availability.
