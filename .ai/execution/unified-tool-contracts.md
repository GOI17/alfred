---
id: execution/unified-tool-contracts
description: Proposal, specification, and incremental plan for shared semantic tool contracts.
owner: core
phase: issue-193-unified-tool-contracts
issue: 193
---

# Unified Tool Contracts SDD

## Proposal

### Goal

Make every Alfred tool capability behave identically across MCP, CLI, OpenAPI,
and harness-native integrations through one neutral declaration, shared policy
gate, capability handler, and common application service that orders the full
invocation.

### Context

Independent transport implementations can drift in authorization, tenant
isolation, pagination, errors, schemas, and traces. Alfred's hexagonal and
harness-portability rules require transports to adapt shared semantics instead.
The first bounded slice is `memory.list/v1`.

### Scope

In scope:

- architecture decision, requirements, and follow-up implementation plan for
  issue #193;
- canonical portable contract schema, version, and deterministic hash;
- shared principal validation, `InvocationContextV1` tenant resolution,
  authorization gate, one capability handler, and one common application
  service that orders context → gate → handler → trace;
- deterministic MCP, CLI, OpenAPI, Codex, and OpenCode projections;
- contract fixtures, parity tests, traces, and incremental migration.

Out of scope:

- application code in this documentation change;
- executable implementation or tests in issue #193; follow-up issues own them;
- one mandatory transport for all harnesses;
- live harness configuration, provider calls, or model assignment changes;
- flag-day migration of every memory capability.

### Risks and rollback

| Risk | Mitigation |
|---|---|
| A projection loses protocol-specific behavior | Preserve envelope mapping in thin adapters and test normalized equivalence. |
| Existing consumers break | Characterize current behavior and migrate one projection at a time. |
| A hash suggests false parity | Exclude the derived hash from its RFC 8785 payload and require exact hash activation plus shared fixtures. |

Rollback is per projection: restore its prior routing while retaining the
canonical contract and fixtures. Never advertise the shared version/hash for a
rolled-back projection that does not satisfy it.

## Specification

### R1: Declaration, hash, and activation authority

The manifest **MUST** declare `memory.list/v1` behavior in a portable JSON
Schema 2020-12 subset. Its published wrapper **MUST** contain `contract` and a
derived `contract_hash`. The hash **MUST** be SHA-256 over RFC 8785 canonical JSON
for `contract` only; it excludes `contract_hash` and nonsemantic build metadata.

The canonical registry **MUST** be authoritative. MCP metadata, CLI metadata,
OpenAPI `x-alfred-contract`, Codex/OpenCode companion metadata, and traces
**MUST** publish the active id/version/hash. Same-version/different-hash
projections **MUST** fail parity and activation with `CONTRACT_MISMATCH`. An
incompatible hash change **MUST** use a new version.

#### Scenario: Non-self-referential identity

- **GIVEN** a canonical `contract` payload
- **WHEN** its published wrapper is generated twice
- **THEN** both RFC 8785/SHA-256 hashes are equal
- **AND** neither calculation includes `contract_hash`

### R2: One ordered invocation authority

The manifest **MUST** declare behavior. Shared infrastructure **MUST** validate
the principal, resolve exactly one tenant into `InvocationContextV1`, and apply
the authorization gate. One capability handler **MUST** implement functional
list/filter/order/pagination behavior. One common application service **MUST**
be the only entry point ordering context → gate → handler → trace.

Adapters **MUST** only extract credential evidence, map request/response/error
envelopes, invoke the application service, and provide transport metadata. They
**MUST NOT** decide or duplicate semantics.

#### Scenario: Gate precedes handler

- **GIVEN** an unauthorized request
- **WHEN** any transport invokes `memory.list/v1`
- **THEN** the common service records the failed gate outcome
- **AND** the capability handler is not invoked

### R3: Shared verified principal

Only the shared validator **MUST** create opaque `VerifiedPrincipalV1`; an
adapter **MUST NOT** self-declare trusted identity. Required fields are
`schema_version`, registered `issuer`, registered `provenance`, stable
pseudonymous `subject`, non-empty `tenant_bindings`, `issued_at`, nullable
`expires_at`, and versioned `validator_id`. Each binding **MUST** contain
`tenant_id`, `access` (`owner|reader`), and unique `scopes`.

Validation **MUST** check proof, issuer, audience/resource, expiry, revocation,
subject derivation, bindings, and scopes and fail closed on missing, ambiguous,
unsupported, or mismatched evidence. Raw credentials/evidence **MUST NOT** enter
the principal, result, or trace.

Only shared infrastructure **MUST** construct `InvocationContextV1`, requiring
`schema_version`, the verified principal, exactly one selected `tenant_binding`,
`selector_source`, and `auth_state: verified`. Selector precedence is:
credential-bound, explicit authenticated invocation selector, shared
runtime/workspace configuration, then intentional automatic resolution only for
exactly one principal binding. Conflicting trusted selectors fail rather than
override one another. No selector with multiple bindings, or a selector absent
from the bindings, **MUST** return `TENANT_CONTEXT_INVALID`. Adapters **MUST NOT**
construct this context, choose a binding, or provide transport-specific fallback.

#### Scenario: Adapter claims trust

- **GIVEN** an adapter supplies fields without shared validation evidence
- **WHEN** the application service receives the request
- **THEN** it returns `UNAUTHENTICATED`
- **AND** the handler is not invoked

### R4: Verifiable `memory.list/v1` DTOs

All DTO objects **MUST** set `additionalProperties: false`.

| DTO | Required shape |
|---|---|
| Request | Optional non-empty exact filters `namespace:string`, `project_id:string`, `tag:string`; optional `type` enum; `limit:integer` default 50/min 1/max 100; `offset:integer` default 0/min 0. No tenant property: tenant comes from `InvocationContextV1`. |
| Result | Required `{items: MemoryItemV1[], pagination}`. Every item requires `id`, `namespace`, `type`, `content`, `tags`, `source`, nullable `project_id`, nullable `metadata`, nullable `confidence` (0..1), nullable `expires_at`, `created_at`, and `updated_at`; tenant id is absent. |
| Pagination | Required integer `limit`, `offset`, `returned`, `total`; boolean `has_more`; integer-or-null `next_offset`. |
| Error | Required `{error:{code,message,retryable}, contract:{id,version,hash}}`. |

`type` **MUST** allow `preference|fact|decision|workflow|project|correction|source`.
Results **MUST** order by `created_at DESC, id DESC`; filtering precedes counting
and offset slicing. `returned` equals `items.length`; `has_more` equals
`offset + returned < total`; `next_offset` is that sum or null.

The minimum errors are mutually exclusive: `UNAUTHENTICATED` means principal
evidence is absent/invalid; `TENANT_CONTEXT_INVALID` means the principal is
valid but its selector is absent for multiple bindings, conflicting, ambiguous,
or unknown; `FORBIDDEN` means principal and selected binding are valid but
access/scopes are insufficient. `INVALID_REQUEST`, `CONTRACT_MISMATCH`,
`DEPENDENCY_UNAVAILABLE`, and `INTERNAL` retain the safe-message/retryability
rules declared in the architecture contract.

#### Scenario: Stable second page

- **GIVEN** more than 50 authorized matching records with tied `created_at`
- **WHEN** offsets 0 and 50 are requested
- **THEN** `id DESC` provides deterministic non-overlapping pages
- **AND** both results contain required `items` and `pagination`

### R5: Deterministic thin projections

MCP, CLI, OpenAPI, and native definitions **MUST** be generated or projected
from the canonical source. Every adapter **MUST** invoke the R2 application
service and **MUST NOT** validate principals/selectors, construct
`InvocationContextV1`, choose tenants, call the handler directly, or add
authorization, tenant fallback, functional, pagination, error, or trace
decisions.

#### Scenario: Different transports

- **GIVEN** Codex uses a native definition and another client uses MCP
- **WHEN** both invoke the same active id/version/hash
- **THEN** transport mechanics and envelopes may differ
- **AND** normalized semantics remain identical

### R6: Safe and comparable traces

The canonical schema **MUST** require `auth_state`, nullable `principal_ref`,
nullable `tenant_ref`, nullable `trace_key_epoch`, and
`authorization_decision`. `UNAUTHENTICATED` **MUST** use
`auth_state: unverified`, null refs, null epoch, and `not_evaluated`; rejected
evidence **MUST NOT** be hashed. With a verified principal but invalid tenant
context, only the HMAC-pseudonymous principal ref is present, `tenant_ref` is
null, and authorization remains `not_evaluated`. A tenant ref **MUST** be
created only after shared resolution; `FORBIDDEN` therefore has both refs,
`auth_state: verified`, and authorization `denied`, while success uses
authorization `allowed`.

Equivalent semantic fields **MUST** be capability id/version/hash, auth state,
outcome, authorization decision, nullable pseudonymous refs, effective
pagination, canonical error code, `result_summary`, and `provider_calls: 0`.
`result_summary` **MUST** contain only item count, `has_more`, and error presence.

Every non-null pseudonymous ref **MUST** have a non-null `trace_key_epoch`.
Strict ref equality **MUST** be asserted only when compared traces use the same
epoch. When epochs differ, the suite **MUST NOT** compare refs and **MUST** either
report explicit cross-epoch mode while comparing only other invariants, or
re-emit fixtures under a common epoch before strict ref comparison. The suite
**MUST NOT** silently omit `trace_key_epoch` from its parity preconditions.

`trace_id`, timestamp, `transport`, transport operation/status/request id, and
`trace_key_epoch` **MAY** differ subject to that explicit rule. Traces
**MUST NOT** contain credentials, raw tenant/subject ids, filters, record ids,
items, content, or metadata.

### R7: Projection and OpenAPI parity

Shared fixtures **MUST** verify MCP, CLI, Codex, and OpenCode normalized schema,
success, authorization, tenant, pagination, error, hash, and trace parity,
including the `trace_key_epoch` precondition and cross-epoch behavior.
OpenAPI tests **MUST** generate the 3.1 document in process, run a pinned
deterministic validator, resolve request/success/error and
`x-alfred-contract`, compare them to canonical DTOs/hash, and invoke the
generated operation mapping in process. A live server **MUST NOT** be the schema
or parity authority.

### R8: Rollout negotiation

Before activation, a projection **MUST** present exact `{id, version, hash}` to
the common service and pass contract/parity tests against the active registry.
There is no silent downgrade. Legacy projections **MAY** run only behind an
explicit compatibility allowlist, **MUST NOT** claim `memory.list/v1`, and
**MUST** migrate through later issues.

### R9: Issue #193 delivery boundary

Issue #193 **MUST** deliver only the reviewed architecture decision, SDD
specification, and follow-up plan. Executable manifests, services, handlers,
projections, and tests **MUST** be implemented through subsequent approved
issues. This issue **MUST** make zero LLM provider calls, preserve user-owned
model assignment and deny-by-default policy, and write no harness configuration.

## Follow-up implementation plan

The following work is planning output from #193. Each phase requires one or
more separately approved implementation issues before application code or
executable tests are changed.

### Review workload forecast

| Field | Value |
|---|---|
| Estimated changed lines | More than 400 across contract, handler, projections, and tests |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending human decision |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

### Follow-up 1: Characterize and contract

- [ ] 1.1 Open an approved implementation issue to characterize current `memory.list` success, authorization, tenant, pagination, error, and trace behavior as fixtures.
- [ ] 1.2 In that issue, place the canonical `memory.list/v1` payload in the capability-owning boundary and generate its non-self-referential wrapper/hash.
- [ ] 1.3 Add failing contract tests for R1-R9 before changing routing.

### Follow-up 2: Shared invocation semantics

- [ ] 2.1 Open an approved implementation issue for the shared principal validator, `InvocationContextV1` resolver, authorization gate, capability handler, and common application service.
- [ ] 2.2 Normalize DTOs and safe traces through that service with `provider_calls: 0`.

### Follow-up 3: Thin projections

- [ ] 3.1 Open approved vertical-slice issues for MCP, CLI, and in-process validated OpenAPI projections while preserving public envelopes.
- [ ] 3.2 Open approved issues for native Codex/OpenCode projections without harness-owned semantics.
- [ ] 3.3 Require exact id/version/hash activation against the canonical registry in every slice.

### Follow-up 4: Parity and rollout

- [ ] 4.1 In later issues, run shared fixtures through every transport and enforce normalized equivalence.
- [ ] 4.2 Gate Codex/OpenCode activation on DTO, outcome, error, pagination, authorization, tenant, trace, version, and hash parity.
- [ ] 4.3 Remove duplicated semantics only after each projection passes activation gates.
- [ ] 4.4 Select a chained-PR strategy before the first implementation issue and keep tests with each vertical slice.

## Issue #193 completion conditions

- [x] Architecture defines manifest, shared gate, handler, and one ordered application service without conflicting authority.
- [x] `VerifiedPrincipalV1`, `InvocationContextV1`, tenant precedence, concrete `memory.list/v1` DTOs, exclusive errors, offset pagination, stable ordering, safe preauthentication traces, and hash rules are specified.
- [x] Projection, OpenAPI in-process validation, Codex/OpenCode parity, rollout negotiation, and activation gates are unambiguous.
- [x] Follow-up work is planned but explicitly excluded from #193 implementation scope.
- [x] Markdown/whitespace checks are deterministic and report zero LLM provider calls.
- [x] No application code, live harness configuration, protected path, or user-owned model assignment is changed.

## Follow-up implementation exit criteria

- [ ] A later approved issue publishes the executable `memory.list/v1` contract and common application service.
- [ ] Later approved projection issues make MCP, CLI, OpenAPI, Codex, and OpenCode thin adapters.
- [ ] Executable contract and parity tests pass before each projection activates.
- [ ] Existing supported transports remain compatible throughout incremental migration.

## References

- Issue: https://github.com/GOI17/alfred/issues/193
- Architecture decision: `docs/architecture/010-unified-tool-contracts.md`
- Existing MCP direction: `.ai/execution/openai-mcp-plugin.md`
