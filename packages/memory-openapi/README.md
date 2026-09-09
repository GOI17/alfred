# @alfred-labs/memory-openapi

OpenAPI schema and setup guide for exposing [Alfred Memory](../memory) to a
ChatGPT Custom GPT via ChatGPT Actions.

This is **not** a native ChatGPT Memory integration. Alfred Memory stays external;
the Custom GPT invokes it through HTTP requests described by this schema.

## Scope

This package only contains:

- `openapi.yaml` — the OpenAPI 3.1 schema used by ChatGPT Actions.
- `README.md` — setup instructions and recommended Custom GPT instructions.
- `test/openapi.test.js` — validation tests for the schema.

It intentionally does **not** contain:

- OAuth runtime code (implemented by `@alfred-labs/memory-server`).
- ChatGPT native memory sync.
- MCP tooling for ChatGPT.
- UI, billing, embeddings, RAG or other external integrations.

## Endpoints exposed to ChatGPT

| Method | Path | OperationId | Consequential | Purpose |
|--------|------|-------------|---------------|---------|
| GET | `/health` | `healthCheck` | no | Connectivity check |
| POST | `/search` | `searchMemories` | no | Keyword/semantic/hybrid search |
| GET | `/memories` | `listMemories` | no | List/filter memories |
| GET | `/memories/{id}` | `getMemory` | no | Read one memory |
| POST | `/memories/capture` | `captureMemory` | **yes** | Proactively capture a grounded durable statement |
| POST | `/memories` | `createMemory` | **yes** | Create a memory |
| PATCH | `/memories/{id}` | `updateMemory` | **yes** | Update a memory |
| DELETE | `/memories/{id}` | `deleteMemory` | **yes** | Delete a memory |

## Authentication

ChatGPT Actions supports `None`, `API Key` and `OAuth`; see the official
[GPT Action authentication guide](https://developers.openai.com/api/docs/actions/authentication).
Alfred uses **OAuth 2.0 Authorization Code** so each ChatGPT user receives a
separate, scoped token:

1. In the Custom GPT Action, set **Authentication** to **OAuth**.
2. Configure Alfred's `/oauth/authorize` and `/oauth/token` URLs plus the
   `memory:read memory:write` scopes.
3. ChatGPT exchanges a one-time code and sends the resulting access token as:

   ```
   Authorization: Bearer <oauth-access-token>
   ```

The existing `alk_...` key is entered only on Alfred's consent page. It is not
stored in ChatGPT's GPT configuration.

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
- captureMemory: proactively capture a narrow durable preference, decision, fact, workflow, correction, or source directly stated by the user, without waiting for a save request. Pass {candidate, context}; candidate.content preserves an exact excerpt of minimal context.evidence, and context.origin is user or verified. Keep content under 1,000 and evidence under 2,000 characters.
- createMemory: for explicit user-requested memory creation; never use it to bypass a rejected capture.
- updateMemory: only when correcting or extending an existing memory. Confirm with the user first.
- deleteMemory: only when the user explicitly asks to remove a memory. Confirm with the user first.
- healthCheck: optional, to verify connectivity.

Rules:
- Use the relevant project namespace for project-specific facts; otherwise use personal unless the user specifies another.
- Do not store secrets, credentials, API keys, private keys, raw transcripts, chain-of-thought, temporary logs, or sensitive personal data.
- Respect active-conversation opt-outs and "no guardes esto" / "do not remember this". Suppress capture or pass context.persistenceDisabled: true.
- If you are unsure whether something should be remembered, do not store it.
- Acknowledge a new save only after captureMemory returns created. Do not claim a new save for duplicate or skipped; report failures honestly. Existing host tool approval remains in force.
- Ask for confirmation before updateMemory and deleteMemory because they are consequential.
```

## Manual E2E checklist

1. Start the Alfred Memory API on a public HTTPS endpoint.
2. Configure the OAuth client, client secret, and exact ChatGPT callback URLs.
3. Create a private Custom GPT.
4. Add a ChatGPT Action and point it to `openapi.yaml`.
5. Set **OAuth** authentication and choose **Sign in**.
6. Test `healthCheck` if exposed.
7. State “Prefiero respuestas breves” without a save request → `captureMemory` returns `created`; repeat it → `duplicate`.
8. Ask about that preference → `searchMemories`.
9. List the `project:alfred` namespace → `listMemories` with a low limit.
10. Update the memory → confirm → `updateMemory`.
11. Delete the memory → confirm → `deleteMemory`.
12. Confirm secrets and raw chat history are not persisted.
13. Confirm errors and traces expose neither the API key nor OAuth credentials.

## Risks and limitations

- **OAuth client secret**: keep it in server/ChatGPT configuration and rotate it
  if it is exposed.
- **Mutations are consequential**: `createMemory`, `updateMemory` and `deleteMemory`
  are marked with `x-openai-isConsequential: true`.
- **Exfiltration risk**: keep the Custom GPT private until you trust the memory
  contents. `searchMemories` and `listMemories` can expose stored context.
- **Exact callbacks**: ChatGPT callback URLs must be explicitly allowlisted;
  wildcard redirect URLs are rejected.
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

The package is intentionally dependency-free. The test suite uses a small,
deterministic YAML structure scanner that validates the OpenAPI contract without
requiring a package-level YAML parser or lockfile update.
