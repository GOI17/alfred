# Shared Memory Audit

Issue: #102

## Desired experience

A human connects ChatGPT, Gemini, Codex, and OpenCode to one Alfred tenant.
Every harness can read the same durable memories and the Console presents them
as a chronological story:

> Codex recorded a decision → use one tenant as the sharing boundary
> Why it was saved → future agents need the same architecture constraint

The story records a concise persistence rationale. It must never expose hidden
chain-of-thought, raw private reasoning, secrets, or temporary transcripts.

## Executive finding

Alfred has the correct sharing primitive but not the requested trust and
explanation layer.

- **Already present:** tenant-scoped storage, API keys, CRUD/search, MCP for
  coding harnesses, OpenAPI adapters for ChatGPT and Gemini, SQLite/Postgres
  store implementations, and deterministic persistence policy decisions.
- **Missing:** first-class attribution, persistence rationale retention,
  chronological Console history, connection health, and automatic Codex /
  OpenCode memory configuration.
- **Critical security gap:** Console tenant/key routes check that a key header
  exists but do not validate the key or bind it to the requested tenant.
- **Hosting gap:** the bundled server opens SQLite tenant databases only.
  Postgres is described by policy as the multi-machine/shared target, but the
  runtime factory rejects Postgres tenants.

## Evidence by layer

| Layer | Current behavior | Gap | Priority |
|---|---|---|---|
| Domain | `source` is required; `metadata` is arbitrary | No structured harness, actor, reason, or session | P0 |
| Persistence policy | `shouldPersist` returns an allow/deny reason | Reason is not stored with the resulting memory | P0 |
| Tenant routing | Clients with keys for one tenant resolve to the same `userId` scope | No trusted per-harness identity | P1 |
| MCP | Generic CRUD/search for Codex/OpenCode-compatible clients | No common attribution contract | P0 |
| ChatGPT/Gemini | OpenAPI CRUD/search adapters | No common attribution contract | P0 |
| Console API | Lists tenants and manages keys | Header presence only; cross-tenant access is possible | P0/security |
| Console UI | Tenant/key onboarding instructions | No memory search, history, provenance, or connection status | P0 |
| SQLite | WAL, one database per tenant | Suitable for one machine; no federated synchronization | P1 |
| Postgres | Store and migrations exist | Bundled tenant router rejects Postgres | P1 |
| Codex/OpenCode adapters | Generate harness agent artifacts | Do not preview or install Memory MCP connection | P1 |

## Risk assessment

1. **Cross-tenant Console access — critical.** Any non-empty credential can
   enumerate tenants and manage another tenant's keys.
2. **False authorship — high.** Free-form `source` cannot establish which
   harness wrote a memory.
3. **Unexplained persistence — high.** A later agent can see content but cannot
   know why it was considered durable.
4. **Private-reasoning leakage — high if designed incorrectly.** A field called
   “thought” encourages storage of chain-of-thought. Alfred must store a short,
   user-readable persistence reason instead.
5. **Deployment mismatch — medium/high.** Shared multi-machine behavior is
   promised by architecture but the bundled server supports SQLite only.
6. **Configuration drift — medium.** Console instructions and adapter output
   can diverge because connections are not verified.

## Decision

Ship a backward-compatible `attribution` value:

```json
{
  "harness": "codex",
  "actor": "Codex",
  "reason": "This decision constrains future architecture work.",
  "sessionId": "optional-session-correlation"
}
```

The domain stays harness-agnostic: `harness` is a validated identifier rather
than a closed enum. Console filters may offer known product values while still
displaying future adapters.

Legacy records remain readable and are presented as:

- harness: `unknown`
- actor: their existing `source`, or `Unknown`
- reason: `Not recorded by the legacy client.`

## Course of action

### Phase 1 — this change

- Validate and persist structured attribution in Memory.
- Expose it through types, MCP, and OpenAPI contracts.
- Authenticate Console API keys and enforce tenant scope.
- Add `/console/api/history` and a chronological Console story.
- Add regression and cross-tenant tests.

### Phase 2 — trusted connections

- Issue one key per harness with structured registry identity rather than
  relying solely on client-supplied attribution.
- Make ChatGPT/Gemini bridges and Memory MCP attest the harness from the key.
- Add connection health, last-seen time, and permission state in Console.
- Add preview-first MCP connection output to Codex/OpenCode adapters.

### Phase 3 — durable multi-machine operation

- Implement the bundled Postgres tenant store factory.
- Add migrations and end-to-end tests for shared Postgres history.
- Add optional offline cache/synchronization only after conflict semantics are
  specified.

## Success measures

- 100% of newly created first-party memories contain attribution.
- 0 cross-tenant Console authorization test escapes.
- A user can answer “who saved this, what was saved, why, and when?” from one
  Console screen.
- ChatGPT, Gemini, Codex, and OpenCode pass a same-tenant create/read matrix.
- Provider calls remain zero for storage, history, and connection detection.
