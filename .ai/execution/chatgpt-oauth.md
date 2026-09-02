---
id: execution/chatgpt-oauth
description: Connect ChatGPT Actions directly to Alfred Memory with OAuth 2.0.
phase: issue-135-chatgpt-oauth
author: core
issue: 135
---

# ChatGPT OAuth

## Goal

Replace the local ChatGPT bridge with a direct OAuth 2.0 Authorization Code
connection to the public Alfred Memory API while preserving API-key access for
CLI and non-ChatGPT integrations.

## Decisions

1. The authorization screen is hosted by Alfred and asks the user for an
   existing Alfred API key. The key is validated by Alfred and is never sent to
   ChatGPT.
2. Authorization codes, access tokens, and refresh tokens are random opaque
   values. Only SHA-256 hashes are persisted.
3. Authorization codes are short-lived and single-use. Access tokens are
   short-lived. Refresh tokens rotate on every use and reuse is rejected.
4. Redirect URIs use exact allowlist matching. `state` is mandatory and is
   returned unchanged to ChatGPT.
5. `memory:read` and `memory:write` scopes are enforced per HTTP operation.
6. OAuth is deny-by-default and is enabled only when client ID, client secret,
   public HTTPS URL, and redirect allowlist are configured.
7. Existing API keys continue to authenticate API requests with full tenant
   permissions for backward compatibility.
8. Runtime trace events contain identifiers, outcome, and `provider_calls: 0`,
   but never codes, tokens, API keys, or client secrets.

## HTTP surface

- `GET /oauth/authorize`: validates the request and renders Alfred consent.
- `POST /oauth/authorize`: validates the API key and redirects with a one-time
  authorization code plus the original state.
- `POST /oauth/token`: exchanges an authorization code or rotated refresh token.
- `GET /openapi.yaml`: serves the canonical Custom GPT action schema.

## Configuration

- `ALFRED_OAUTH_CLIENT_ID`
- `ALFRED_OAUTH_CLIENT_SECRET`
- `ALFRED_OAUTH_REDIRECT_URIS` (comma-separated exact HTTPS URLs)
- `ALFRED_PUBLIC_URL`
- Optional TTL overrides for authorization, access, and refresh tokens.

## Acceptance criteria

- [x] Authorization Code flow succeeds with a valid tenant API key.
- [x] Invalid client, redirect, state, scope, code, and refresh reuse fail closed.
- [x] OAuth Bearer tokens resolve the correct tenant and enforce scopes.
- [x] Stored OAuth credentials are hashes, never raw secrets.
- [x] The production OpenAPI schema declares OAuth and the direct server URL.
- [x] User-facing setup no longer requires `bridge.mjs`.
- [x] API-key callers remain compatible.
- [x] Tests, validators, and runtime trace assertions pass.
- [x] Provider calls remain 0.

## Activation dependency

The runtime remains fail-closed with OAuth disabled until the operator creates
the Custom GPT, obtains its exact callback URLs, and sets all three
`ALFRED_OAUTH_*` values together. No redirect wildcard or placeholder secret is
enabled by this implementation.
