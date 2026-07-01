# Deploying the Alfred Memory Custom GPT

The Custom GPT is the user-facing entry point to Alfred Memory for people who
do not want to touch a terminal. This document walks you from "I have a fresh
Alfred Memory instance" to "the GPT is in the GPT Store".

The full GPT configuration is versioned at
[`.ai/gpt/alfred-memory-gpt.json`](../gpt/alfred-memory-gpt.json). It is the
single source of truth for name, description, system prompt, and action
metadata. The OpenAPI schema is at
[`packages/memory-openapi/openapi.yaml`](../../packages/memory-openapi/openapi.yaml).

## 1. Host Alfred Memory

The Custom GPT calls your backend over HTTPS. You need a domain with a valid
TLS cert (Let's Encrypt is fine). Three deployment shapes that work:

| Shape | Cost | Notes |
|---|---|---|
| Fly.io (`fly deploy`) | low | 1-click Postgres or use a managed Postgres URL. |
| Railway | low | Postgres plugin. |
| A VPS (Hetzner, DigitalOcean) | low | systemd unit + Caddy for TLS. |
| Vercel/Netlify for the console + separate API host | low | Set `ALFRED_CONSOLE_URL` to the static host. |

Minimum required env vars:

```sh
ALFRED_MEMORY_HOSTING=self-hosted
ALFRED_MEMORY_BIND=0.0.0.0
ALFRED_MEMORY_PORT=443
ALFRED_MEMORY_TLS_CERT=/etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem
ALFRED_MEMORY_TLS_KEY=/etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem
ALFRED_MEMORY_ALLOWED_ORIGINS=https://chat.openai.com,https://chatgpt.com
ALFRED_SAAS_DATABASE_URL=postgres://alfred:pwd@db.internal/alfred_saas   # for /console/api/bootstrap
ALFRED_SMTP_HOST=smtp.example.com                                          # optional
ALFRED_SMTP_PORT=587
ALFRED_SMTP_USER=alfred
ALFRED_SMTP_PASSWORD=...
ALFRED_SMTP_FROM=alfred@YOUR_DOMAIN
ALFRED_TURNSTILE_SITE_KEY=...                                             # optional
ALFRED_TURNSTILE_SECRET_KEY=...
ALFRED_PUBLIC_URL=https://YOUR_DOMAIN
```

`ALFRED_MEMORY_ALLOWED_ORIGINS` must include the ChatGPT origins for the
browser-based GPT UI to be allowed to call your server.

Verify the server is up:

```sh
curl https://YOUR_DOMAIN/health
# {"status":"ok","version":"0.4.1","mode":"openapi"}
```

## 2. Serve the OpenAPI document

The GPT fetches the OpenAPI schema from a public URL. The cleanest path is to
add a static file route. The simplest implementation is to copy
`packages/memory-openapi/openapi.yaml` to your web root and let your reverse
proxy serve it:

```nginx
# /etc/nginx/sites-enabled/alfred
server {
  listen 443 ssl;
  server_name YOUR_DOMAIN;

  ssl_certificate     /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;

  location = /openapi.yaml {
    root /opt/alfred/console/dist;     # copy openapi.yaml here
    add_header Content-Type application/yaml;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

Verify:

```sh
curl -I https://YOUR_DOMAIN/openapi.yaml
# 200 OK, content-type: application/yaml
```

## 3. Create the Custom GPT

In ChatGPT:

1. Go to `https://chatgpt.com/gpts/editor` (or `chat.openai.com → Explore →
   Create`).
2. **Configure** tab:
   - Name: `Alfred Memory`
   - Description: copy from
     [`.ai/gpt/alfred-memory-gpt.json`](../gpt/alfred-memory-gpt.json) →
     `description`.
   - Instructions: copy `system_prompt` verbatim.
   - Conversation starters: copy the `conversation_starters` array.
   - Knowledge: leave empty.
   - Capabilities: **disable** Web Browsing, DALL·E, and Code Interpreter.
3. **Actions** tab:
   - **Create new action**.
   - Schema: paste the full contents of
     `packages/memory-openapi/openapi.yaml`, OR set "Authentication" to
     "None" and the "URL" field to `https://YOUR_DOMAIN/openapi.yaml` (ChatGPT
     will fetch it).
   - Authentication:
     - Type: **API Key**
     - Auth Type: **Bearer**
     - (Or, if ChatGPT does not let you use Bearer, use **Custom** with
       header name `Authorization` and value template `Bearer {{alfred_api_key}}`.)
   - Click **Test** and verify the schema loads with all 10 operationIds:
     `healthCheck, listAgents, listSkills, checkPolicy, searchMemoriesV2,
     searchMemories, listMemories, createMemory, updateMemory, deleteMemory`.
4. Save the GPT. Test it with the conversation starters.

## 4. Publish to the GPT Store

1. In the GPT editor, click **Publish** (top right).
2. Fill in:
   - **Category**: Productivity
   - **Tags**: memory, second-brain, knowledge-base, self-hosted, alfred
   - **Who can use this?**: Everyone (or "Anyone with a link" if you want
     to skip the public Store listing).
3. OpenAI review usually takes 1-3 days. Expect to be asked to:
   - Verify the GPT is not impersonating a person or a brand.
   - Confirm the action's authentication is clear and safe.
   - Confirm the system prompt does not request disallowed content.
4. After approval, the GPT is in the Store under "Productivity".

## 5. Rotation & secrets

The GPT's API key is stored in ChatGPT's GPT configuration. If the user
suspects the key leaked:

```sh
# User-side: open https://YOUR_DOMAIN/console, click "Rotate my key".
# This revokes the old key and issues a new alk_ key via email.
# Then update the GPT's auth in the GPT editor.
```

Operators can also rotate any tenant's key directly:

```bash
sqlite3 ~/.alfred/registry.sqlite \
  "UPDATE api_keys SET revoked_at = datetime('now') WHERE key_prefix = 'alk_XXXXXXXX';"
```

## 6. Rate limits

| Endpoint | Limit |
|---|---|
| `POST /console/api/bootstrap` | 5 per IP per 60 min (v0.3.1) |
| `POST /console/api/recover`   | 3 per IP per hour (v0.4.0) |
| All other `GET/POST/PATCH/DELETE` (Custom GPT Actions) | 100 per API key per 60 min (v0.4.1) |

A 429 response includes a `Retry-After` header. The GPT's system prompt
instructs it to surface the rate-limit message to the user.

## 7. What this GPT can NOT do (be honest with users)

- It cannot run the orchestrator, developer, qa, librarian, architect, or
  reviewer agents. (That's v0.5.0.)
- It cannot run skills locally. (That's v0.5.0.)
- It cannot execute local code. (Disabled at the GPT capability level.)
- It cannot read other tenants' memories. (Blocked by `policies/check` and
  by the per-tenant API key.)

If the user wants those, point them at the CLI:
[`packages/memory-server/scripts/alfred.mjs`](../../packages/memory-server/scripts/alfred.mjs).
