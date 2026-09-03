---
id: execution/publish-alfred-memory-gpt
description: Restore and publish the Alfred Memory Custom GPT with OAuth and a stable privacy policy.
phase: issue-162-publish-alfred-memory-gpt
author: core
issue: 162
---

# Publish Alfred Memory Custom GPT

## Goal

Replace the unavailable Alfred Memory Custom GPT with a working public GPT,
including direct OAuth access to Alfred Memory and a stable public privacy
policy.

## Context

The canonical GPT URL for `g-6a320e87e6908191a3f834b273221f99`
returns HTTP 404. The replacement GPT must preserve the versioned
configuration in `.ai/gpt/alfred-memory-gpt.json`, rotate the shared OAuth
secret without exposing it, and register the replacement Action callback URLs
exactly.

## Requirements

### R1: Public privacy policy

**Endpoint**: `GET /privacy`

**Behavior**:

1. Return a plain-language Alfred Memory privacy policy as UTF-8 HTML.
2. Explain the data processed, purposes, external service boundary, retention,
   deletion controls, security practices, and contact channel.
3. Require no API key or OAuth token.
4. Return restrictive content, framing, MIME-sniffing, and referrer headers.
5. Do not include secrets, credentials, analytics scripts, or third-party
   assets.

### R2: Canonical GPT configuration

1. Configure the replacement from `.ai/gpt/alfred-memory-gpt.json`.
2. Leave Knowledge empty.
3. Disable Web Search, Image Generation, and Code Interpreter.
4. Import the canonical production OpenAPI schema and verify all 10
   operationIds.
5. Use OAuth with the canonical client ID, endpoints, and scopes.

### R3: Secret-safe OAuth rotation

1. Generate a new OAuth client secret of at least 32 random characters.
2. Send it to the GPT editor through protected standard input.
3. Stage the same secret in Fly without printing, documenting, or committing
   it.
4. Register both exact callback host variants for the replacement Action.
5. Verify authorization rejects unregistered redirects and accepts the new
   callbacks.

### R4: Publication and repository references

1. Publish the replacement GPT for anyone with its link.
2. Verify the public URL no longer returns HTTP 404.
3. Replace stale GPT IDs and URLs in source, generated artifacts, tests, and
   canonical metadata.
4. Record the replacement callback ID separately from the public GPT ID.

### R5: Traceability and validation

1. Emit issue-scoped trace evidence with `provider_calls: 0`.
2. Run memory-server, ChatGPT adapter, OpenAPI, and relevant static-page
   validations.
3. Confirm the OAuth secret is absent from Git changes and command output.

## Completion Conditions

- [ ] `GET /privacy` returns HTTP 200 over production HTTPS.
- [ ] Privacy content and security-header tests pass.
- [ ] The Action exposes all 10 canonical operationIds.
- [ ] OAuth sign-in reaches Alfred's consent page using an exact callback.
- [ ] The replacement GPT is accessible to anyone with the link.
- [ ] All stale repository references are replaced.
- [ ] No secret appears in source control, screenshots, logs, or trace output.
- [ ] Relevant checks, tests, validators, and the linked PR pass.

## References

- GPT source of truth: `.ai/gpt/alfred-memory-gpt.json`
- OAuth design: `.ai/execution/chatgpt-oauth.md`
- Deployment guide: `.ai/docs/custom-gpt-deploy.md`
- OpenAPI schema: `packages/memory-openapi/openapi.yaml`
- Memory server router: `packages/memory-server/src/openapi-router.js`

