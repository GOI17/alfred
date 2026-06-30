# Alfred Memory Gemini Adapter v0.3.0

Bridge for Google AI Studio and Gemini Enterprise. Provides an OpenAPI 3.0
schema compatible with Google AI Studio's Extensions feature and a thin HTTPS
forwarder.

## Setup (Google AI Studio)

1. Open Google AI Studio → Tools → Extensions → Create Extension.
2. Paste `openapi.json` and provide the schema name "alfred-memory".
3. Configure auth: API Key, header `x-api-key`, value = your `alk_...` key.
4. In Extension settings, point the base URL to your bridge (`https://<host>/`).

## Setup (bridge)

```bash
ALFRED_MEMORY_BASE_URL=https://alfred-memory.example.com \
ALFRED_MEMORY_API_KEY=alk_... \
ALFRED_MEMORY_BRIDGE_PORT=8788 \
  node packages/gemini-adapter/bin/bridge.mjs
```

Env vars:

| Var | Required | Default |
|---|---|---|
| `ALFRED_MEMORY_BASE_URL` | yes | none |
| `ALFRED_MEMORY_API_KEY` | yes | none |
| `ALFRED_MEMORY_BRIDGE_PORT` | no | `8788` |
| `ALFRED_MEMORY_BRIDGE_TLS_CERT` | no | none |
| `ALFRED_MEMORY_BRIDGE_TLS_KEY` | no | none |

If both cert and key are present, the bridge starts in HTTPS mode.

## Tests

```bash
npm run check
npm test
```

10 tests covering the OpenAPI schema and the bridge forwarding flow.
