---
id: execution/neon-pooled-tenants
description: Make schema-per-tenant provisioning and runtime queries safe on Neon pooled connections.
phase: issue-128-neon-pooled-tenants
author: core
issue: 128
---

# Neon pooled tenant connections

## Problem

Alfred stored each tenant's schema in a PostgreSQL startup option:
`options=-c search_path=tenant_<id>,public`. Neon pooled endpoints use
PgBouncer transaction pooling and reject `search_path` in the startup packet.
Session-level `SET search_path` is also unsafe because its state does not
persist across pooled transactions.

## Requirements

1. Tenant connection URLs must not contain startup `options`.
2. Schema provisioning must run inside one transaction and use transaction-local
   `set_config('search_path', ..., true)` only for its DDL.
3. Runtime memory queries must schema-qualify their table names and never depend
   on session state.
4. Runtime must strip legacy startup options from already-registered tenant
   connection URLs without logging credentials.
5. Schema identifiers must be validated before SQL interpolation.
6. Existing direct PostgreSQL behavior and cross-tenant isolation must remain
   compatible.
7. Provider calls remain 0.

## Completion conditions

- [x] Unit tests cover pooled URL cleanup, schema qualification, transaction
      commit, and transaction rollback.
- [x] Existing Memory and console tests pass.
- [x] Real PostgreSQL cross-tenant isolation passes in CI.
- [ ] Production deploy succeeds.
- [ ] Tenant bootstrap no longer reports an unsupported startup parameter.
- [x] Trace reports provider calls 0.
