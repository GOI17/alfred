# Release 0.4.0: Production-Ready SaaS

CAPTCHA, email verification, CI-tested Postgres isolation, forgot-my-key
recovery, and local embedding-based semantic search. **228 tests / 17
release gates / 12 policy checks** passing. **Zero provider calls.**

## What's new in v0.4.0

### 1. Cloudflare Turnstile (CAPTCHA) — opt-in

Anti-bot for `POST /console/api/bootstrap`. Off by default, fully
backward-compatible.

```sh
ALFRED_TURNSTILE_SITE_KEY=1x00000000000000000000AA
ALFRED_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

- Server verifies the token via `https://challenges.cloudflare.com/turnstile/v0/siteverify`
- Client sends `X-Turnstile-Token` header (or `captcha_token` in body)
- When the env vars are unset, the endpoint behaves exactly as in v0.3.1

### 2. Email verification (optional) — opt-in

If the signup form includes an `email` field, the server generates a
24h verification token. When SMTP is configured, a magic link is
emailed. Clicking the link marks the tenant as `email_verified`.

```sh
ALFRED_SMTP_HOST=smtp.example.com
ALFRED_SMTP_PORT=587
ALFRED_SMTP_USER=alfred
ALFRED_SMTP_PASSWORD=...
ALFRED_SMTP_FROM=alfred@example.com
```

- `GET /console/api/verify?token=...` (no auth, single-use)
- Tokens are single-use and expire after 24h
- Without SMTP, tokens are generated + stored but the email send is a no-op (and a structured log line)

### 3. CI Postgres isolation tests — opt-in via env

`.github/workflows/ci-postgres.yml` spins up a real `postgres:16-alpine`
service and runs the new `cross-tenant-isolation-postgres.test.mjs`
against it. The test is skipped in unit runs (no `ALFRED_TEST_POSTGRES_URL`).
PRs that break cross-tenant isolation in real Postgres are blocked.

### 4. Key recovery (forgot-my-key) — opt-in via email

```
$ curl -X POST https://alfred.example.com/console/api/recover \
       -H 'content-type: application/json' \
       -d '{"email":"alice@example.com"}'

200 OK
{ "ok": true, "delivery": "email" }
```

- Generates a single-use recovery token (3 per IP per hour, audited)
- On GET, the old API key is **revoked** and a fresh `alk_...` key is issued
- The new key is delivered via the configured SMTP channel
- Without SMTP, the recovery request is rejected with `smtp_unconfigured` (security: don't leak keys in the response)

### 5. Local semantic search — opt-in

`searchMemories` now accepts `mode: "semantic" | "keyword" | "hybrid"`.
The embedding model is `@xenova/transformers` with
`Xenova/all-MiniLM-L6-v2` (22MB, MIT, 384-dim). **Runs locally, no
network calls, no API keys, no provider.**

- Lazy-loaded on first use (model not imported at startup)
- Vectors stored in `memory_embeddings` table
- Hybrid mode = Reciprocal Rank Fusion of cosine similarity + FTS

```js
// keyword (default in v0.3.x)
const a = await searchMemories({ tenantId, query: "auth bug" });

// hybrid (default in v0.4.0)
const b = await searchMemories({ tenantId, query: "auth bug", mode: "hybrid" });

// pure semantic
const c = await searchMemories({ tenantId, query: "auth bug", mode: "semantic" });
```

If the model is unavailable (offline, no disk for the 22MB weight), the
service transparently falls back to keyword search.

## What stays the same

- All v0.3.1 features: web onboarding, schema-per-tenant, rate-limited signup
- All v0.3.0 features: multi-tenant, W5/W6 invariants, SQLite parity
- All v0.2.0 features: MVP memory CRUD, sessions, topics, AC

## Files added / changed

| File | Change |
|---|---|
| `packages/memory-server/src/bootstrap/captcha-verifier.js` | new — Turnstile siteverify wrapper |
| `packages/memory-server/src/bootstrap/email-sender.js` | new — Nodemailer wrapper, no-op when unconfigured |
| `packages/memory-server/src/bootstrap/verification.js` | new — 24h tokens + verify endpoint orchestrator |
| `packages/memory-server/src/bootstrap/recovery.js` | new — forgot-my-key orchestrator (3/IP/hour) |
| `packages/memory-server/src/bootstrap/index.js` | +re-exports for the 4 new modules |
| `packages/memory-server/src/search/embedder.js` | new — lazy-load @xenova/transformers |
| `packages/memory-server/src/search/semantic-index.js` | new — cosine + RRF |
| `packages/memory-server/src/search/search-service.js` | new — `mode: semantic \| keyword \| hybrid` |
| `packages/memory-server/src/console-router.js` | +GET /console/api/verify, +POST/GET /console/api/recover |
| `packages/memory-server/src/server.js` | registry pass-through; `createServer` made async |
| `packages/memory-server/src/registry/sqlite-registry-store.js` | +email_verifications, +recoveries, +memory_embeddings contracts |
| `packages/memory-server/migrations/006_email_verifications.sql` | new — `tenant_email_verifications` table |
| `packages/memory-server/migrations/007_recoveries.sql` | new — `tenant_recoveries` table |
| `packages/memory-server/migrations/008_memory_embeddings.sql` | new — `memory_embeddings` table |
| `packages/memory-server/migrations/sqlite_registry.sql` | +SQLite twins of the 3 new tables |
| `packages/memory-server/scripts/serve.mjs` | wired registry + ALFRED_SAAS_DATABASE_URL into console router |
| `packages/memory-server/test/console.test.mjs` | 16 → 81 tests (+65) |
| `packages/memory-server/test/cross-tenant-isolation-postgres.test.mjs` | new — opt-in real-Postgres isolation test |
| `packages/console-web/src/index.html` | +email field, +Turnstile widget, +forgot-my-key panel |
| `.github/workflows/ci-postgres.yml` | new — real Postgres service for cross-tenant isolation |
| `.ai/evals/regression-gates.json` | split memory-server-tests into core-handlers (47) + console-handlers (81); 16 → 17 gates, totals stay 228 |
| `.ai/evals/datasets/saas-bootstrap.yml` | +CAPTCHA + email vectors |
| `.ai/evals/datasets/semantic-search.yml` | new eval dataset |
| `.ai/evals/datasets/key-recovery.yml` | new eval dataset |
| `packages/memory/CHANGELOG.md` | +0.4.0 entry |

## Validation at tag time

- `validate:release-0.4.0` → 17/17 gates PASS (228 tests)
- `validate:policies` → 12/12 checks PASS
- `npm test` → all green
- Provider calls: 0

## Operator setup cheatsheet

| Feature | Env vars | Default |
|---|---|---|
| CAPTCHA | `ALFRED_TURNSTILE_SITE_KEY`, `ALFRED_TURNSTILE_SECRET_KEY` | off |
| Email | `ALFRED_SMTP_HOST`, `ALFRED_SMTP_PORT`, `ALFRED_SMTP_USER`, `ALFRED_SMTP_PASSWORD`, `ALFRED_SMTP_FROM` | off (no-op) |
| SaaS schema-per-tenant | `ALFRED_SAAS_DATABASE_URL` | required for web onboarding |
| Local embeddings | (none — model lazy-loaded) | on, 22MB weight |
| Postgres CI | `ALFRED_TEST_POSTGRES_URL` (in workflow only) | off locally, on in CI |

## What's not in 0.4.0 (deferred)

- Federated sync between agent instances → v0.5.0
- Hybrid offline cache → v0.5.0
- Multi-agent collaboration sessions → v0.5.0
