# Alfred Memory for ChatGPT Actions

ChatGPT connects directly to the public Alfred Memory API with OAuth 2.0. No
local bridge is required and the tenant API key is never stored in the GPT.

## Custom GPT configuration

Import the hosted schema:

```text
https://alfred-labs-memory.fly.dev/openapi.yaml
```

Choose **OAuth** and configure:

| Field | Value |
|---|---|
| Authorization URL | `https://alfred-labs-memory.fly.dev/oauth/authorize` |
| Token URL | `https://alfred-labs-memory.fly.dev/oauth/token` |
| Scope | `memory:read memory:write` |
| Client ID | The value of `ALFRED_OAUTH_CLIENT_ID` on the server |
| Client secret | The value of `ALFRED_OAUTH_CLIENT_SECRET` on the server |

After the Action is saved, copy both callback URLs displayed by ChatGPT into
the server's comma-separated `ALFRED_OAUTH_REDIRECT_URIS` allowlist. Redirect
URIs are matched exactly.

When a user chooses **Sign in**, Alfred asks for their existing `alk_...` API
key on Alfred's own consent page. Alfred validates it and issues scoped OAuth
tokens to ChatGPT. The API key itself never leaves Alfred.

The canonical schema lives at
`packages/memory-openapi/openapi.yaml`; `/openapi.yaml` serves it directly.

## Security properties

- Authorization Code flow with mandatory `state`.
- Five-minute, single-use authorization codes.
- One-hour access tokens.
- Rotating refresh tokens with family revocation on reuse.
- Exact redirect URI allowlist.
- Only SHA-256 credential hashes are stored.
- `memory:read` and `memory:write` are enforced per operation.
- Existing API-key authentication remains available to CLI and technical
  integrations.

## Tests

```bash
npm run chatgpt:check
npm run chatgpt:test
```
