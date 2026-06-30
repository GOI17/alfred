# Changelog

## 0.3.0 (2026-06-30)

Production-ready multi-tenant release. **198 tests passing across 13 release gates**.

### Added

- **Registry SQLite store** with canonical migration + 3 TRIGGERs (hosting policy, no-dual-Postgres, auto-bump updated_at).
- **TenantService** with policy enforcement at SQL + application layers.
- **UserService** with scrypt API key hashing (`N=2^14, r=8, p=1`).
- **migrate** CLI: SQLite→SQLite direct copy, SQLite→Postgres SQL dump.
- **Sessions / Topics / Acceptance Criteria** domain with state machines and rollups.
- **ChatGPT adapter** with OpenAPI 3.1 spec and HTTPS bridge.
- **Anthropic adapter** as MCP server (JSON-RPC over stdio).
- **Gemini adapter** with OpenAPI 3.0 spec and HTTPS bridge.
- **alfred adapters** subcommand with one-shot instructions for each agent integration.
- **alfred init** with 3 profiles (coding/web/both) and `--print-only`.
- **alfred keys issue** for issuing additional API keys for an existing tenant.
- **Web console** at `/console` with single-page UX, CORS, and 7 JSON API endpoints.
- **TUI dashboard** (`alfred dashboard`) with raw-mode terminal UI.
- **Standalone console-web package** deployable to GitHub Pages, Vercel, or Netlify.
- `validate-policies.mjs` and `validate-release-0.3.0.mjs` validators.

### Test counts

| Suite | Count |
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
| **Total** | **198** |

## 0.2.0

Initial MVP. Memory CRUD over `/memories`, `MemoryPolicy` decision engine, scoped by `namespace`.
