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
cross-origin callback.

## Requirements

### R1: Permit only the validated callback origin

1. Build the consent page CSP only after `validateAuthorizationRequest` has
   accepted the request, including exact `redirect_uri` allowlist matching.
2. Keep `'self'` in `form-action` for the consent form POST.
3. Add only the serialized origin of the validated `redirect_uri` as an
   additional `form-action` source; do not include its path, query, or fragment.

### R2: Fail closed for invalid requests

1. Invalid or unvalidated authorization requests must retain the default
   `form-action 'self'` policy.
2. Do not add wildcards, arbitrary request origins, or a global ChatGPT host
   allowlist.
3. Preserve exact redirect validation in the OAuth service and all existing
   security headers.

### R3: Regression coverage

1. Verify that a valid consent response includes `'self'` and only the validated
   callback origin in `form-action`.
2. Verify that a rejected arbitrary callback origin is absent from the response
   CSP.
3. Keep the existing OAuth service and router test suite passing.

### R4: Local-first traceability

Record task classification, delegation, provider-request avoidance, and local
validation outcomes. Deterministic implementation and tests must keep provider
calls at zero.

## Completion Conditions

- [x] A valid ChatGPT callback can pass the consent page `form-action` policy.
- [x] Invalid redirect URIs remain rejected and are never reflected into CSP.
- [x] OAuth-focused tests pass.
- [x] Memory server type/syntax checks pass.
- [x] Required trace events report `provider_calls: 0`.

## References

- OAuth design: `.ai/execution/chatgpt-oauth.md`
- Plugin design: `.ai/execution/openai-mcp-plugin.md`
- OAuth router: `packages/memory-server/src/oauth/oauth-router.js`
- OAuth tests: `packages/memory-server/test/oauth.test.mjs`
