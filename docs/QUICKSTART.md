# Alfred Memory quickstart

Alfred Memory runs as a local process on your computer. The managed hosted
service has been retired. Keep the process running while your clients use it.

## Create your local memory

With the Alfred CLI available, run this in your project directory:

```bash
alfred init --profile=coding --backend=sqlite --name my-memory
ALFRED_MEMORY_REQUIRE_AUTH=true alfred serve
```

Save the API key printed by `init`; it is shown once. Open
<http://127.0.0.1:3000/console/> and unlock the console with that key. The console
and API use the same origin. No hosted account or cloud console is required.

When working from this repository, use
`node packages/memory-server/scripts/alfred.mjs` in place of `alfred`.
The server auto-discovers the committed console build in the repository.

## Local clients and custom ports

```bash
ALFRED_MEMORY_REQUIRE_AUTH=true alfred serve --bind=localhost --port=4321
```

Open <http://127.0.0.1:4321/console/> for this port. The server accepts `localhost`,
IPv4 loopback addresses in `127.0.0.0/8`, and `::1`. Wildcard binds, arbitrary
hostnames, and hosting modes other than `local` are rejected.

Configure a local coding client, Claude Desktop, or the Gemini bridge with your
actual local endpoint and the issued key:

```bash
export ALFRED_MEMORY_BASE_URL=http://127.0.0.1:3000
export ALFRED_MEMORY_API_KEY='<your issued key>'
curl -H "Authorization: Bearer $ALFRED_MEMORY_API_KEY" "$ALFRED_MEMORY_BASE_URL/memories?limit=5"
```

Cloud ChatGPT Actions and Google AI Studio cannot reach this loopback service.
The public website provides instructions only; it does not handle keys or call
an API on your computer.

## Storage and existing installations

SQLite is the straightforward coding-profile option. Existing tenants, API keys,
OAuth, MCP, and Postgres backends remain supported. A user-chosen Postgres database
may be remote; the Memory HTTP process still runs locally. The `web` and `both`
profile names are retained for compatibility and require Postgres. They do not
provide a hosted service or cloud access to the loopback process.

For a coding profile backed by your own Postgres:

```bash
alfred init --profile=coding --backend=postgres --name my-memory --db-connection '<your Postgres connection>'
```

Keep credentials out of chat and source control. To rotate a key, use
`alfred key rotate --tenant <tenant-id>` and update your local clients.

See the [server configuration](../packages/memory-server/README.md),
[local console](../packages/console-web/README.md), and
[Gemini bridge](../packages/gemini-adapter/README.md).
