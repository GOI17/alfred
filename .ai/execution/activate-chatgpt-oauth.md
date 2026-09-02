---
id: execution/activate-chatgpt-oauth
description: Activate direct OAuth for the production Alfred Memory Custom GPT.
phase: issue-139-activate-chatgpt-oauth
author: core
issue: 139
---

# Activate ChatGPT OAuth

## Goal

Enable the deployed OAuth implementation for Custom GPT
`g-6a320e87e6908191a3f834b273221f99` without committing or logging its shared
client secret.

## Decisions

1. GitHub Actions is the deployment trust boundary because its existing
   `FLY_API_TOKEN` already owns production deployments.
2. The client ID, client secret, and exact redirect allowlist are repository
   secrets and are passed to Fly through standard input.
3. Secrets are staged together before `flyctl deploy`, so a partial OAuth
   configuration never reaches a running Machine.
4. Both current ChatGPT callback hosts are allowlisted exactly; wildcards are
   forbidden.
5. Deterministic validation makes no model-provider requests and reports
   `provider_calls: 0`.

## Production values

- Client ID: `alfred-chatgpt`
- Redirects:
  - `https://chatgpt.com/aip/g-6a320e87e6908191a3f834b273221f99/oauth/callback`
  - `https://chat.openai.com/aip/g-6a320e87e6908191a3f834b273221f99/oauth/callback`
- Authorization URL: `https://alfred-labs-memory.fly.dev/oauth/authorize`
- Token URL: `https://alfred-labs-memory.fly.dev/oauth/token`
- Scopes: `memory:read memory:write`

## Acceptance criteria

- [ ] No OAuth secret exists in Git history or workflow output.
- [ ] All three OAuth values are present before Fly synchronization begins.
- [ ] Fly receives the three values in one staged secret import.
- [ ] The subsequent deployment activates the staged values together.
- [ ] The authorization endpoint accepts the exact GPT callback.
- [ ] The GPT Action is configured for direct OAuth.
- [ ] Existing API-key authentication remains unchanged.

