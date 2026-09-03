---
id: execution/recovery-redirect
description: Preserve and safely resume an Alfred OAuth flow after API-key recovery.
phase: issue-148-recovery-redirect
author: core
issue: 148
---

# Safe post-recovery continuation

## Goal

Return a user who starts API-key recovery from Alfred's OAuth consent flow to
that exact validated consent request, while direct recovery falls back to the
console and no caller can turn recovery into an open redirect.

## Context

The OAuth consent page currently has no recovery entry point, the console sends
only an email address when it requests recovery, and recovery consumption
returns a credential payload without continuation context. Issue #146 owns the
complete browser result-page presentation and landed first on `main`. This
change supplies the validated continuation contract to that page and adds only
the OAuth-success auto-return plus explicit fallback behavior.

## Requirements

### R1: Minimum continuation context

1. The OAuth consent page must link to the existing console recovery form with
   only the canonical authorization request fields: `response_type`,
   `client_id`, `redirect_uri`, `state`, and `scope`.
2. The console must submit that internal continuation path with the recovery
   request when it is present.
3. Direct recovery must not require continuation context.

### R2: Deny-by-default redirect policy

1. The only non-fallback continuation destination is the relative internal
   path `/oauth/authorize`.
2. The path must contain exactly one of each canonical authorization field and
   no unknown query fields or fragment.
3. The existing OAuth request validator must revalidate the client, exact
   callback allowlist, state, and scope before the path is accepted.
4. Absolute, protocol-relative, malformed, oversized, duplicated, unknown, or
   OAuth-invalid destinations must be rejected with `validation_error`.
5. Persisted continuation data must be revalidated when consumed. Missing or
   invalid persisted data must fail safely to `/console/`.

### R3: Server-side preservation

1. The canonical continuation path must be stored with the recovery record,
   not appended to the emailed recovery link.
2. Existing SQLite registries and Postgres deployments must gain the nullable
   continuation column through idempotent migration behavior.
3. The emailed link must continue to contain only the existing single-use
   recovery credential.

### R4: Continue contract and focused browser bridge

1. A successful consume response must provide `continue_url` and the label
   `Continue with Alfred` for clients that render the result.
2. OAuth-aware browser consumption must reuse the secure result page from issue
   #146, show the newly rotated key once, attempt return to the validated
   internal consent path, and include an explicit Continue link.
3. The result page must retain #146's no-store, no-referrer, no-sniff,
   nonce-based restrictive CSP, and framing-denial headers.
4. Machine clients and direct recovery must retain the existing JSON response,
   augmented only with the safe continuation fields.
5. Success/error presentation, copy controls, and response negotiation remain
   owned by the issue #146 implementation; this change only supplies the safe
   continuation action.

### R5: Trace and secret safety

1. Recovery request and consumption must emit best-effort runtime trace events
   containing only tenant identity, continuation kind, outcome, and
   `provider_calls: 0`.
2. Runtime and repository traces must not contain emails, API keys, recovery
   credentials, OAuth state, callback URLs, or continuation URLs.
3. API keys must never be placed in a URL, redirect header, trace, or log.

### R6: Verification

1. Deterministic tests must cover OAuth continuation, direct fallback,
   malformed and hostile destinations, duplicate/unknown fields, persisted
   data revalidation, cross-origin console query preservation, browser bridge
   headers, JSON compatibility, migrations, and trace redaction.
2. Relevant package tests, syntax checks, policy validation, and unprotected
   regression gates must pass.
3. Provider calls remain `0`.

## Completion conditions

- [x] OAuth recovery retains only a validated canonical consent request.
- [x] Direct recovery returns the safe `/console/` fallback.
- [x] External and malformed destinations cannot redirect a user.
- [x] The OAuth browser bridge auto-returns and offers Continue with Alfred.
- [x] Existing JSON clients remain compatible.
- [x] Existing registries migrate without losing recovery records.
- [x] Traces contain no credentials or continuation values.
- [x] Relevant tests, checks, and regression gates pass.
- [x] Provider calls remain `0`.

## References

- Issue: `#148`
- Coordinating presentation issue: `#146`
- Recovery spec: `.ai/execution/smtp-recovery.md`
- OAuth spec: `.ai/execution/chatgpt-oauth.md`
- Recovery service: `packages/memory-server/src/bootstrap/recovery.js`
- OAuth router: `packages/memory-server/src/oauth/oauth-router.js`
- Console router: `packages/memory-server/src/console-router.js`
- Console client: `packages/console-web/src/index.html`
