# Alfred Memory OpenAI Plugin Submission

Issue: [#167](https://github.com/GOI17/alfred/issues/167)

This document is the non-secret review packet for publishing Alfred Memory in
the OpenAI universal Plugins Directory. It follows the current OpenAI plugin
submission flow for a remote MCP server without custom UI.

## Listing

| Field | Value |
|---|---|
| Name | Alfred Memory |
| Short description | Private, cross-tool memory that stays under the user's control. |
| Category | Productivity |
| Website | https://alfred.alfredlabs.org/memory/ |
| MCP server | https://alfred-labs-memory.fly.dev/mcp |
| Privacy | https://alfred-labs-memory.fly.dev/privacy |
| Publisher | AlfredLabs |
| Support | https://alfred.alfredlabs.org/support/ · alfred.support@alfredlabs.org |
| Terms | https://alfred.alfredlabs.org/terms/ |

### Long description

Alfred Memory gives ChatGPT and Codex a private, user-controlled place to keep
durable facts, preferences, decisions, workflows, project details,
corrections, and sources. Users can search, browse, create, revise, and delete
their own memories. OAuth scopes and tenant isolation keep every connected
workspace separate. Alfred does not expose memory content publicly or use it
for advertising.

## Authentication

- Type: OAuth 2.1 Authorization Code with PKCE S256.
- Protected resource metadata:
  `https://alfred-labs-memory.fly.dev/.well-known/oauth-protected-resource`
- Authorization server metadata:
  `https://alfred-labs-memory.fly.dev/.well-known/oauth-authorization-server`
- Authorization endpoint:
  `https://alfred-labs-memory.fly.dev/oauth/authorize`
- Token endpoint: `https://alfred-labs-memory.fly.dev/oauth/token`
- Resource: `https://alfred-labs-memory.fly.dev/mcp`
- Scopes: `memory:read`, `memory:write`
- Client registration: predefined confidential client.
- Redirect URI: copy the exact callback-ID-specific URI from the Platform app
  management page into `ALFRED_OAUTH_REDIRECT_URIS` before review.
- Reviewer access: provision a dedicated tenant and credentials outside source
  control. The account must not require MFA, SMS, email confirmation, or a
  private network.

## Tools and annotations

| Tool | Scope | Read only | Open world | Destructive |
|---|---|---:|---:|---:|
| `memory_search` | `memory:read` | true | false | false |
| `memory_list` | `memory:read` | true | false | false |
| `memory_create` | `memory:write` | false | false | false |
| `memory_update` | `memory:write` | false | false | false |
| `memory_delete` | `memory:write` | false | false | true |

## Starter prompts

1. Search my Alfred memories for decisions about authentication.
2. Remember that I prefer concise weekly project updates.
3. List my project memories tagged `alfred`.
4. Correct the memory I just created so it says Friday instead of Thursday.
5. Delete the test memory after showing me exactly which memory will be
   removed and asking for confirmation.

## Positive review cases

Use a dedicated reviewer tenant seeded with the fixtures referenced below.
Replace fixture IDs in the portal with the actual stable reviewer-tenant IDs.

### P1 — Search a private memory

- Prompt: “Search my Alfred memories for the authentication decision.”
- Fixture: one decision memory containing “Use OAuth 2.1 with PKCE S256,” tagged
  `review-auth`.
- Expected: calls `memory_search` with a focused query and returns only the
  matching reviewer-tenant memory.

### P2 — List filtered memories

- Prompt: “List my project memories tagged review-project.”
- Fixture: two project memories tagged `review-project` and one untagged fact.
- Expected: calls `memory_list` with `type=project` and
  `tag=review-project`; returns the two matching memories.

### P3 — Create a memory

- Prompt: “Remember that my weekly review happens every Friday at 4 PM.”
- Fixture: no memory with the same content.
- Expected: searches first to avoid a duplicate, then calls `memory_create`
  with an appropriate durable type and source; returns the created ID.

### P4 — Update an identified memory

- Prompt: “Update memory REVIEW_UPDATE_ID: the weekly review is at 3 PM.”
- Fixture: `REVIEW_UPDATE_ID` belongs to the reviewer tenant and says 4 PM.
- Expected: calls `memory_update` for that exact ID with only the content
  patch; the namespace remains unchanged.

### P5 — Confirm and delete a fixture

- Prompt: “Delete memory REVIEW_DELETE_ID.”
- Fixture: a disposable memory named “OpenAI review deletion fixture.”
- Expected: describes the target and asks for confirmation before calling
  `memory_delete`; after confirmation, deletes only `REVIEW_DELETE_ID`.

## Negative review cases

### N1 — Missing or invalid authentication

- Request: initialize or call a tool without a valid Alfred OAuth token.
- Expected: no data is returned; HTTP 401 includes a Bearer challenge pointing
  to protected-resource metadata and OAuth linking is offered.

### N2 — Insufficient scope

- Prompt: “Create a memory” while connected with `memory:read` only.
- Expected: no write occurs; the tool returns `insufficient_scope` and an MCP
  authentication challenge requesting reconnection.

### N3 — Out-of-scope request

- Prompt: “What is the weather in Mexico City today?”
- Expected: Alfred Memory tools are not called because the request is unrelated
  to private memory storage or retrieval.

## Domain verification

1. In the submission portal, use the default challenge base derived from the
   production MCP URL.
2. Copy the exact token into the deployment secret
   `ALFRED_OPENAI_APPS_CHALLENGE` without printing or committing it.
3. Deploy and verify that
   `https://alfred-labs-memory.fly.dev/.well-known/openai-apps-challenge`
   returns only that token.
4. Complete verification in the portal.

## Release notes

Initial Alfred Memory public plugin release. Adds an authenticated Streamable
HTTP MCP endpoint with five private memory tools, accurate safety annotations,
OAuth 2.1 discovery and PKCE, tenant isolation, domain verification support,
and deterministic review fixtures.

## Pre-submission checklist

- [ ] Publisher identity is verified in the OpenAI Platform organization.
- [ ] The submitter has Apps Management write permission.
- [ ] Public support and terms pages identify AlfredLabs after production deployment.
- [ ] Logo meets the portal's current dimensions and branding requirements.
- [ ] Production dependency install and container build succeed.
- [ ] Production MCP Inspector initialization and all five tool calls succeed.
- [ ] ChatGPT developer-mode direct, indirect, edge, and out-of-scope tests pass.
- [ ] **Scan Tools** shows five tools with the expected schemas and annotations.
- [ ] Domain verification succeeds with the secret-backed challenge route.
- [ ] Dedicated reviewer credentials are entered only in the portal.
- [ ] Five positive and three negative cases are reproducible.
- [ ] Country availability, release notes, and policy attestations are complete.

## Official references

- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/submission
