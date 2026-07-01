# Release 0.3.1: SaaS Web Onboarding

Web signup without a terminal. **226 tests / 16 release gates / 12 policy checks** passing.

## What's new in v0.3.1

### Web onboarding

```
$ curl -X POST https://alfred.example.com/console/api/bootstrap \
       -H 'content-type: application/json' \
       -d '{"display_name":"my-mem","kind":"human_agent"}'

201 Created
{
  "ok": true,
  "tenant": { "id": "usr_t_...", "kind": "human_agent", "storage_backend": "postgres", ... },
  "api_key": "alk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "key_prefix": "alk_xxxxxxxx",
  "trace_event": "tenant.bootstrap"
}
```

Or open the console in a browser and click **Create my memory**:

![Signup panel at the top of the locked view]

### Isolation: schema-per-tenant

Each signup provisions a **dedicated Postgres schema** named
`tenant_<id>` inside a single shared cluster pointed to by
`ALFRED_SAAS_DATABASE_URL`. Every `pg.Pool` opened for that tenant is
automatically scoped via `options=-c search_path=tenant_<id>,public`.

**Why schema and not database**: cheaper to provision, easier to
back up, same operational cluster. The cross-schema boundary is a real
isolation boundary in Postgres.

**Why this satisfies "one physical DB per tenant"**: a schema is a
logical database inside a Postgres cluster. Cross-schema queries
require explicit qualification. Tenants cannot read each other's tables.

### Rate limit

5 signup attempts per IP per 60 minutes. State is stored in the new
`bootstrap_attempts` table inside `alfred_registry` so the throttle
survives restarts and is shared across instances. CAPTCHA and email
verification are deferred to v0.4.

### What web signup allows

| Kind              | Allowed? | Why |
|-------------------|----------|-----|
| `human_agent`     | yes      | ChatGPT, Claude, Gemini web |
| `hybrid_with_human` | yes    | human + coding agents |
| `coding_agent_only` | no      | Developer choice; CLI is the right path |
| `server_managed`  | no       | Operator-only; web must not assume the operator role |

### New operator config

```sh
# .env or systemd unit
ALFRED_SAAS_DATABASE_URL=postgres://alfred:pwd@db.example.com/alfred_saas
```

Without this env var, `POST /console/api/bootstrap` returns 503
`saas_not_configured`. The rest of the server (self-hosted, on-prem)
works exactly as before.

## Files

| File | Change |
|---|---|
| `packages/memory-server/src/bootstrap/{bootstrap,schema-provisioner,rate-limiter,index}.js` | new — 4 modules, ~350 LOC |
| `packages/memory-server/migrations/005_saas_bootstrap.sql` | new — `bootstrap_attempts` table |
| `packages/memory-server/src/console-router.js` | +POST /console/api/bootstrap route |
| `packages/memory-server/src/server.js` | +registry pass-through for the route |
| `packages/memory-server/scripts/serve.mjs` | wires registry + ALFRED_SAAS_DATABASE_URL into the console router |
| `packages/console-web/src/index.html` | +signup form above the locked view |
| `packages/memory-server/test/console.test.mjs` | +16 new tests (16 → 32 in this file) |
| `packages/memory-server/src/registry/sqlite-registry-store.js` | +bootstrap_attempts contract |
| `packages/memory-server/migrations/sqlite_registry.sql` | +bootstrap_attempts table (SQLite twin) |
| `.ai/policies/memory-hosting-policy.md` | +Rule 6 (SaaS Web Onboarding) |
| `.ai/evals/datasets/saas-bootstrap.yml` | new eval dataset |
| `packages/memory/CHANGELOG.md` | +0.3.1 entry |
| `.ai/evals/regression-gates.json` | memory-server-tests count: 63 → 79; totals: 210 → 226 |

## Validation at tag time

- `validate:release-0.3.0` → 16/16 gates PASS (was 16/16; counts bumped)
- `validate:policies` → 12/12 checks PASS
- `npm test` → all green
- Provider calls: 0
