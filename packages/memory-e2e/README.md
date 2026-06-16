# @alfred-labs/memory-e2e

Reproducible E2E environment for validating Alfred Memory end-to-end with:

- **Codex / MCP**: `Codex → memory-mcp → memory-client → Memory API → PostgreSQL`
- **ChatGPT Actions**: `ChatGPT Custom GPT → memory-openapi → Memory API → PostgreSQL` (via public HTTPS)

This package intentionally contains only **scripts, config and documentation**. It does not add new features or change memory domain logic.

## Files

| Path | Purpose |
|------|---------|
| `.env.example` | Template for environment variables and secrets. |
| `config/docker-compose.yml` | PostgreSQL container for local E2E. |
| `config/init.sql` | Minimal bootstrap (canonical schema lives in `packages/memory/migrations`). |
| `scripts/setup-e2e.sh` | One-command setup: Docker Compose + migrations. |
| `scripts/start-memory-server.js` | Starts the Memory HTTP API against PostgreSQL. |
| `scripts/run-migrations.sh` | Applies `packages/memory/migrations/*.sql`. |
| `scripts/start-cloudflared.sh` | Starts a Cloudflare Tunnel to expose the API publicly. |
| `scripts/start-ngrok.sh` | Starts an ngrok tunnel to expose the API publicly. |
| `scripts/smoke-codex.mjs` | Smoke test for the Codex/MCP path. |
| `scripts/smoke-chatgpt.mjs` | Smoke test for the ChatGPT Actions path. |

## Quick start

1. Copy the environment template and edit secrets:

   ```bash
   cd packages/memory-e2e
   cp .env.example .env
   # edit .env
   ```

2. Start PostgreSQL and apply migrations:

   ```bash
   pnpm --filter @alfred-labs/memory-e2e setup
   ```

3. Start the Memory API:

   ```bash
   pnpm --filter @alfred-labs/memory-e2e start
   ```

4. In another terminal, start an HTTPS tunnel (choose one):

   ```bash
   # Cloudflare Tunnel
   pnpm --filter @alfred-labs/memory-e2e tunnel:cloudflare

   # ngrok
   pnpm --filter @alfred-labs/memory-e2e tunnel:ngrok
   ```

5. Run smoke tests:

   ```bash
   # Local Codex/MCP path
   pnpm --filter @alfred-labs/memory-e2e smoke:codex

   # ChatGPT Actions path (uses public HTTPS URL)
   export MEMORY_API_BASE_URL=https://your-tunnel-url
   pnpm --filter @alfred-labs/memory-e2e smoke:chatgpt
   ```

## Manual ChatGPT Actions checklist

1. Start the tunnel and copy the public HTTPS URL.
2. Open the ChatGPT Custom GPT editor for your Alfred Memory GPT.
3. Create a new Action and import `packages/memory-openapi/openapi.yaml`.
4. Set authentication to **API Key** and paste the key from `.env`.
5. Save the action and start a new conversation.
6. Ask the GPT to remember a durable fact.
7. Ask the GPT to recall that fact.
8. Inspect PostgreSQL to confirm reads and writes:

   ```bash
   psql "$DATABASE_URL" -c "SELECT id, type, content, namespace FROM memories;"
   ```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `MEMORY_API_PORT` | no | Local port for the Memory API (default `8080`). |
| `MEMORY_API_KEYS` | yes | JSON object mapping API keys to user ids. |
| `CF_TUNNEL_TOKEN` | for Cloudflare | Tunnel token from `cloudflared`. |
| `CF_TUNNEL_HOSTNAME` | for Cloudflare | Public hostname assigned to the tunnel. |
| `NGROK_AUTHTOKEN` | for ngrok | ngrok authtoken. |
| `NGROK_DOMAIN` | no | Static ngrok domain (paid feature). |
| `MEMORY_API_BASE_URL` | for ChatGPT smoke | Public HTTPS URL of the tunnel. |

## Scope rules

- No new features.
- No changes to `packages/memory`, `packages/memory-client`, `packages/memory-mcp`, `packages/memory-openapi`.
- Secrets are read from `.env`, never hardcoded.
- Manual E2E results and friction notes should be captured in issues, not in code, until a real friction is confirmed.

## Risks and limitations

- `MEMORY_API_KEYS` is a simple JSON map: fine for personal E2E, not for multi-user deployments.
- ChatGPT Actions requires a public HTTPS endpoint on port 443 with a valid certificate.
- The smoke tests are lightweight; they exercise the HTTP surface but do not run a real Codex agent.
- Long-term friction data must come from real daily use, not synthetic tests.
