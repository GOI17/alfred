---
id: execution/oauth-form-action-csp
description: Allow validated OAuth callbacks through the consent page form-action CSP without broadening redirect trust.
phase: issue-187-oauth-form-action-csp
owner: core
issue: 187
---

# OAuth Form Action CSP

## Goal

Let Chrome complete the OAuth authorization redirect from Alfred Memory to the
OpenAI callback while preserving exact redirect allowlisting and a
deny-by-default Content Security Policy.

## Context

The consent page posts to Alfred at `/oauth/authorize`. After successful
authorization, that endpoint returns a `302` to the configured ChatGPT callback.
Chrome applies the consent page `form-action` directive to the redirect target,
so the existing `form-action 'self'` policy blocks the already validated
cross-origin callback. Production verification of the first correction showed
that the `chatgpt.com` callback then uses an official OpenAI relay to
`platform.openai.com`; Chrome applies the original form policy across that
continuation as well.

## Requirements

### R1: Permit only the validated callback origin

1. Build the consent page CSP only after `validateAuthorizationRequest` has
   accepted the request, including exact `redirect_uri` allowlist matching.
2. Keep `'self'` in `form-action` for the consent form POST.
3. Add only the serialized origin of the validated `redirect_uri` as an
   additional `form-action` source; do not include its path, query, or fragment.
4. When—and only when—the validated callback origin is exactly
   `https://chatgpt.com`, also allow the fixed official relay origin
   `https://platform.openai.com`.

### R2: Fail closed for invalid requests

1. Invalid or unvalidated authorization requests must retain the default
   `form-action 'self'` policy.
2. Do not add wildcards, arbitrary request origins, or a global ChatGPT host
   allowlist.
3. Treat OAuth `state` as opaque; do not parse it or derive CSP sources from it.
4. Other validated callback origins must not gain the OpenAI Platform relay.
5. Preserve exact redirect validation in the OAuth service and all existing
   security headers.

### R3: Regression coverage

1. Verify that a valid consent response includes `'self'` and only the validated
   callback origin in `form-action`.
2. Verify that a rejected arbitrary callback origin is absent from the response
   CSP.
3. Verify that the fixed platform relay appears only for a validated
   `chatgpt.com` callback and cannot be influenced through `state`.
4. Verify that an unregistered `platform.openai.com` callback is rejected and
   a separately allowlisted `chatgpt.com` lookalike does not activate the relay.
5. Keep the existing OAuth service and router test suite passing.

### R4: Local-first traceability

Record task classification, delegation, provider-request avoidance, and local
validation outcomes. Deterministic implementation and tests must keep provider
calls at zero.

## Completion Conditions

- [x] A valid ChatGPT callback can pass the consent page `form-action` policy.
- [x] The fixed official OpenAI Platform relay is limited to validated
      `chatgpt.com` callbacks.
- [x] Opaque `state` values cannot add CSP destinations.
- [x] Invalid redirect URIs remain rejected and are never reflected into CSP.
- [x] OAuth-focused tests pass.
- [x] Memory server type/syntax checks pass.
- [x] Required trace events report `provider_calls: 0`.

## References

- OAuth design: `.ai/execution/chatgpt-oauth.md`
- Plugin design: `.ai/execution/openai-mcp-plugin.md`
- OAuth router: `packages/memory-server/src/oauth/oauth-router.js`
- OAuth tests: `packages/memory-server/test/oauth.test.mjs`
