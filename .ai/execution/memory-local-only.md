---
id: memory-local-only
description: Retire hosted Alfred Memory and require a local loopback server.
owner: developer
phase: review
---

# Memory Local-Only Runtime

- Issue: https://github.com/GOI17/alfred/issues/232
- Branch: `issue-232-memory-local-only`; base `c2354c9`.
- Direction: the user explicitly requested retiring hosted Memory and running
  its server only locally. SQLite and user-chosen Postgres storage remain supported.

## Requirements

- R1: Validate local hosting mode, loopback bind and port before opening the
  registry; apply the same contract to direct server construction/startup.
  Honor actual CLI `--bind` and `--port` values and reject invalid values.
- R2: Retire Fly deploy/configuration and public container defaults. Preserve
  authentication, tenants, MCP, storage backends and existing data.
- R3: Serve the packaged console from the local server at `/console/`, using
  relative same-origin API requests for loopback aliases and custom ports.
  Public Pages contains local-start instructions, not a live remote console.
- R4: Bind the shipped Gemini bridge and console development server to loopback.
- R5: Update active onboarding, privacy and user documentation; preserve
  historical release/execution records. Document the authenticated coding +
  SQLite initialization flow and distinguish server location from DB location.
- R6: Use focused deterministic regressions and an isolated authenticated CRUD
  smoke; no dependencies, protected-source reads, or eval baseline changes.

## Operational Evidence

- GitHub workflow `deploy-fly.yml` (305138887) is `disabled_manually`; no queued
  or running deploys remained.
- Fly app `alfred-labs-memory`, machine `d8944e1c7de658` in `gru`: stopped with
  `autostart=false`. The sanitized machine config changed only this flag.
- Encrypted 1GB volume `vol_458nndodww8gn184` remains attached at `/app/data`.
  App, public addresses, port mappings, image and other runtime resources remain.
- Public `/health` and OAuth discovery probes timed out after 20 seconds each
  with no response; subsequent machine inspection still showed stopped and
  autostart disabled. This is not an observed HTTP 503 response.
- Sanitized before/after metadata and recovery commands are recorded outside
  the repository at `/tmp/alfred-memory-retirement-20261021T041649Z-cfce661a.json`.
  No credentials or DB contents were accessed.

## Completion Conditions

- [x] Hosted machine cannot restart from incoming traffic; deploy workflow disabled.
- [x] Loopback-only server/CLI regression checks pass.
- [x] Console and static Pages behavior are validated.
- [x] Authenticated local HTTP CRUD smoke passes with temporary data.
- [x] Current docs and relevant canonical hosting guidance match the new contract.
- [x] Reviewer examines the implementation; validation limitations are recorded.

## Validation evidence

- Final focused run: **185 tests passed, 0 failed, 0 skipped**. Paths:
  `packages/memory-server/test/{server,serve-local,init-profiles,cli,console,neon-pooled-tenants,recovery-redirect,docker-production}.test.mjs`,
  `packages/gemini-adapter/test/*.mjs`, and
  `packages/console-web/test/*.test.mjs`.
- The isolated CLI smoke initializes a temporary SQLite tenant, requires auth,
  rejects an unauthenticated memory request, serves `/console/` at a nondefault
  assigned port, and exercises authenticated create/read/update/list/delete.
  Temporary registry, tenant files and child processes are removed afterwards.
- Direct `createServer().listen(...)` regressions verify safe defaults, local
  callback/options forms and rejection of public addresses and unsupported
  handles/paths. `localhost` normalizes to `127.0.0.1`; other IPv4 loopback aliases
  are validated, though this macOS host lacks an assigned `127.0.0.2` interface.
  Console API path tests cover aliases, IPv6 and custom ports without network.
- The shipped Gemini bridge starts on `127.0.0.1` with a temporary port and
  responds locally; its deliberately absent loopback upstream returns 502.
- Memory-server and Gemini package syntax/schema checks passed. Console build
  and HTML checks passed; the committed `dist/index.html` was rebuilt.
- Pages build/check passed for 21 HTML files. The generated Memory page contains
  static local-start instructions and no script, form or hosted API reference.
  `git diff --check` passed.

- Independent Reviewer runtime verification passed **22/22** server/CLI checks,
  including direct listen protection, custom-port authenticated CRUD, and an
  unauthenticated 401 response. The code/docs review passed after correcting the
  console README to describe persistent browser localStorage and logout cleanup.
- All six CI checks passed on PR #233 head
  `aa22f0951f09d592039ec37583b4ba74a6c8506f`, including real Postgres isolation.
  The subsequent factual documentation correction changes no runtime behavior;
  atomic edits and `git diff --check` validate this documentation-only follow-up.

## Validation limits

- Local validation used no package installation, live Postgres/SMTP access,
  Docker image build, or semantic-model download. Local Postgres fixture tests
  passed; CI separately verified real Postgres isolation. Live SMTP, a Docker
  build, and a semantic-model download remain untested. Absent optional
  `@xenova/transformers` uses the existing keyword fallback.
- Full root suites were not run because they include protected source imports.
  Eval baselines, installed artifacts, original main checkout and user data were
  not changed. Independent runtime review passed as recorded above.
- Operational probes establish no public response and a stopped machine with
  autostart disabled, not a particular HTTP error code or deletion of resources.

<!-- Trace: task_classified=issue-232-local-only-memory; role=developer; skill_loaded=typescript-project,architecture-docs; permission_allowed=user-authorized-local-only-product-and-scoped-source-of-truth-update; provider_request_avoided=deterministic-local-checks; operational-workflow-disabled=true; machine-autostart=false; data-preserved=true; original-main-checkout-writes=none; dependencies-installed=false. -->
