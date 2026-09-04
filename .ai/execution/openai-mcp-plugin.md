---
id: execution/openai-mcp-plugin
description: Publish Alfred Memory through the OpenAI Plugins Directory using remote MCP.
phase: issue-167-openai-mcp-plugin
author: core
issue: 167
---

# OpenAI MCP Plugin

## Goal

Make Alfred Memory publicly discoverable in the OpenAI universal Plugins
Directory for ChatGPT and Codex. Preserve the owner-only Custom GPT and its
Action integration as a compatibility path while the plugin is built,
reviewed, and published.

## Context

The ChatGPT share dialog reports that public GPT sharing is unavailable for the
current account. OpenAI's current public submission flow accepts plugins made
from MCP servers, skills, or both. Alfred already provides a public HTTPS Memory
API, an OAuth Authorization Code implementation, and a local stdio MCP adapter,
but it does not yet provide the remote MCP or OAuth 2.1 contracts required for
plugin review.

## Decisions

1. Reuse `packages/memory-mcp` tool definitions for both stdio and remote
   transports; do not duplicate memory behavior in the HTTP adapter.
2. Add the remote transport at `POST /mcp` in `packages/memory-server` and use
   stateless Streamable HTTP so Fly instances do not hold connector sessions.
3. Require OAuth for the entire remote MCP endpoint. Resolve every access token
   to one tenant before creating the request-scoped memory adapter.
4. Keep the current Custom GPT OAuth client working. MCP additions are additive:
   protected-resource metadata, authorization-server metadata, PKCE S256,
   resource propagation, and resource-bound access tokens.
5. Treat search and list as read-only. Treat create and update as private,
   reversible writes. Treat delete as a destructive private write. None of the
   memory tools changes public internet state.
6. Keep the domain-verification token in deployment secrets and return only the
   configured value from the well-known challenge route.
7. Ship tools without custom UI for the first review. Alfred's workflows do not
   require an embedded component.
8. Provider calls remain zero; implementation, validation, and review fixtures
   are deterministic.
9. Publish under the AlfredLabs identity. Product email addresses follow
   `product.action@alfredlabs.org`; the public support contact is
   `alfred.support@alfredlabs.org`.

## Requirements

### R1: Remote MCP transport

- Expose a stable Streamable HTTP endpoint at `/mcp`.
- Accept MCP `POST` requests and return protocol-shaped method errors for
  unsupported `GET` and `DELETE` requests.
- Create and close stateless transports per request.
- Emit trace events for initialization failures and tool-call outcomes without
  logging credentials or memory content.

### R2: Tenant authorization

- Require an OAuth Bearer token for `/mcp`.
- Resolve the token to exactly one tenant and enforce its scopes server-side.
- Return HTTP 401 plus a Bearer `WWW-Authenticate` resource-metadata challenge
  for missing, invalid, expired, or incorrectly bound tokens.
- Do not accept Alfred API keys as remote MCP OAuth access tokens.

### R3: MCP OAuth 2.1 compatibility

- Publish `/.well-known/oauth-protected-resource` for the MCP resource.
- Publish `/.well-known/oauth-authorization-server` for Alfred's issuer.
- Require PKCE S256 for MCP authorization codes.
- Preserve the requested `resource` through authorization and token exchange,
  then bind issued access and refresh tokens to that resource.
- Preserve the legacy confidential client flow used by the Custom GPT Action.
- Document the exact plugin redirect URI after the Platform portal assigns it.

### R4: Tool metadata

- Add output schemas and explicit `securitySchemes` to all five MCP tools.
- Set `readOnlyHint`, `openWorldHint`, and `destructiveHint` according to actual
  side effects.
- Keep tool names and inputs backward compatible with local MCP clients.

### R5: Public listing and verification

- Expose `/.well-known/openai-apps-challenge` from a secret-backed setting.
- Publish stable website, support, privacy, and terms URLs.
- Prepare a review packet with starter prompts, five positive tests, three
  negative tests, availability, release notes, and policy attestations.
- Never commit reviewer credentials, client secrets, tokens, or the domain
  verification challenge.

### R6: Validation and rollout

- Add unit and contract coverage for annotations, transport behavior, OAuth
  metadata, PKCE, resource binding, scope enforcement, and tenant isolation.
- Run the existing Memory API, Custom GPT OAuth, local MCP, and release gates.
- Validate the deployed endpoint with MCP Inspector and ChatGPT developer mode.
- Submit only after the publisher identity is verified in Platform and the
  reviewer tenant is reproducible without MFA, email, or private networking.

## Completion conditions

- [ ] Issue 167 implementation and documentation are merged.
- [ ] Production `/mcp` passes MCP Inspector with all five tools.
- [ ] OAuth linking succeeds from ChatGPT and Codex without weakening tenant
      isolation or the existing Action client.
- [ ] Domain verification and all listing URLs return HTTP 200 publicly.
- [ ] Five positive and three negative reviewer cases pass.
- [ ] OpenAI accepts the submission and the publisher releases Alfred Memory in
      the Plugins Directory.

## Publisher decision

The human selected AlfredLabs as the publisher identity. The public website,
support page, privacy policy, terms, and OpenAI Platform verification must all
use that identity. Cloudflare Email Routing forwards the active
`alfred.support@alfredlabs.org` address to a verified private destination.

## References

- OpenAI MCP server guide: https://developers.openai.com/plugins/build/mcp-server
- OpenAI authentication guide: https://developers.openai.com/plugins/build/auth
- OpenAI submission guide: https://developers.openai.com/plugins/deploy/submission
- Existing MCP adapter: `packages/memory-mcp`
- Existing OAuth design: `.ai/execution/chatgpt-oauth.md`
