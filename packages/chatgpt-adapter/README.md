# Alfred Memory ChatGPT Adapter v0.3.0

Custom GPT Actions integration for Alfred Memory. Provides:

1. An **OpenAPI 3.1 spec** (`openapi.json`) that ChatGPT consumes to define Actions.
2. A **bridge server** (`src/bridge.mjs`) that forwards HTTP requests from ChatGPT to your self-hosted Alfred Memory Server with proper auth and CORS.

## Setup (Custom GPT)

1. Open ChatGPT → My GPTs → Create.
2. Configure → Actions → **Import OpenAPI schema** → upload `openapi.json`.
3. Authentication → **API Key** → type **Bearer** → paste `alk_...` key.
4. Privacy → set to **Public** or **Private** depending on your use.
5. Save and test: ask the GPT `List my last 5 memories`.

## Setup (bridge server)

```bash
ALFRED_MEMORY_BASE_URL=https://alfred-memory.example.com \
ALFRED_MEMORY_API_KEY=alk_... \
ALFRED_MEMORY_BRIDGE_PORT=8787 \
ALFRED_MEMORY_BRIDGE_ALLOWED_ORIGINS=https://chat.openai.com \
  node packages/chatgpt-adapter/src/bridge.mjs
```

Env vars:

| Var | Required | Default |
|---|---|---|
| `ALFRED_MEMORY_BASE_URL` | yes | none |
| `ALFRED_MEMORY_API_KEY` | yes | none |
| `ALFRED_MEMORY_BRIDGE_PORT` | no | `8787` |
| `ALFRED_MEMORY_BRIDGE_ALLOWED_ORIGINS` | no | `https://chat.openai.com` |

In the GPT's Actions schema, point the **server URL** to `https://<your-bridge-host>:8787/memories`.

## What the bridge does

1. Accepts HTTPS requests from ChatGPT.
2. Validates origin against the CORS allowlist (defense in depth).
3. Forwards to your self-hosted Alfred Memory Server with `Authorization: Bearer alk_...`.
4. Streams the response back unchanged.

The bridge does NOT have a database. It is pure forwarder.

## What the OpenAPI spec exposes

| Operation | HTTP |
|---|---|
| `listMemories` | `GET /memories?namespace=&type=&limit=&offset=` |
| `createMemory` | `POST /memories` |
| `searchMemories` | `GET /memories/search?q=&namespace=&type=&limit=&offset=` |
| `getMemory` | `GET /memories/{id}` |
| `deleteMemory` | `DELETE /memories/{id}` |
| `validatePolicy` | `GET /policy` |
| `health` | `GET /health` |

The schema is hand-curated for ChatGPT's tooling. If you change the underlying memory schema, regenerate this file with the script in `tools/generate-openapi.mjs` (planned).

## Tests

```bash
npm run check
npm test
```

Test counts:

- `contract.test.mjs` — 11 tests covering OpenAPI shape and bridge forwarding.
