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
