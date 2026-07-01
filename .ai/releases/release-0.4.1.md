# Release 0.4.1: Custom GPT Surface

Lets a Custom GPT (in ChatGPT) read, search, write, update, and delete
memories in a user's self-hosted Alfred Memory instance. **244 tests /
17 release gates / 12 policy checks** passing. **Zero provider calls.**

## What's new in v0.4.1

### 1. OpenAPI surface (Custom GPT actions)

A new router (`createOpenapiRouter`) exposes the Alfred Memory HTTP API
that a Custom GPT can call as an "Action". Auth is a Bearer API key. The
router is the same one shipped in `packages/memory-server/src/server.js` —
it is the surface a ChatGPT Actions schema can point at.

**Public endpoints (no auth):**
- `GET /health` — liveness + version
- `GET /agents/manifest` — the 6 active agents (orchestrator, developer, qa,
  librarian, architect, reviewer)
- `GET /skills/manifest` — the skill catalog
- `POST /policies/check` — is a proposed action allowed?

**Auth endpoints (Bearer / X-API-Key):**
- `GET /memories` (list with filters)
- `POST /memories` (create)
- `GET /memories/{id}` (read one)
- `PATCH /memories/{id}` (update — `namespace` is immutable)
- `DELETE /memories/{id}` (delete)
- `POST /search` (semantic / keyword / hybrid search)

### 2. Action rate limit (100/min per API key)

The Custom GPT can run loops. To protect the backend, every request through
the OpenAPI surface counts against a 100-req/min budget keyed by the
caller's API key. Exceeding the budget returns 429 with a `Retry-After`
header. State is stored in the new `action_attempts` table
(`009_action_attempts.sql`, with a SQLite twin).

The limit is **per API key**, not per IP — the GPT runs server-side at
OpenAI and many users share one egress IP.

### 3. Custom GPT builder config (versioned)

`.ai/gpt/alfred-memory-gpt.json` is the canonical GPT configuration:
name, description, system prompt (10 explicit rules + discovery +
output style), 4 conversation starters, capabilities (web/dall-e/code-
interpreter all disabled), action metadata. Anyone creating the GPT
imports this file.

### 4. Deploy guide

`.ai/docs/custom-gpt-deploy.md` walks an operator from "fresh Alfred
Memory instance" to "GPT in the Store" in 7 steps, including
self-hosting, TLS, OpenAPI hosting, GPT creation, Store review, and key
rotation.

## Files added / changed

| File | Change |
|---|---|
| `packages/memory-server/src/openapi-router.js` | new — Custom GPT surface (10 endpoints) |
| `packages/memory-server/src/bootstrap/action-rate-limiter.js` | new — 100/min per API key |
| `packages/memory-server/migrations/009_action_attempts.sql` | new — action_attempts table |
| `packages/memory-server/migrations/sqlite_registry.sql` | +SQLite twin of action_attempts |
| `packages/memory-server/src/server.js` | `createApp` accepts `openapiRouter`; routes through it |
| `packages/memory-server/scripts/serve.mjs` | wires `createOpenapiRouter` into the app |
| `packages/memory-server/src/registry/sqlite-registry-store.js` | +action_attempts contract |
| `packages/memory-server/src/index.js` | +exports for `createOpenapiRouter`, `createActionRateLimiter` |
| `packages/memory-openapi/openapi.yaml` | +4 paths, +9 schemas, version 0.0.0 → 0.4.1 |
| `packages/memory-openapi/test/openapi.test.js` | +1 test (12 → 13); updated expected routes + schemas |
| `packages/memory-server/test/console.test.mjs` | +16 tests (81 → 97) |
| `scripts/validate-release-0.4.1.mjs` | new — runs all 17 gates |
| `.ai/gpt/alfred-memory-gpt.json` | new — GPT builder config |
| `.ai/docs/custom-gpt-deploy.md` | new — deploy guide |
| `.ai/evals/regression-gates.json` | version 0.4.0 → 0.4.1; console-handlers 81 → 97; totals 228 → 244 |
| `package.json` | 0.4.0 → 0.4.1; test pipeline → `validate:release-0.4.1` |
| `packages/memory/CHANGELOG.md` | +0.4.1 entry |

## Validation at tag time

- `validate:release-0.4.1` → 17/17 gates PASS (244 tests)
- `validate:policies` → 12/12 checks PASS
- `npm test` → all green
- Provider calls: 0

## What this GPT can NOT do (be honest with users)

- Cannot run the orchestrator or specialist agents. (v0.5.0)
- Cannot run skills locally. (v0.5.0)
- Cannot execute local code. (Disabled at the GPT capability level.)
- Cannot read other tenants' memories. (Blocked by `policies/check` and
  by the per-tenant API key.)

If the user wants those, point them at the CLI
(`packages/memory-server/scripts/alfred.mjs`).
