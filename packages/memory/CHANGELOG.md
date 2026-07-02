# Changelog

## 0.3.0

Multi-tenant extension of the v0.2.0 memory MVP. Backwards-compatible. Adds:

- `TenantService` with explicit policy validation.
- `UserService` with scrypt API key hashing.
- SQLite store parity with Postgres.
- 63 new tests (28 tenants + 17 users + 9 sqlite-memory + 9 policy).
- README updated with hosting modes and workspace hierarchy.

## 0.2.0

Initial MVP. Memory CRUD over `/memories`, `MemoryPolicy` decision engine, scoped by `namespace`.

See `README.md` for usage.

## 0.3.1 — 2026-07-01

### Added

- **SaaS Web Onboarding** — `POST /console/api/bootstrap` lets a new user
  sign up without a terminal. The endpoint creates a tenant in a shared
  Postgres cluster (one schema per tenant) and issues the first API key.
  Disabled by default; opt in by setting `ALFRED_SAAS_DATABASE_URL`.

- **Rate limiter** — 5 signup attempts per IP per 60 minutes, stored in
  the new `bootstrap_attempts` table. Configurable by editing
  `packages/memory-server/src/bootstrap/rate-limiter.js`.

- **Schema provisioner** — `createSchemaProvisioner` applies the
  per-tenant migrations (alfred_memory_users, alfred_memories,
  alfred_sessions, alfred_topics, alfred_acceptance_criteria) inside
  the new schema before the tenant row is inserted.

- **Console signup panel** — `packages/console-web/src/index.html` now
  includes a 2-field signup form (display name + kind radio) above the
  "paste an API key" input.

### Policy

- New Rule 6 in `.ai/policies/memory-hosting-policy.md`: SaaS Web
  Onboarding requires a shared Postgres cluster with schema-per-tenant
  isolation. Preserves the spirit of "one physical DB per tenant"
  while enabling operator-managed SaaS.

## 0.4.0 — 2026-07-01

Production-ready SaaS: CAPTCHA + email verification + CI-tested
Postgres isolation + key recovery + local semantic search. **228 tests
/ 17 release gates / 12 policy checks.** Zero provider calls.

### Added

- **Cloudflare Turnstile (CAPTCHA)** — opt-in anti-bot for
  `POST /console/api/bootstrap`. Set `ALFRED_TURNSTILE_SITE_KEY` and
  `ALFRED_TURNSTILE_SECRET_KEY` to enable. When unset, the endpoint
  behaves exactly as in v0.3.1. Client sends the token in the
  `X-Turnstile-Token` header (or `captcha_token` body field); the
  server verifies via `challenges.cloudflare.com/turnstile/v0/siteverify`.

- **Email verification** — opt-in via SMTP env vars
  (`ALFRED_SMTP_HOST`, `ALFRED_SMTP_PORT`, `ALFRED_SMTP_USER`,
  `ALFRED_SMTP_PASSWORD`, `ALFRED_SMTP_FROM`). When configured and the
  signup form includes an `email` field, the server generates a 24h
  single-use token and emails a magic link. `GET /console/api/verify`
  marks the tenant as `email_verified`. Without SMTP, tokens are still
  issued and stored, but the email send is a no-op (with a structured
  log line).

- **CI Postgres isolation** — `.github/workflows/ci-postgres.yml`
  spins up a real `postgres:16-alpine` service and runs the new
  `cross-tenant-isolation-postgres.test.mjs` against it. The test is
  skipped in local unit runs (no `ALFRED_TEST_POSTGRES_URL`). PRs that
  break cross-tenant isolation in real Postgres are blocked.

- **Key recovery (forgot-my-key)** — `POST /console/api/recover` +
  `GET /console/api/recover` flow. The user submits their email; the
  server issues a one-shot recovery token (3 per IP per hour, audited
  in the new `tenant_recoveries` table). On consume, the old API key
  is revoked and a fresh `alk_...` key is issued and emailed.
  Without SMTP, the request is rejected with `smtp_unconfigured` (we
  never leak keys in the response body).

- **Local semantic search** — `searchMemories` now accepts
  `mode: "semantic" | "keyword" | "hybrid"`. The embedding model is
  `@xenova/transformers` + `Xenova/all-MiniLM-L6-v2` (22MB, MIT,
  384-dim), **runs locally, no network calls, no API keys, no
  provider**. Vectors are stored in the new `memory_embeddings` table.
  Lazy-loaded on first use; if the model is unavailable, the service
  transparently falls back to keyword search.

### Changed

- **Regression gates** — the previous `memory-server-tests` gate (which
  ran 6 test files in a single command but reported a single number)
  has been split into two gates for clarity:
  - `memory-server-core-handlers` (server + init + cli + registry-store
    + migrate) — 47 tests
  - `memory-server-console-handlers` (console surface: bootstrap,
    verify, recover, semantic search, CAPTCHA, email) — 81 tests
  Total: 228 tests / 17 gates. Run the same validator to confirm.

- **Console web UI** — the signup form gained an email field, a
  Turnstile widget (rendered only when configured), and a
  "forgot my key" panel below the locked view that triggers the
  recovery flow.

### Files

- New modules:
  `packages/memory-server/src/bootstrap/{captcha-verifier,email-sender,verification,recovery}.js`,
  `packages/memory-server/src/search/{embedder,semantic-index,search-service}.js`
- New migrations: `006_email_verifications.sql`, `007_recoveries.sql`,
  `008_memory_embeddings.sql` (with SQLite twins in
  `migrations/sqlite_registry.sql`)
- New tests: `cross-tenant-isolation-postgres.test.mjs` (opt-in real
  Postgres); `console.test.mjs` grew from 16 → 81 tests
- New workflows: `.github/workflows/ci-postgres.yml`
- New eval datasets: `semantic-search.yml`, `key-recovery.yml`
- `regression-gates.json`: 16 → 17 gates; totals stay 228
- `releases/release-0.4.0.{md,json}`, observability trace
  `release-0.4.0.json`

## 0.4.1 — 2026-07-01

Custom GPT surface. **244 tests / 17 release gates / 12 policy checks.**
Zero provider calls.

### Added

- **`createOpenapiRouter`** (`packages/memory-server/src/openapi-router.js`) — the
  HTTP surface a Custom GPT (or any OpenAPI 3.1 consumer) can call against
  Alfred Memory. Public endpoints (no auth) include `/health`,
  `/agents/manifest`, `/skills/manifest`, and `/policies/check`. Authenticated
  endpoints reuse the existing `/memories` CRUD plus a new `/search` endpoint
  that accepts `mode: 'semantic' | 'keyword' | 'hybrid'`.

- **Action rate limiter** (`createActionRateLimiter`,
  `packages/memory-server/src/bootstrap/action-rate-limiter.js`) — 100 requests
  per API key per rolling 60 minutes. Keyed by SHA-256 of the API key, so a
  user burning through their quota does not affect anyone else. State stored
  in a new `action_attempts` table (Postgres + SQLite twins).

- **OpenAPI 3.1 schema extension** (`packages/memory-openapi/openapi.yaml`) —
  4 new paths (`/agents/manifest`, `/skills/manifest`, `/policies/check`,
  `/search`) and 9 new component schemas (`Agent`, `AgentManifest`, `Skill`,
  `SkillManifest`, `PolicyCheckInput`, `PolicyCheckResult`, `SearchInput`,
  `SearchResult`).

- **Custom GPT builder config** (`.ai/gpt/alfred-memory-gpt.json`) — versioned
  GPT configuration: name, description, system prompt, conversation starters,
  capabilities (web/dall-e/code-interpreter all disabled), action metadata.
  This is the file you import when creating the GPT in the ChatGPT builder.

- **Custom GPT deploy guide** (`.ai/docs/custom-gpt-deploy.md`) — step-by-step
  instructions for hosting Alfred Memory, serving the OpenAPI schema, creating
  the Custom GPT, publishing to the GPT Store, and rotating keys.

### Changed

- **`regression-gates.json`** — `memory-server-console-handlers` count
  81 → 97 (16 new tests covering the openapi surface). Total tests
  228 → 244. Gate count stays at 17.

- **`package.json`** — `0.4.0` → `0.4.1`; test pipeline swapped to
  `validate:release-0.4.1`.

- **`packages/memory-server/src/server.js`** — `createApp` accepts an
  optional `openapiRouter` parameter and routes the Custom GPT surface
  through it. Backward-compatible.

- **`packages/memory-server/scripts/serve.mjs`** — wires
  `createOpenapiRouter` into the app, with `projectRoot: process.cwd()` and
  the registry for rate limiting.

### Policy

No new policy. All endpoints honor the existing
`memory-hosting-policy.md` and `security.md`. The `/policies/check` endpoint
is a thin v0.4.1 implementation that rejects a fixed set of forbidden
actions and verifies namespace + cross-tenant access; it is not a full
policy engine (that's v0.5.0).

### Files

- New modules:
  `packages/memory-server/src/openapi-router.js`,
  `packages/memory-server/src/bootstrap/action-rate-limiter.js`
- New migration: `009_action_attempts.sql` (Postgres + SQLite twin)
- New tests: 16 new tests in `console.test.mjs` (81 → 97); updated
  `packages/memory-openapi/test/openapi.test.js` (12 → 13)
- New artifacts: `.ai/gpt/alfred-memory-gpt.json`,
  `.ai/docs/custom-gpt-deploy.md`
- `regression-gates.json`: totals 228 → 244, memory-server-console-handlers
  81 → 97
- `releases/release-0.4.1.{md,json}`, observability trace
  `release-0.4.1.json`

## 0.4.1.1 — 2026-07-01

Fly.io deployment path. Internal patch, no test changes. Validates
17/17 gates and ships a turnkey Docker + Fly.io deploy.

### Added

- **`Dockerfile`** — single-stage Node 22 image (required for
  `node:sqlite`), non-root user (`alfred` uid 1001), 248MB final size.
  The image runs `migrate-on-boot.mjs` then `serve` on port 8080.
  No external npm dependencies; the server uses only Node.js built-ins.

- **`fly.toml`** — production Fly.io config: 256MB shared-cpu-1x,
  auto-stop/auto-start (free tier), persistent volume for SQLite at
  `/app/data`, HTTP health checks every 30s, force HTTPS, automatic
  TLS via Fly edge.

- **`migrate-on-boot.mjs`** — idempotent schema bootstrap. On every
  container start it: (1) ensures `/app/data` exists, (2) applies
  `sqlite_registry.sql` to the registry, (3) optionally applies
  `005-009_action_attempts.sql` to the Postgres SaaS DB if
  `ALFRED_SAAS_DATABASE_URL` is set.

- **`.dockerignore`** — keeps the build context small (excludes
  `node_modules`, `.git`, `**/test`, `.ai/releases`, `.ai/docs`).
  Explicitly re-includes the two registry files the openapi-router
  reads at runtime.

- **`.github/workflows/deploy-fly.yml`** — CI/CD: validate policies +
  run `validate:release-0.4.1` + check Dockerfile syntax on every
  push to `main`, then `flyctl deploy --remote-only` and smoke-test
  the new release with `GET /health`. Opt-in via the `FLY_API_TOKEN`
  GitHub secret.

- **`.ai/docs/fly-deploy.md`** — 12-step deploy guide for operators:
  install flyctl, create app, attach Postgres, create volume, set
  secrets, deploy, verify, custom domain, observability, backup,
  scale, teardown.

### Fixed (discovered while smoke-testing the Docker image)

- `createServer` in `packages/memory-server/src/server.js` was
  `async` and returned a Promise. The Docker image crashed at boot
  with `server.listen is not a function`. Made it sync so it returns
  an `http.Server` instance. Also updated `serve.mjs` to pass
  `config`, `consoleRouter`, and `registry` to `createServer`.

- `createRateLimiter` in
  `packages/memory-server/src/bootstrap/rate-limiter.js` crashed at
  boot with `registry must implement recordBootstrapAttempt(input)`
  when the registry exposes the contract nested under `.bootstrap`
  (v0.3.1+) instead of flat. Now accepts both shapes, mirroring
  `createActionRateLimiter` (added in v0.4.1).

- `createServer` was passed `{ app }` only, dropping `config` and
  the console router. `serverHandler` then threw
  `Cannot read properties of undefined (reading 'mode')`. Fixed by
  wiring all four arguments through.

### Validated

- `docker build` succeeds in 3.5s locally.
- `docker run` smoke test against the image:
  - `GET /health` → `{"status":"ok","mode":"local"}`
  - `GET /agents/manifest` → 6 agents
  - `GET /skills/manifest` → 2 skills
  - `POST /policies/check` (forbidden) → `allowed: false, reason: forbidden_action`
  - `POST /policies/check` (allowed) → `allowed: true`
  - `GET /memories` without auth → 401
- `validate:release-0.4.1` → 17/17 gates PASS (244 tests)
- Image size: 248MB

### Files

- New: `Dockerfile`, `fly.toml`, `.dockerignore`,
  `packages/memory-server/scripts/migrate-on-boot.mjs`,
  `.github/workflows/deploy-fly.yml`, `.ai/docs/fly-deploy.md`
- Changed: `packages/memory-server/src/server.js`
  (createServer sync), `packages/memory-server/scripts/serve.mjs`
  (passes config + consoleRouter), `packages/memory-server/src/bootstrap/rate-limiter.js`
  (accepts nested contract)

## 0.4.1.2 — 2026-07-01 (hotfix)

CI workflows were failing on every push to main. Both are fixed.

### deploy-fly was failing at "Install"

The workflow ran `pnpm install --frozen-lockfile` but there is no
`pnpm-lock.yaml` because **Alfred Memory has zero external npm
dependencies** (only Node built-ins). The install step crashed with
`ERR_PNPM_NO_LOCKFILE`.

Fixed by replacing the install step with a `node --check` syntax pass
over every `.mjs` / `.js` file under `packages/` and `scripts/`. That
keeps the validation useful (catches syntax errors before deploy) and
is correct for a no-deps project. The pnpm block is preserved as a
comment in the workflow for the day someone adds an external dep.

### ci-postgres was failing at "Run cross-tenant isolation"

The real-Postgres test failed with
`Cannot read properties of undefined (reading 'split')` at line 101
of `cross-tenant-isolation-postgres.test.mjs`. The test tried to extract
the schema name from `tenant.db_connection` by splitting on
`"search_path="` — but `new URL(...).toString()` percent-encodes the
`=` in the query string, so the literal `"search_path="` substring was
never found.

Fixed by switching to `provisioner.schemaNameFor(tenantId)`, which
derives the schema name from the tenant id without URL parsing. Robust
and obvious.

### Other

- All three GitHub Actions workflows bumped from Node 22 to Node 24
  (the new GitHub default; Node 22 is being deprecated on runners).
- `ci-postgres` got a `timeout-minutes: 10` to fail fast instead of
  hanging for the runner's 6h default.
- `deploy-fly` validate + deploy jobs got `timeout-minutes: 10` and
  `timeout-minutes: 15` respectively.

### Files

- `packages/memory-server/test/cross-tenant-isolation-postgres.test.mjs`
  (use `schemaNameFor()` instead of URL string-splitting)
- `.github/workflows/deploy-fly.yml` (replace pnpm install with
  syntax check; add timeouts; bump to Node 24)
- `.github/workflows/ci-postgres.yml` (add timeout; bump to Node 24)
- `.github/workflows/console-deploy.yml` (bump to Node 24)
