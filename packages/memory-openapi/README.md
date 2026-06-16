# @alfred-labs/memory-openapi

OpenAPI schema and setup guide for exposing [Alfred Memory](../memory) to a
ChatGPT Custom GPT via [ChatGPT Actions](https://developers.openai.com/api/docs/actions/getting-started).

This is **not** a native ChatGPT Memory integration. Alfred Memory stays external;
the Custom GPT invokes it through HTTP requests described by this schema.

## Scope

This package only contains:

- `openapi.yaml` — the OpenAPI 3.1 schema used by ChatGPT Actions.
- `README.md` — setup instructions and recommended Custom GPT instructions.
- `test/openapi.test.js` — validation tests for the schema.

It intentionally does **not** contain:

- OAuth or user-management flows.
- ChatGPT native memory sync.
- MCP tooling for ChatGPT.
- UI, billing, embeddings, RAG or other external integrations.

## Endpoints exposed to ChatGPT

| Method | Path | OperationId | Consequential | Purpose |
|--------|------|-------------|---------------|---------|
| GET | `/health` | `healthCheck` | no | Connectivity check |
| GET | `/memories/search` | `searchMemories` | no | Full-text search |
| GET | `/memories` | `listMemories` | no | List/filter memories |
| POST | `/memories` | `createMemory` | **yes** | Create a memory |
| PATCH | `/memories/{id}` | `updateMemory` | **yes** | Update a memory |
| DELETE | `/memories/{id}` | `deleteMemory` | **yes** | Delete a memory |

## Authentication

ChatGPT Actions supports `None`, `API Key` and `OAuth`. For this MVP we use an
**API key sent as a Bearer token**:

1. In the Custom GPT Action, set **Authentication** to **API Key**.
2. Configure the schema location (`openapi.yaml`) and set the API key.
3. The schema declares `security: [bearerAuth: []]` and the
   `bearerAuth` HTTP bearer scheme, so ChatGPT sends:

   ```
   Authorization: Bearer <api-key>
   ```

Do not rely on the `x-api-key` header; ChatGPT Actions does not support custom
headers in production.

## Hosting requirement

Production ChatGPT Actions require a public HTTPS endpoint on port 443 with a
valid, publicly trusted TLS certificate. `localhost` does not work unless you use
a temporary tunnel for manual testing.

## Custom GPT instructions (suggested)

Use these instructions in the Custom GPT configuration:

```text
You have access to Alfred Memory, an external memory store for durable user context.

When to use each Action:
- searchMemories: when the user asks about previous preferences, decisions, workflows, architecture, corrections, or historical context.
- listMemories: when the user wants a summary of what is known for a namespace such as "project:alfred".
- createMemory: only for durable, reusable information (preferences, decisions, stable facts, workflows, corrections, useful sources).
- updateMemory: only when correcting or extending an existing memory. Confirm with the user first.
- deleteMemory: only when the user explicitly asks to remove a memory. Confirm with the user first.
- healthCheck: optional, to verify connectivity.

Rules:
- Default namespace is "project:alfred" unless the user specifies another.
- Do not store secrets, credentials, API keys, private keys, raw transcripts, chain-of-thought, temporary logs, or sensitive personal data.
- If you are unsure whether something should be remembered, do not store it.
- Ask for confirmation before updateMemory and deleteMemory because they are consequential.
```

## Manual E2E checklist

1. Start the Alfred Memory API on a public HTTPS endpoint.
2. Confirm `Authorization: Bearer <api-key>` is accepted.
3. Create a private Custom GPT.
4. Add a ChatGPT Action and point it to `openapi.yaml`.
5. Set **API Key** authentication with the production API key.
6. Test `healthCheck` if exposed.
7. Ask the GPT to remember a durable preference → `createMemory`.
8. Ask about that preference → `searchMemories`.
9. List the `project:alfred` namespace → `listMemories` with a low limit.
10. Update the memory → confirm → `updateMemory`.
11. Delete the memory → confirm → `deleteMemory`.
12. Confirm secrets and raw chat history are not persisted.
13. Confirm errors do not expose the API key.

## Risks and limitations

- **Shared API key**: fine for personal use; unsuitable for multi-user deployments.
- **Mutations are consequential**: `createMemory`, `updateMemory` and `deleteMemory`
  are marked with `x-openai-isConsequential: true`.
- **Exfiltration risk**: keep the Custom GPT private until you trust the memory
  contents. `searchMemories` and `listMemories` can expose stored context.
- **No custom headers**: ChatGPT Actions does not support custom headers, so
  authentication must use the `Authorization` header.
- **Payload/timeout limits**: keep responses under 100,000 characters and under
  45 seconds.
- **Namespace discipline**: the default namespace is `project:alfred`. Ask the
  user before switching context.
- **Not native memory**: ChatGPT native Memory is not synced with Alfred Memory.

## Testing

Run the package tests from the repository root:

```bash
pnpm --filter @alfred-labs/memory-openapi test
```

Or directly with Node:

```bash
cd packages/memory-openapi
node --test test/openapi.test.js
```
