# Local Gemini bridge

The bridge forwards local HTTP requests to an explicitly configured Memory
endpoint using an issued API key. Its shipped command binds only to
`127.0.0.1`; Google AI Studio cloud extensions cannot reach it. The managed
Alfred Memory endpoint has been retired.

First follow the [local quickstart](../../docs/QUICKSTART.md), then run:

```bash
ALFRED_MEMORY_BASE_URL=http://127.0.0.1:3000 \
ALFRED_MEMORY_API_KEY='<your issued key>' \
node packages/gemini-adapter/bin/bridge.mjs
```

Local clients can call `http://127.0.0.1:8788`. Set
`ALFRED_MEMORY_BRIDGE_PORT` to change the local port. Optional
`ALFRED_MEMORY_BRIDGE_TLS_CERT` and `ALFRED_MEMORY_BRIDGE_TLS_KEY` enable TLS on
the same loopback listener. Neither TLS nor Postgres storage makes it a hosted
service. Keep the key out of source control and chat.

The OpenAPI and forwarding contracts remain for local tooling and compatibility.

```bash
node --test packages/gemini-adapter/test/*.mjs
```
