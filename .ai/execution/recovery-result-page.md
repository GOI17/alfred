---
id: execution/recovery-result-page
description: Replace browser-facing recovery JSON with a secure, accessible one-time result page.
owner: core
phase: issue-146-recovery-result-page
author: core
issue: 146
---

# Secure recovery result page

## Goal

Present API-key recovery results as an accessible, one-time browser page while
preserving a deliberate JSON contract for machine clients and preventing the
new key from entering caches, logs, URLs, traces, or unsafe markup.

## Context

`GET /console/api/recover?token=...` currently consumes a recovery token and
returns raw JSON. Issue #148 owns continuation-context and redirect policy.
This change provides only a same-origin `/console` fallback and does not
accept, retain, or interpret redirect targets.

## Requirements

### R1: Explicit response negotiation

1. A recovery GET returns HTML by default, including for absent or wildcard
   `Accept` headers used by ordinary browser navigation.
2. The existing JSON success shape remains available when the request
   explicitly accepts `application/json`.
3. JSON error status codes remain `400` for an invalid token and `410` for an
   expired token; an already-used token receives a distinct `410` response.
4. The Memory server README documents the negotiation rule and JSON shapes.

### R2: One-time result states

1. Success, expired, invalid, and already-used tokens render distinct pages.
2. Success shows the newly issued key in a read-only, non-autocompleting field,
   a deliberate Copy button, and warnings that the key is shown once and the
   previous key has been revoked.
3. Error pages explain that no new key was shown and offer a same-origin path
   back to the Alfred console to request a new recovery link.
4. The recovery service distinguishes invalid and already-used records without
   returning a previously issued key.

### R3: Secret-safe rendering and copy behavior

1. The API key is present only in the one-time response body and is never put
   in a URL, log, trace, storage API, or client persistence API.
2. All dynamic values are HTML-escaped before entering markup. Client status
   updates use `textContent`; the copy script reads only the field value.
3. The page does not load third-party assets or make network requests.
4. Clipboard failure leaves the key visible and gives an accessible manual-copy
   instruction without exposing it elsewhere.

### R4: Response security

1. Every recovery GET response, HTML or JSON, sends `Cache-Control: no-store`.
2. Responses send a restrictive nonce-based Content Security Policy with
   `default-src 'none'`, `base-uri 'none'`, `form-action 'none'`, and
   `frame-ancestors 'none'`.
3. Responses send `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and
   `X-Content-Type-Options: nosniff`.
4. HTML uses a standards-mode document, semantic landmarks, visible focus,
   associated labels, and an accessible live status for copy feedback.

### R5: Verification and traceability

1. Deterministic tests cover rendering, all four states, negotiation, escaping,
   copy semantics, and security headers.
2. Memory-server checks and tests pass, and the console regression gate meets
   its updated additive test-count baseline.
3. Generated trace events record direct execution and provider-request
   avoidance without any token, API key, email, or recovery URL.
4. Provider calls remain `0`.

## Completion conditions

- [x] Browser navigation never returns raw recovery JSON.
- [x] Success, expired, invalid, and already-used HTML states are covered.
- [x] Explicit JSON negotiation preserves the machine-client contract.
- [x] The one-time key field and copy interaction are accessible and secret-safe.
- [x] Recovery responses carry no-store, CSP, no-referrer, and framing protection.
- [x] Documentation, tests, checks, and regression gates pass.
- [x] Trace artifacts contain no recovery secrets and report `provider_calls: 0`.
- [x] Provider calls remain `0`.

## References

- Issue: `#146`
- Parent issue: `#145`
- Redirect-policy follow-up: `#148`
- Prior recovery spec: `.ai/execution/smtp-recovery.md`
- Recovery service: `packages/memory-server/src/bootstrap/recovery.js`
- HTTP router: `packages/memory-server/src/console-router.js`
- Router tests: `packages/memory-server/test/console.test.mjs`
- API documentation: `packages/memory-server/README.md`
