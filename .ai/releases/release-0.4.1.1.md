# Release 0.4.1.1: Fly.io Deployment Path

The Docker + Fly.io deployment path for Alfred Memory v0.4.1. **Internal
patch, no test changes.** Validates 17/17 gates and ships a turnkey
container image (248MB) ready for `flyctl deploy`.

## What's in this release

### Dockerfile (single-stage, Node 22)

Alfred Memory v0.4.1 uses **only Node.js built-ins** (no external npm
dependencies). That means the image is a single `FROM node:22-bookworm-slim`
layer with the source copied in, **no pnpm install step**, and a final size
of **248MB**. Multi-stage builds with pnpm are preserved in the Dockerfile
comment for the day we add an external dep.

Key choices:

- **Node 22** (required for `node:sqlite`).
- **Non-root user** (`alfred` uid 1001) for runtime safety.
- **Entrypoint runs migrations first** then starts the server. Idempotent.
- **Listens on port 8080** (Fly's internal port convention).

### fly.toml (free-tier-tuned)

Production Fly.io config. Highlights:

- 256MB shared-cpu-1x (free tier).
- `auto_stop_machines = "stop"` + `auto_start_machines = true` (free tier).
- `min_machines_running = 0` (zero-cost when idle).
- **Persistent volume** at `/app/data` for the SQLite registry.
- **HTTP health checks** every 30s, 3-strike rollback.
- **Force HTTPS** on port 80; TLS handled by Fly's edge.

To upgrade to paid: edit `memory_mb`, set `min_machines_running = 1`, and
add `size = "shared-cpu-1x"` under `[[vm]]`.

### migrate-on-boot.mjs

Idempotent schema bootstrap. On every container start:

1. Ensures `/app/data` exists.
2. Applies `sqlite_registry.sql` to the registry (always).
3. If `ALFRED_SAAS_DATABASE_URL` is set, applies migrations `005-009` to
   the Postgres SaaS DB (opt-in).

This is what `release_command` calls in `fly.toml` before swapping to the
new release.

### .github/workflows/deploy-fly.yml

CI/CD on every push to `main`:

1. `validate:policies` → 12/12 checks.
2. `validate:release-0.4.1` → 17/17 gates.
3. `docker buildx build --check` (catches Dockerfile errors before deploy).
4. `flyctl deploy --remote-only` (uses Fly's build cache, fast).
5. Smoke-test with `GET /health`, retry 5× before failing.

Opt-in: requires a `FLY_API_TOKEN` GitHub secret. Get one with
`flyctl auth token`.

### .ai/docs/fly-deploy.md

12-step operator guide: install flyctl, create app, attach Postgres,
create volume, set secrets, deploy, verify, custom domain, observability,
backup, scale, teardown. Assumes zero prior Fly.io knowledge.

## Bugs fixed (discovered while smoke-testing the Docker image)

These would have bitten anyone deploying v0.4.1 without the fix:

1. **`createServer` was async.** It returned a Promise, not an `http.Server`.
   `serve.mjs` called `.listen()` on the Promise and crashed at boot with
   `server.listen is not a function`. Made it sync.

2. **`createRateLimiter` rejected the v0.3.1+ registry shape.** v0.3.1
   scoped the bootstrap contract under `registry.bootstrap.*`, but the
   v0.3.0 rate-limiter expected it flat at the top level. At boot time
   the server crashed with `registry must implement recordBootstrapAttempt`.
   Now accepts both, mirroring `createActionRateLimiter` from v0.4.1.

3. **`serve.mjs` didn't pass `config` to `createServer`.** Even after the
   sync fix, the server crashed with `Cannot read properties of undefined
   (reading 'mode')`. Fixed by passing `config`, `consoleRouter`, and
   `registry` through.

## Docker smoke test (what we verified)

- `docker build` → 3.5s on Apple silicon.
- `docker run` with `ALFRED_MEMORY_HOSTING=local` → listens on :8080.
- `GET /health` → `{"status":"ok","mode":"local"}`.
- `GET /agents/manifest` → 6 agents.
- `GET /skills/manifest` → 2 skills.
- `POST /policies/check` with `delete_all_tenants` →
  `{"allowed":false,"reason":"forbidden_action"}`.
- `POST /policies/check` with `list` →
  `{"allowed":true,"reason":"ok"}`.
- `GET /memories` without auth → 401.
- Final image size: 248MB.

## How to deploy (TL;DR)

```sh
brew install flyctl
flyctl auth signup
git clone git@github.com:GOI17/alfred.git && cd alfred
flyctl launch --no-deploy
flyctl postgres create --name alfred-db --region gru
flyctl postgres attach alfred-db
flyctl postgres connect alfred-db -- -c "CREATE DATABASE alfred_saas;"
flyctl volumes create alfred_data --size 1
flyctl secrets set ALFRED_MEMORY_HOSTING=self-hosted ALFRED_SAAS_DATABASE_URL=... \
  ALFRED_PUBLIC_URL=https://alfred-your-name.fly.dev ALFRED_SMTP_HOST=... ...
flyctl deploy
```

See `.ai/docs/fly-deploy.md` for the full guide.

## Validation

- `validate:release-0.4.1` → 17/17 gates PASS (244 tests)
- `validate:policies` → 12/12 checks PASS
- Docker build + smoke test → all endpoints responding correctly
- Provider calls: 0
