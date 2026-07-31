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

## Trusted connection contract

Phase 2 turns an API key into an explicit harness connection without changing
the tenant sharing boundary.

### R1: Dedicated harness credentials

- Console supports `chatgpt`, `gemini`, `codex`, and `opencode` connections.
- each connection issues a separate key inside the authenticated tenant;
- the key stores immutable `harness` and `actor` identity in the registry;
- generic and legacy keys remain valid with nullable connection identity;
- only the secret returned at creation time may be embedded in generated setup
  output.

### R2: Preview-first onboarding

- a user can preview consequences and setup before a key is issued;
- preview is deterministic, performs no provider calls, and writes nothing;
- explicit approval creates the connection key;
- the response shows the secret once and returns harness-specific setup;
- cloud harnesses clearly state that a public HTTPS endpoint is required;
- local harnesses receive an MCP configuration for `alfred-memory-mcp`.

### R3: Connection health

- Console lists every supported harness as `not_connected`,
  `awaiting_first_use`, or `connected`;
- `last_used_at` is the authoritative last-seen signal;
- an authenticated `GET /connection` endpoint lets an adapter verify its
  tenant and server-bound identity;
- status text does not depend on color alone.

### R4: Trusted memory attribution

- when a connection-bound key creates a memory, the server replaces client
  `harness` and `actor` values with the identity stored on the key;
- a non-empty persistence `reason` is required for connection-bound writes;
- clients cannot impersonate another first-party harness by changing the
  request body;
- legacy unbound keys retain the backward-compatible attribution behavior.

### R5: Agent behavior contract

Generated setup explains that a connected agent must:

1. search relevant shared memory before work where prior context matters;
2. save durable decisions, corrections, preferences, facts, and workflows;
3. include a concise user-readable persistence reason;
4. never persist private chain-of-thought, secrets, or temporary chatter.

## Adapter contract

- MCP create/update accepts `attribution`.
- OpenAPI schemas expose `MemoryAttribution`.
- MCP and OpenAPI create contracts accept the persistence reason;
- first-party requests are attested by key-bound server identity;
- generated instructions use the same memory behavior contract for all four
  harnesses.

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
- registry migrations preserve legacy keys and round-trip harness identity;
- connection preview performs no writes and connection creation requires
  authenticated tenant ownership;
- connection-bound keys cannot access Console administration routes;
- bound keys cannot spoof actor or harness and cannot omit the persistence
  reason;
- Console renders connection status and one-time setup output;
- `alfred init` prepares the SQLite tenant directory before first history use;
- Console build/check succeeds.

## Phase 2 completion conditions

- [x] Four preview-first connection cards are available in Console.
- [x] One immutable key identity is issued per connected harness.
- [x] Codex/OpenCode receive MCP setup and ChatGPT/Gemini receive OpenAPI setup.
- [x] Connection last-seen state is visible without exposing secrets.
- [x] Server-enforced attribution is covered by cross-harness tests.
- [x] A newly initialized local tenant can open empty history without manual
      filesystem repair.
- [x] Provider calls remain zero.
