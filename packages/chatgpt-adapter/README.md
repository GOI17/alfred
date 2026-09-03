# Alfred Memory for ChatGPT Actions

ChatGPT connects directly to the public Alfred Memory API with OAuth 2.0. No
local bridge is required and the tenant API key is never stored in the GPT.

## Tenant users

Open the preconfigured
[Alfred GPT](https://chatgpt.com/g/g-6a320e87e6908191a3f834b273221f99-alfred),
ask for your memories, choose **Sign in**, and enter your `alk_...` key only on
Alfred's consent page. Do not open the GPT editor or fill in Client ID or Client
Secret; those fields are already configured inside the published Alfred GPT.

## Operator-only configuration for a different Custom GPT

This section does not apply to users of the published Alfred GPT. Use it only
when deliberately creating and hosting a separate GPT Action.

Import the hosted schema:

```text
https://alfred-labs-memory.fly.dev/openapi.yaml
```

Use the public privacy policy URL when publishing the GPT:

```text
https://alfred-labs-memory.fly.dev/privacy
```

Choose **OAuth** and configure:

| Field | Value |
|---|---|
| Authorization URL | `https://alfred-labs-memory.fly.dev/oauth/authorize` |
| Token URL | `https://alfred-labs-memory.fly.dev/oauth/token` |
| Scope | `memory:read memory:write` |
| Client ID | `alfred-chatgpt` for AlfredLabs production, or the exact value of `ALFRED_OAUTH_CLIENT_ID` on your server |
| Client secret | The exact private `ALFRED_OAUTH_CLIENT_SECRET` value on your server |

There is no public/default Client Secret. If the current value was not retained,
generate a new value of at least 32 characters and rotate the server and GPT
editor together. Never publish or commit it.

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
