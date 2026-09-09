---
id: execution/remove-legacy-pages-actions
description: Retire redundant GitHub Pages deployments after the Cloudflare Pages migration.
phase: issue-213-remove-legacy-pages-actions
author: core
issue: 213
---

# Remove legacy GitHub Pages actions

## Goal

Keep one authoritative frontend delivery path for Alfred's landing site,
documentation, and Memory Console: Cloudflare Pages.

## Audit findings

1. `pages-deploy` fails in `actions/configure-pages` because GitHub Pages is
   not enabled for the repository.
2. `console-web` fails in its deploy job while checking out the private
   repository because that job replaces the default token permissions without
   granting `contents: read`.
3. Both deployments are redundant. `cloudflare-pages-deploy` already builds,
   validates, and publishes the complete `site/` tree plus the built Memory
   Console at `/memory/app/`.
4. Recent Cloudflare, Postgres, Homebrew, installer, release, Fly, and linked
   issue workflows are retained because they cover distinct responsibilities.
5. `action_required` entries on Release Please pull requests are GitHub's
   approval gate for runs triggered by `github-actions[bot]`; they contain no
   failed job and are not evidence that those workflows are defective.

## Changes

- Delete `.github/workflows/pages-deploy.yml`.
- Delete `.github/workflows/console-deploy.yml`.
- Leave `.github/workflows/cloudflare-pages-deploy.yml` as the sole frontend
  deployment workflow.

## Acceptance criteria

- [x] The Cloudflare Pages artifact builds and validates locally.
- [x] Every remaining workflow parses as YAML.
- [x] No remaining workflow deploys to GitHub Pages.
- [x] Unrelated workflows and existing user worktrees remain unchanged.

<!-- Trace: task_classified=ci-configuration-cleanup; delegation=none-small-config-task; provider_request_avoided=local-only; permission_allowed=issue-213-worktree-and-workflow-files; deployment-authority=cloudflare-pages -->
