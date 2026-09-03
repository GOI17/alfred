---
id: execution/setup-onboarding-explanations
description: Explain setup consequences, reuse existing Memory tenants, and make ChatGPT onboarding complete without exposing OAuth secrets.
phase: issue-158-setup-onboarding
author: core
issue: 158
---

# Setup onboarding explanations

## Goal

Make `alfred setup` describe the consequences of every choice, recognize that
the user may already have an Alfred Memory tenant, and separate the public
ChatGPT sign-in path from operator-only Custom GPT configuration.

## Context

The current setup UI explains why defaults were recommended but not what the
selected configuration will do. Its Memory choices imply a new storage setup
and omit an existing tenant created in the Memory web app. Public ChatGPT
instructions also send tenant users into the GPT editor without supplying two
required OAuth fields; publishing the shared client secret would be unsafe.

## Requirements

### R1: Existing Memory tenant

1. Add `existing-tenant` as a first-class Memory setup choice.
2. Detect an existing connection from non-secret signals only: the presence of
   `<cwd>/.alfred/config.json`, or the simultaneous presence of
   `ALFRED_MEMORY_BASE_URL` and `ALFRED_MEMORY_API_KEY`.
3. Never read, render, serialize, trace, or persist credential values during
   discovery.
4. Recommend `existing-tenant` for Memory or Full when a connection is
   detected; otherwise preserve the preview-first `decide-later` default.
5. Explain that `existing-tenant` reuses Memory app credentials and does not
   create another tenant. If no connection was detected, tell the user which
   environment variables connect it after setup.

### R2: Configuration explanations

1. Replace user-facing `Rationale` and `Why` terminology with
   `What this configuration changes` and `Explain`.
2. Explain the practical effect of the current edition, harness selection,
   Runtime Profiles choice, Memory choice, install name/path, and execution
   intent.
3. Runtime Profiles enabled must state that shared defaults and private
   machine overlays are initialized, while activation remains a later,
   preview/approval-gated action.
4. Runtime Profiles skipped must state that no profile directories or
   switching layer are initialized and harness configuration remains manual.
5. Changed choices must explain their current effect instead of displaying a
   generic “selection respected” sentence.
6. Node, OpenTUI, text fallback, preview, and final handoff must use consistent
   consequence language.

### R3: ChatGPT onboarding

1. The tenant-user path opens the preconfigured Alfred GPT and requires only
   `Sign in` plus the user's `alk_...` key on Alfred's consent page.
2. Tenant-user documentation must not ask for or expose an OAuth client secret.
3. Operator documentation must provide every GPT editor field:
   `client_id=alfred-chatgpt`, the deployment's private
   `ALFRED_OAUTH_CLIENT_SECRET`, authorization URL, token URL, scopes, and exact
   callback allowlist.
4. State that no default/public client secret exists. If the operator no longer
   has the current value, rotate it and update the GPT editor and server
   deployment together.
5. Keep the official GPT URL and OAuth metadata in the versioned GPT manifest.

### R4: Safety and compatibility

1. Preview/apply approval boundaries remain unchanged.
2. Existing non-interactive Memory values remain accepted.
3. Setup model assignment remains disabled.
4. All discovery, recommendation, rendering, and validation remain
   deterministic with `provider_calls: 0`.

### R5: Regression coverage

1. Test existing-tenant discovery without credential-value exposure.
2. Test recommendation and rendering for detected and manually selected
   existing tenants.
3. Test both Runtime Profiles consequence explanations.
4. Assert that user-facing ChatGPT instructions include the official GPT path
   and that advanced instructions include all OAuth fields without a secret.
5. Run setup, installer TUI, Memory server, site, policy, and release
   validators relevant to changed files.

## Completion conditions

- [x] Issue #158 acceptance criteria are covered by implementation and tests.
- [x] Public ChatGPT onboarding requires no OAuth secret from tenant users.
- [x] Existing Memory tenants are visible and preferred when detected.
- [x] Every setup choice explains its operational consequence.
- [x] Preview/apply behavior and protected-write gates are unchanged.
- [x] Required checks pass with provider calls at zero.

## References

- Issue: https://github.com/GOI17/alfred/issues/158
- Setup state machine: `scripts/tui/install-pathfinder.mjs`
- Discovery: `scripts/tui/install-discovery.mjs`
- OpenTUI adapter: `packages/installer-tui/src/installer-opentui.mjs`
- Installer authority: `install.sh`
- GPT manifest: `.ai/gpt/alfred-memory-gpt.json`
- Public Memory app: `site/memory/app/index.html`
- Operator deployment guide: `.ai/docs/custom-gpt-deploy.md`
