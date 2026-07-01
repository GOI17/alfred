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
