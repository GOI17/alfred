---
id: memory-hosting-policy
description: >
  Storage backend selection rules per tenant kind. Codifies the
  decision that human agents require Postgres, coding agents
  ask the user, and self-hosted servers use Postgres.
owner: core
status: active
applies_to: packages/memory/** and packages/memory-server/**
related:
  - .ai/architecture/memory-hosting-modes.md
  - .ai/policies/memory-workspace-policy.md
  - .ai/policies/security.md
---

# Memory Storage Backend Selection Policy

## Scope

Applies to all tenant provisioning operations in `packages/memory-server/` and
the registry it manages. Enforced by:

1. **`alfred_registry` CHECK constraints** at the PostgreSQL/SQLite level.
2. **`TenantService.provision` validation** at the application level.
3. **`alfred init` prompts** at the UX level.

Defense in depth: any of the three can fail and the policy still holds.

## Definitions

| Term | Meaning |
|---|---|
| `tenant.kind` | One of `human_agent`, `coding_agent_only`, `hybrid_with_human`, `server_managed` |
| `tenant.storage_backend` | One of `sqlite`, `postgres` |
| `human_agent` | A user-facing chat interface (ChatGPT, Claude web, Gemini web) talking to Alfred Memory over HTTPS |
| `coding_agent` | An IDE/CLI-based agent (opencode, Codex, Pi, Copilot) talking to Alfred Memory over loopback or HTTPS |
| `workspace` | A directory on disk from which an agent invokes Alfred Memory. Each workspace corresponds to one `tenant_id` at init time |

## Rules

### Rule 1 — Human agents require Postgres

Tenants with `kind IN ('human_agent', 'hybrid_with_human')` MUST use Postgres.
Provisioning a SQLite tenant for these kinds is rejected at the DB constraint
level and at the application level.

**Why**: Human agents only run in cloud environments. SQLite cannot serve
HTTPS traffic at production scale, cannot be backed up atomically by `pg_dump`,
and cannot accept writes from multiple isolated processes. The isolation guarantee
that "two tenants never share a DB" is also materially stronger with Postgres
because the audit copy is a real `pg_dump`, not a file copy.

### Rule 2 — Coding agents ask the user

When a workspace is initialized with `alfred init` for a coding agent, the user
is asked to choose between SQLite and Postgres.

**Default when running locally**: SQLite (one file per tenant, easy to audit,
fast on SSD).
**Default when running against a `self-hosted` server**: Postgres (the server's
connection-pool model expects Postgres).

The choice is recorded in `<cwd>/.alfred/config.json` and bound to the tenant.

### Rule 3 — Self-hosted servers use Postgres

Alfred Memory Server in `self-hosted` mode MUST use Postgres for the registry
and for all tenants. SQLite is allowed only in `local` mode
(single-process loopback).

The registry process refuses to start in `self-hosted` mode if the registry DB
is SQLite. This is enforced at boot time, not at runtime, so misconfiguration
fails fast.

### Rule 4 — Migrations are allowed and auditable

Tenants can migrate SQLite to Postgres via `alfred migrate`. The reverse
migration (Postgres to SQLite) is allowed only for `coding_agent_only` tenants
because the higher guarantees of Postgres are not silently downgraded for
human agents.

All migrations emit a trace event with `event = "tenant.migrate"` and include
the source tenant id, target backend, and reason (if provided).

### Rule 5 — One workspace, one tenant, one backend

A single workspace NEVER points to two different backends simultaneously. This
is enforced by `UNIQUE (workspace_hash)` on `tenants` plus a CHECK constraint
that ensures `db_path` and `db_connection` map to the chosen backend.

## Backend ↔ Column Mapping (per Rule 5)

| `storage_backend` | Required column set |
|---|---|
| `sqlite` | `db_path IS NOT NULL AND db_connection IS NULL` |
| `postgres` | `db_connection IS NOT NULL AND db_path IS NULL` |

## Provisioning Validation Order

When `TenantService.provision` is called:

1. Validate `kind`, `storage_backend` against the enums.
2. Reject if `kind IN ('human_agent', 'hybrid_with_human')` and `storage_backend = 'sqlite'`.
3. Reject if `server_managed` and `storage_backend = 'sqlite'` (self-hosted).
4. Ensure `db_path` XOR `db_connection` matches the backend.
5. Delegate to the storage-specific factory.

If any step fails, return a typed error with a human-readable reason.

## Validation Commands

- `alfred validate-policy` — checks every existing tenant satisfies the rules above.
- `memory-storage-policy.yml` — CI eval suite that runs negative tests:
  - Attempts to provision SQLite for human agents. Expects rejection.
  - Attempts to migrate a human-agent tenant SQLite -> Postgres. Expects success.
  - Attempts to create dual-Postgres in a workspace hierarchy. Expects rejection.

## Workspace Hierarchy Interaction

This policy is independent of the workspace hierarchy rules in
`.ai/policies/memory-workspace-policy.md`. A workspace hierarchy may contain
zero, one, or many tenants, each individually satisfying these storage backend
rules.

The one cross-policy rule is **Rule 5**: a single workspace never carries two
backends. This is enforced by `UNIQUE (workspace_hash)`, not by anything in the
workspace policy itself.

## Versioning

This policy is part of Alfred v0.3.0. Any change to the five rules above
requires:

1. A new entry in `packages/memory/CHANGELOG.md`.
2. A new eval dataset in `.ai/evals/datasets/memory-hosting-policy.yml`.
3. A regression baseline update approved by a human.

## Related Policies

- `.ai/policies/security.md` — deny-by-default; provisioning requires a valid
  API key already created by a human operator.
- `.ai/policies/memory-workspace-policy.md` — the parallel policy governing
  workspace hierarchy and `tenant_access`.
