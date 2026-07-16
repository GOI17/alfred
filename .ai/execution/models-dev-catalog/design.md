---
id: execution/models-dev-catalog/design
description: Opt-in, provider-specific models.dev browsing for Guided Pathfinder model assignment.
phase: phase-13-install-management
author: architect
issue: 98
---

# Design: models.dev Catalog Browser

## Approach and boundaries

Extend the existing `custom-models` editor; add no catalog concepts to core or harness adapters. `install-pathfinder.mjs` remains pure state/render logic. After its reducer emits a consented fetch intent, `install-app.mjs` invokes read-only `models-dev-catalog.mjs` and dispatches the result. `install.sh` retains discovery, validation, write, and apply authority; the catalog module cannot execute shell or write files.

The unversioned MIT catalog is metadata, not account/subscription entitlement. Identity is `(provider.id, model.id)`; no name, family, punctuation, or undocumented `base_model` inference may join providers.

## Consent and network contract

Opening **Browse models.dev** first shows a blocking consent overlay, defaulting to **Decline**, with:

- exact request: `GET https://models.dev/api.json` (host `models.dev`, path `/api.json`);
- purpose: download public model metadata for this private session;
- warning: **catalog-listed ≠ account-verified** and no subscription/access is tested.

Only an explicit **Allow once** action may invoke the adapter. Decline is reversible: the user may return to the manual editor and reopen consent until **Allow once** initiates the session's single request. After Allow once, consent is final for that session and no later consent decision is accepted. The adapter's injected interface is `fetchCatalog({ fetchImpl, clock, timeoutMs = 5000, maxBytes = 8 * 1024 * 1024 })`. It permits only HTTPS and exact origin/path, uses `redirect: "manual"`, accepts no redirect response, sends only an `Accept: application/json` header, uses no credentials, authorization, cookies, referrer, or ambient cookie jar, and performs no retry by default. It requires status 200, an `application/json` media type, a valid bounded `Content-Length` when present, a five-second abort, and streaming enforcement of the 8 MiB decoded-body limit. `response.url` must still equal the requested URL.

There is at most one fetch per session and its catalog stays in memory. A Decline returns to the unchanged manual editor and may be reconsidered; offline operation, timeout, malformed/oversized data, or network error also returns there with a concise reason. There is no persistent cache, ETag, or background refresh.

## Untrusted-data extraction

`extractCatalog(json)` accepts only a plain top-level provider map and extracts frozen records:

```text
ProviderRecord { id, label, models: ModelRecord[] }
ModelRecord    { id, label }
```

Limits are 512 providers, 4,096 models/provider, 12,000 models total, provider IDs 128 code points, model IDs 512, and labels 256—headroom over the verified 166/5,666 catalog. Provider IDs are lowercase safe identifiers without `/`; model IDs may contain provider-specific `/` and punctuation. Strings must be valid Unicode, non-empty, and free of controls, bidi controls, terminal sequences, and edge whitespace. Unsafe IDs are rejected, not rewritten; labels are terminal-sanitized and capped. Duplicate identities reject the response. Unknown fields are discarded. `api`, `doc`, `npm`, `env`, URL, pricing, and other metadata are never retained or executed.

## TUI state and assignment

The model editor adds keyboard-first overlays:

```text
consent → fetching → provider-search/select → model-search/select → target-select
                                                               ↘ manual editor
```

Search is local, literal, case-folded over IDs/labels, whitespace-preserving, stable-sorted, and paged; Space inserts query text and Backspace removes it normally. No regular expression interpretation is used. Targets are wildcard, orchestrator, developer, or **new fallback** (ordered-chain append). At 80x24 overlays reserve title, status, page, and help rows. Fullscreen may reuse mouse hit regions; inline is mouse-free. Escape backs up without changing the draft.

Selection writes `${provider.id}/${model.id}` into the existing custom draft and invalidates Review/inspection/approval like a manual edit. The UI separately displays provider-specific `model.id`. Thus `openrouter` plus `anthropic/claude-sonnet-4.6` stores `openrouter/anthropic/claude-sonnet-4.6`. Another provider requires selecting its record; manual exact-ID entry remains available.

Ephemeral assignment provenance is `catalog-listed`, `locally-detected`, or `manual`; it is shown beside draft fields but is not added to `models.json` or the digest-bound plan. `account-verified` is forbidden until a future authenticated adapter supplies that evidence.

## Trace, compatibility, and files

The shell creates a fixed mode-0600 private `catalog-events.jsonl`; the app may append only bounded events `catalog_consent_decided` and `catalog_fetch_completed`. The accepted grammar is zero to six `declined` decisions, optionally followed by exactly one `allowed` decision and then exactly one completion. Eight total events is the hard cap; the app may deduplicate repeated declines. Decline-only sessions aggregate as declined with no completion. An allowed session normally requires one completion with exactly one metadata request, including the regular `aborted` outcome after request start. The sole zero-request completion is `allowed → catalog_fetch_completed(outcome=aborted-before-request, catalog_metadata_requests=0)`, emitted when cancellation wins before the queued adapter starts `fetchImpl`; this preserves allowed consent without claiming a request occurred. The app and shell reject `aborted-before-request` with one request and every other completion outcome with zero requests. The shell validates event schema and records only consent (`allowed|declined`), outcome category, byte/count buckets, duration bucket, and `catalog_metadata_requests` (0 or 1)—never provider/model IDs, queries, paths, headers, or secrets. Provider inference calls remain `provider_calls: 0`; metadata requests are reported separately. Session JSONL is deleted with the existing private directory; an applied install copies only its aggregate into the install trace.

| File | Responsibility |
|---|---|
| `scripts/tui/models-dev-catalog.mjs` | Exact-origin fetch plus bounded validation/extraction; injected fetch/clock. |
| `scripts/tui/install-app.mjs` | Execute consented async fetch and append private trace events. |
| `scripts/tui/install-pathfinder.mjs` | Pure browser states, search/paging, provenance, target assignment, rendering. |
| `install.sh` | Create/validate trace path and stage the new module. |
| TUI/unit validator files | Fixture-only contract, reducer, 80x24, PTY, security, and fallback tests. |

Remote bootstrap copies the module from the same immutable commit snapshot as all staged TUI modules; partial/mixed staging fails closed. Existing IPC, plan digest, canonical validator, atomic write gate, playback, text fallback, and no-live-harness-write contracts remain unchanged.

Tests inject fetch and clock and cover consent denial, exact origin/redirects, timeout, status/type/length/stream limits, malformed and hostile fixtures, count/string caps, duplicate IDs, OpenRouter qualification, provider switching, provenance, revision invalidation, both layouts, and zero CI network. Review workload is high (about 600–900 changed lines): review in three slices—network/parser security, pure TUI behavior, then shell staging/tracing and fixture integration.
