---
id: execution/cloudflare-pages-migration
description: Migrate Alfred's landing, documentation, and Memory Console from GitHub Pages to Cloudflare Pages.
phase: issue-104-cloudflare-pages
author: core
---

# Cloudflare Pages migration

## Goal

Publish Alfred's complete static site through Cloudflare Pages while preserving
GitHub Pages as a rollback target until production and DNS have been verified.

## Context

The source HTML is authored for the `/alfred/` GitHub project path. Cloudflare
Pages serves the project at the domain root. The Memory Console must also point
to the Alfred Memory API, not to the static host.

## Requirements

### R1: Deterministic site artifact

1. Build landing, documentation, Memory landing, and Memory Console into one directory.
2. Inject the selected Memory API base during the build.
3. Perform no provider calls.
4. Publish the completed directory atomically.

### R2: Hosting-neutral navigation

1. Keep `/alfred/` in source so the existing GitHub Pages deployment remains valid.
2. Rewrite that prefix to a configurable `SITE_BASE_PATH` in the generated artifact.
3. Use `/` by default for Cloudflare Pages and custom domains.

### R3: Cloudflare deployment

1. Build on pushes to `main`, pull requests, and manual dispatch.
2. Deploy with Wrangler using repository secrets.
3. Use `main` as the production branch and other branches as previews.
4. Skip external deployment when credentials are unavailable while still validating the build.

### R4: Safe cutover

1. Keep GitHub Pages active during verification.
2. Document Cloudflare project creation, GitHub secrets, API CORS, DNS cutover, and rollback.
3. Do not embed API keys or Cloudflare credentials in the artifact.
4. Use `https://alfred.alfredlabs.org` as the production site origin and
   `https://alfred.alfredlabs.org/memory/app/` as the external Console URL.

## Completion conditions

- [x] One root-hosted artifact contains all required pages.
- [x] The Memory Console API base is configurable and validated.
- [x] Cloudflare headers and canonical slash redirects are included.
- [x] GitHub Actions supports production and preview deployments.
- [x] Cutover and rollback are documented.
- [x] Repository production configuration targets
      `https://alfred.alfredlabs.org`.
- [ ] Cloudflare credentials are configured by the repository owner.
- [ ] The `alfred.alfredlabs.org` custom domain and first production deployment
      are verified by the repository owner.

## References

- Issue: `#104`
- Existing deployment: `.github/workflows/pages-deploy.yml`
- Site source: `site/`
- Console source: `packages/console-web/`
