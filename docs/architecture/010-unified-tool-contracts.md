# Unified Tool Contracts

## Decision

Alfred has one semantic implementation for each tool capability. MCP, CLI,
OpenAPI, and harness-native integrations are transports or projections over that
implementation; they are not separate authorities for behavior.

This decision unifies semantics, not transport. A harness may use MCP while
another uses a native tool or CLI process, provided both preserve the same
versioned capability contract.

The first migration slice is `memory.list/v1`.

## Contract model

| Term | Meaning |
|---|---|
| Capability contract | Portable, versioned declaration of input, output, authorization, tenant, pagination, error, and trace semantics. |
| Shared policy gate | Shared authentication, authorization, and tenant-isolation enforcement. |
| Capability handler | Implementation of functional capability semantics such as filtering, ordering, and pagination. |
| Capability application service | The single invocation authority that orders gate → handler → trace. |
| Transport projection | Deterministic MCP, CLI, OpenAPI, or native representation derived from the capability contract. |
| Thin adapter | Protocol parsing and envelope mapping that invokes the application service without making semantic decisions. |
| Contract identity | Stable capability id plus version and deterministic content hash. |

The canonical contract is a transport-neutral manifest with schemas expressed
in a portable JSON Schema 2020-12 subset. It contains no MCP, CLI, OpenAPI, or
harness-only business rules. Projections may add protocol metadata but must not
change the contract's semantics.

The payload uses `id: "memory.list"` and `version: "v1"`; their combined
capability identity is `memory.list/v1`.

The published artifact wraps a `contract` payload and a derived
`contract_hash`. The hash is `sha256:<lowercase-hex>` over the RFC 8785
canonical JSON serialization of `contract` only. The derived `contract_hash`,
timestamps, generated paths, signatures, and environment data are excluded, so
the digest is not self-referential. Any incompatible payload change requires a
new capability version such as `memory.list/v2`. Different hashes for the same
version never pass parity or activation; compatible same-version corrections
therefore require every projection to regenerate and activate together.

## Invocation path

```text
transport request
      |
      v
thin adapter: extract credential/selector evidence + map request DTO
      |
      v
capability application service (single invocation authority)
      |
      +-> shared principal validation
      +-> shared InvocationContextV1 tenant resolution
      +-> shared authorization gate
      +-> memory.list/v1 capability handler
      +-> shared trace recorder
      |
      v
normalized result or canonical error -> transport envelope
```

The manifest declares required behavior. Shared infrastructure validates the
principal, resolves one tenant into `InvocationContextV1`, and applies the
authorization gate. The capability handler implements functional listing
semantics. One common application service is the only component allowed to
order context construction, gate, handler, and trace recording. Adapters may
translate envelopes and protocol status values; they never decide identity,
tenant selection, authorization, filtering, ordering, pagination, errors, or
trace outcomes.

## Verified principal contract

An adapter extracts opaque credential or harness identity evidence and passes it
to the shared principal validator. It cannot construct or mark a principal as
trusted. Only successful shared validation creates the opaque
`VerifiedPrincipalV1` value used by the application service.

Minimum fields:

| Field | Type | Rule |
|---|---|---|
| `schema_version` | string | Required constant `verified-principal/v1`. |
| `issuer` | string | Required registered issuer id; unregistered issuers fail closed. |
| `provenance` | enum | Required: `oauth`, `api_key`, `local_harness`, or another contract-registered method. |
| `subject` | string | Required stable pseudonymous subject, never a raw credential or email. |
| `tenant_bindings` | array | Required, non-empty entries of `{tenant_id, access, scopes}`. |
| `issued_at` | RFC 3339 string | Required validation/issuance time. |
| `expires_at` | RFC 3339 string or null | Required; null is allowed only for a registered non-expiring provenance. |
| `validator_id` | string | Required shared validator and version that produced the opaque value. |

Each binding requires opaque internal `tenant_id`, `access` (`owner` or
`reader`), and unique scope strings. Shared validation checks credential proof,
issuer, audience/resource, expiry, revocation, stable subject derivation,
bindings, and scopes. Missing or unverifiable evidence, duplicate/ambiguous
bindings, unsupported provenance, or a tenant/scope mismatch fails closed before
the handler runs. Credentials and raw validation evidence are never serialized
into the principal, response, or trace.

## Invocation tenant context

Shared infrastructure, never adapter logic, constructs opaque
`InvocationContextV1` after principal validation and before authorization. Its
required fields are:

| Field | Type | Rule |
|---|---|---|
| `schema_version` | string | Constant `invocation-context/v1`. |
| `principal` | `VerifiedPrincipalV1` | Successfully validated opaque principal. |
| `tenant_binding` | object | Exactly one binding copied from that principal. |
| `selector_source` | enum | `credential_bound`, `explicit_authenticated`, `shared_configuration`, or `single_binding`. |
| `auth_state` | string | Constant `verified`; authorization is evaluated separately. |

Tenant selector evidence is transport-adjacent context, not part of the
functional `MemoryListRequestV1`. The adapter may extract opaque selector
evidence, but a shared selector validator must authenticate it or load it from
trusted shared configuration before the resolver can use it.

The common precedence is:

1. a tenant selector cryptographically bound to validated credential evidence;
2. an explicit invocation selector authenticated by shared infrastructure;
3. a selector from shared runtime/workspace configuration;
4. automatic selection only when `VerifiedPrincipalV1` has exactly one binding.

Higher precedence does not hide conflict: if two available trusted selectors
disagree, resolution fails with `TENANT_CONTEXT_INVALID`. A selector not present
in the principal's bindings also fails with `TENANT_CONTEXT_INVALID`. With no
trusted selector, zero bindings fail principal validation; one binding uses the
intentional common `single_binding` rule; multiple bindings fail as ambiguous.
No adapter or transport may add a fallback, choose the first binding, or apply a
different precedence.

`UNAUTHENTICATED` is exclusive to absent or invalid principal evidence.
`TENANT_CONTEXT_INVALID` requires a valid principal but an absent, ambiguous,
conflicting, or unknown tenant selector. `FORBIDDEN` requires a valid principal
and successfully selected binding but insufficient access or scopes.

## `memory.list/v1` DTOs

All DTOs are JSON objects with `additionalProperties: false`.

### Request

No property is required. Omitted filters mean “all visible records in the
tenant already selected by `InvocationContextV1`.” Tenant selection is not a
request property; a transport-supplied tenant field cannot become a functional
filter and is rejected unless its adapter extracts it as separately validated
selector evidence.

| Property | Type | Rule |
|---|---|---|
| `namespace` | string | Optional, non-empty exact-match filter. |
| `type` | string | Optional enum: `preference`, `fact`, `decision`, `workflow`, `project`, `correction`, `source`. |
| `project_id` | string | Optional, non-empty exact-match filter. |
| `tag` | string | Optional, non-empty membership filter. |
| `limit` | integer | Optional; default `50`, minimum `1`, maximum `100`. |
| `offset` | integer | Optional; default `0`, minimum `0`. |

Records are ordered by `created_at DESC`, then `id DESC` as the deterministic
tie-breaker. Filtering is applied before ordering, counting, and offset slicing.

### Result

The top-level result requires both properties:

| Property | Type | Rule |
|---|---|---|
| `items` | array of `MemoryItemV1` | Required; may be empty. |
| `pagination` | object | Required shape defined below. |

Every `MemoryItemV1` property below is required, including nullable properties:

| Property | Type | Rule |
|---|---|---|
| `id` | string | Non-empty stable record id. |
| `namespace` | string | Non-empty namespace. |
| `type` | string | Same enum as the request filter. |
| `content` | string | Memory content; never copied to traces. |
| `tags` | array of strings | Unique non-empty values. |
| `source` | string | Non-empty source identifier. |
| `project_id` | string or null | Non-empty when present. |
| `metadata` | object or null | JSON object when present. |
| `confidence` | number or null | Inclusive range `0..1` when present. |
| `expires_at` | RFC 3339 string or null | Expiration when present. |
| `created_at` | RFC 3339 string | Creation time. |
| `updated_at` | RFC 3339 string | Last update time. |

Tenant ids are not returned.

Required `pagination` properties are:

| Property | Type | Rule |
|---|---|---|
| `limit` | integer | Effective validated limit. |
| `offset` | integer | Effective validated offset. |
| `returned` | integer | Exactly `items.length`. |
| `total` | integer | Count after authorization and filtering, before pagination. |
| `has_more` | boolean | `offset + returned < total`. |
| `next_offset` | integer or null | `offset + returned` when `has_more`; otherwise null. |

Each request observes the storage snapshot available during that execution.
There is no cross-request snapshot guarantee: inserts or deletes between page
requests may shift later offsets and totals. Version 1 issues no cursor. Parity
fixtures use an unchanged dataset.

### Error

The required error DTO has exactly two top-level properties:

| Property | Type | Required shape |
|---|---|---|
| `error` | object | Required `code:string`, `message:string`, and `retryable:boolean`. |
| `contract` | object | Required `id:"memory.list"`, `version:"v1"`, and active `hash:string`. |

`message` is non-empty and safe and contains no credential, tenant, query, or
record content. `code` is one of the catalog below.

| Code | Meaning | Retryable |
|---|---|---|
| `INVALID_REQUEST` | Unknown field, invalid enum/type, empty filter, or limit/offset outside bounds. | false |
| `UNAUTHENTICATED` | Principal evidence is absent or cannot produce `VerifiedPrincipalV1`. | false |
| `TENANT_CONTEXT_INVALID` | Principal is valid, but selector evidence is absent for multiple bindings, conflicting, unknown, or otherwise ambiguous. | false |
| `FORBIDDEN` | Principal and selected tenant binding are valid, but required access or scopes are insufficient. | false |
| `CONTRACT_MISMATCH` | Requested or projected version/hash is not active. | false |
| `DEPENDENCY_UNAVAILABLE` | Required storage dependency is temporarily unavailable. | true |
| `INTERNAL` | Safe fallback for an unclassified failure. | false |

## `memory.list/v1` invariants

| Concern | Required invariant |
|---|---|
| Authorization | The application service invokes the same deny-by-default shared policy gate. A transport cannot bypass or widen it. |
| Tenant | Shared infrastructure resolves exactly one binding into `InvocationContextV1` using the common precedence. Missing, ambiguous, conflicting, or unknown context fails closed without transport fallback. |
| Pagination | Canonical offset DTO, defaults, bounds, stable ordering, total, and next-offset semantics are identical. |
| Errors | The contract owns stable error codes, safe messages, retryability, and disclosure rules. Protocol envelopes may differ, but the canonical code must survive projection. |
| Tracing | The application service records safe common fields after gate/handler outcomes; adapters supply transport context only. |
| Privacy | Credentials, memory content, and raw tenant secrets never appear in schemas, errors, hashes, or traces. |

## Projection rules

The canonical source deterministically generates or projects:

- MCP tool input/output schemas and annotations;
- CLI arguments plus machine-readable result and error shapes;
- OpenAPI 3.1 operations and components;
- harness-native tool definitions for Codex, OpenCode, and later harnesses.

Generation may happen at build time or runtime. Generated artifacts must expose
the contract id, version, and hash where the transport supports metadata;
otherwise that identity must be available through companion metadata and trace
events. Hand-maintained transport schemas cannot become competing sources of
truth.

Thin adapters may:

1. extract opaque credential, identity, or tenant-selector evidence for shared validation;
2. parse protocol-specific input into the canonical request DTO;
3. invoke the common capability application service;
4. map normalized output or errors into the protocol envelope;
5. supply protocol status and operation metadata to the shared trace recorder.

They may not self-validate a principal or selector, construct
`InvocationContextV1`, choose a tenant, or add authentication policy, tenant
fallback, filtering, pagination rules, error policy, capability authorization,
or trace-result classification.

## Hash publication, negotiation, and activation

The canonical contract registry publishes the wrapper
`{contract, contract_hash}` and is authoritative. Projections publish the exact
identity in MCP tool metadata, CLI machine-readable metadata, OpenAPI
`x-alfred-contract`, and native companion metadata for Codex/OpenCode. Every
attempt repeats it in the trace.

During rollout, an adapter presents its supported `{id, version, hash}` to the
application service. Activation succeeds only when it exactly matches the
active registry entry and its contract/parity tests pass. The service never
silently downgrades. Same-version/different-hash projections fail with
`CONTRACT_MISMATCH` and remain inactive. Legacy projections without contract
identity may run only behind an explicit compatibility allowlist, cannot claim
`memory.list/v1`, and must be removed from that mode by a follow-up migration.

## Trace equivalence and privacy

The canonical trace schema always requires nullable `principal_ref`,
`tenant_ref`, and `trace_key_epoch`, plus `auth_state` (`unverified` or
`verified`) and `authorization_decision` (`not_evaluated`, `denied`, or
`allowed`). This fixed shape makes preauthentication failures comparable across
transports.

For `UNAUTHENTICATED`, `auth_state` is `unverified`, both refs and
`trace_key_epoch` are null, and authorization is `not_evaluated`. Rejected
credential or selector evidence is never hashed into a ref. After principal
validation, `principal_ref` may be created. `TENANT_CONTEXT_INVALID` has that
principal ref, `auth_state: verified`, null `tenant_ref`, and authorization
`not_evaluated`.
Only after successful tenant resolution may `tenant_ref` be created.
`FORBIDDEN` therefore has both refs, `auth_state: verified`, and authorization
`denied`; successful execution has both refs and authorization `allowed`.

Equivalent semantic fields compared for parity are capability id/version/hash,
`auth_state`, outcome, authorization decision, nullable pseudonymous refs,
effective pagination, `result_summary`, canonical error code, and
`provider_calls: 0`. On success, `result_summary` is
`{item_count: returned, has_more, error: false}`; on failure it is
`{item_count: 0, has_more: false, error: true}`. It never contains items, ids,
content, filter values, or credentials.

Non-null principal and tenant refs are `HMAC-SHA-256` values produced only after
verification/resolution, using an operator-held trace key over the internal
subject or tenant id. Every non-null ref requires a non-null `trace_key_epoch`.
Refs are stable only within that epoch and are not globally linkable. The epoch
identifier is safe metadata and never contains or reveals the secret key.

Strict equality of `principal_ref` or `tenant_ref` is valid only when both traces
declare the same non-null `trace_key_epoch`. The parity suite must evaluate and
report this precondition. If epochs differ, it must not compare either ref; it
must either compare only the remaining invariant fields while explicitly
reporting cross-epoch mode, or re-emit the fixtures under one common epoch and
then perform strict ref comparison. `trace_key_epoch` may never be silently
dropped from the parity decision.

Permitted invocation-specific fields are `trace_id` and timestamp. Permitted
transport-specific fields are `transport`, `transport_operation`,
`protocol_status`, and transport request id. Their values may differ and are
excluded from normalized parity. `trace_key_epoch` may differ but remains an
explicit parity precondition under the rule above; all other common semantic
fields must match.

## Contractual parity

One transport-neutral fixture suite exercises the contract, authorization,
tenant isolation, pagination boundaries, errors, and traces. Projection tests
then run the same fixtures through MCP, CLI, OpenAPI, and native adapters.

Codex and OpenCode parity is required for `memory.list/v1`: their projected
schemas must identify the same contract version/hash, and equivalent requests
must produce equivalent normalized results or canonical errors. Their native
envelopes and invocation mechanics may differ.

OpenAPI parity is checked without ambiguity about a deployed server: tests
generate the OpenAPI 3.1 document in process from the canonical manifest, run a
pinned deterministic structural validator, resolve the operation's request,
success, error, and `x-alfred-contract` components, and compare them with the
canonical DTOs and hash. Fixtures invoke the generated operation mapping and
application service in process. A live HTTP server test may be added later, but
it is not the schema or parity authority.

Schema generation, hashing, projection, fixtures, and parity checks are local
deterministic work and must report `provider_calls: 0`.

## Incremental migration

1. Characterize existing `memory.list` behavior with shared fixtures.
2. Publish the canonical `memory.list/v1` manifest and deterministic hash.
3. Route shared principal validation, `InvocationContextV1` resolution,
   authorization, the capability handler, and trace recording through one
   common application service.
4. Move MCP, CLI, OpenAPI, Codex, and OpenCode to thin projections one at a
   time, preserving existing external transport compatibility.
5. Require contract and parity tests before each projection becomes authoritative.
6. Remove duplicated semantics only after all supported projections pass the
   compatibility gate.
7. Repeat by capability; do not require a flag-day migration.

During migration, old and new transports may coexist. They may not silently
claim the same contract version/hash if their observable semantics differ.

Issue #193 ends after this decision, specification, and follow-up plan are
reviewed and deterministically validated. Executable contracts, handlers,
projections, and parity tests belong to later implementation issues.

## Consequences and boundaries

- Fixes to shared semantics propagate to every projection after regeneration.
- Transport-specific innovation remains possible without semantic forks.
- Version/hash drift and adapter-owned business logic become test failures.
- Existing transport endpoints and harness setup are not changed by this
  documentation decision.
- Model assignment remains user-owned at runtime.
- No LLM provider request is needed to implement or validate contracts.
- Harness configuration writes remain previewed and approval-gated; #193 writes
  none.

## References

- Issue: [#193](https://github.com/GOI17/alfred/issues/193)
- SDD plan: `.ai/execution/unified-tool-contracts.md`
- Hexagonal architecture: `docs/architecture/002-hexagonal-architecture.md`
- Harness portability: `docs/architecture/009-harness-portability.md`
- Security model: `docs/architecture/006-security-model.md`
- Traceability: `docs/architecture/007-observability-traceability.md`
