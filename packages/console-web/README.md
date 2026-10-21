# Alfred Memory local console

This package is the browser UI served by the local Memory server at `/console/`.
It uses same-origin API paths, so loopback aliases and custom ports work without
rebuilding. There is no hosted console or managed Memory account.

## Use it

```bash
alfred init --profile=coding --backend=sqlite --name my-memory
ALFRED_MEMORY_REQUIRE_AUTH=true alfred serve
```

Open <http://127.0.0.1:3000/console/> and unlock with the key printed by `init`.
The server must remain running. Optional Postgres tenant setup is for a local
operator with a configured database; it does not provision a hosted service.

## Build and package

```bash
node packages/console-web/scripts/build.mjs
node packages/console-web/scripts/check-html.mjs
```

The committed `dist/index.html` is discovered by the server in a repository
checkout. For a different layout set `ALFRED_CONSOLE_DIR` to the built directory.
`ALFRED_BUILD_VERSION` may label a build. A nonempty `ALFRED_API_BASE` is rejected:
the console is served by, and talks to, the same local origin.

The standalone `scripts/serve.mjs` loopback server previews static UI only;
use `alfred serve` for working API routes. Public Pages copies the static
local-start instructions in `site/memory/`, not this operational console.

## Verify

```bash
node --test packages/console-web/test/*.test.mjs
npm run pages:build
npm run pages:check
```

API keys stay in browser localStorage and persist across sessions; logout removes
the stored key. Keys are sent only to same-origin API paths. Do not paste keys
into chat. Cloud ChatGPT Actions and Google AI Studio cannot reach the local service.
