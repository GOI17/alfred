# Shared Memory Attribution and History

Issue: #102

## Scope

Add a safe explanation layer to existing tenant-scoped memory. The feature
does not store chain-of-thought and does not call providers.

## Domain contract

`MemoryRecord.attribution` is optional for backward compatibility:

```ts
interface MemoryAttribution {
  harness: string;
  actor: string;
  reason: string;
  sessionId?: string;
}
```

Rules:

- `harness` is a lowercase identifier with letters, numbers, `_`, `-`, or `:`.
- `actor` and `reason` are non-empty user-readable strings.
- `reason` describes why durable persistence was useful. It is not hidden
  reasoning.
- attribution is editable as a whole to support legacy backfill.
- legacy rows without attribution are not mutated during reads.

## Persistence

- PostgreSQL: nullable `JSONB attribution`.
- SQLite: nullable JSON-encoded `TEXT attribution`.
- migrations are additive and idempotent.
- store mappers preserve `undefined` for legacy rows.

## Console API

Authentication resolves the full API key before every protected route.

- `GET /console/api/tenants` returns only the authenticated tenant.
- tenant key routes require `authenticated.tenant_id === route.tenant_id`.
- key revocation first verifies that the target key belongs to the
  authenticated tenant.
- `GET /console/api/history` lists memories from the authenticated tenant only.

History query:

- `limit`, `offset`, `type`, `namespace`, `projectId`, `tag` use existing
  Memory list validation.
- optional `harness` filters the returned page after normalization.
- results are newest-first and include a presentation-safe `story` object.

## Console UI

Add a History area above connection setup:

- harness filter chips: All, ChatGPT, Gemini, Codex, OpenCode;
- cards show `actor`, action, content, reason, type/namespace, and timestamp;
- unknown legacy attribution is visibly labeled;
- empty, loading, auth, and error states include text, not color alone.

## Adapter contract

- MCP create/update accepts `attribution`.
- OpenAPI schemas expose `MemoryAttribution`.
- first-party bridge attestation and key-bound harness identity are Phase 2;
  this slice documents client-supplied attribution as untrusted.

## Trace and privacy

Server operations keep existing request traces. History reads make no provider
calls. Rationale text is returned only within the authenticated tenant.

## Test plan

- domain accepts valid attribution and rejects partial/unsafe values;
- all stores round-trip and update attribution;
- SQLite migration preserves legacy rows;
- Console rejects missing, invalid, revoked, and cross-tenant keys;
- Console history returns same-tenant memories and safe legacy fallbacks;
- MCP/OpenAPI contracts include attribution;
- Console build/check succeeds.
