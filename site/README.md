# Alfred public site

The public static site introduces Workspace, Memory, and Agent Harness, their independent use, and explicit optional composition. It is documentation, not the Workspace application. Memory
pages at `/memory/` and `/memory/app/` contain local-start instructions only:
they do not collect API keys, run a console, or call a local/hosted Memory API.
The operational console is served by `alfred memory serve` at `/console/` in releases after 1.1.0; the existing `alfred serve` alias remains supported, including in 1.1.0.

## Build and check

```bash
npm run pages:build
npm run pages:check
```

The builder copies `site/` to `dist/cloudflare-pages/` and rewrites the `/alfred/` source
prefix according to `SITE_BASE_PATH` (default `/`). It does not build
or copy `packages/console-web/dist`. The checker verifies assets, navigation,
support links and the static Memory onboarding contract.

`.github/workflows/cloudflare-pages-deploy.yml` publishes this static output.
No Memory API URL is needed. The Fly Memory deployment workflow and Fly config
were retired; Pages does not deploy a Memory service.
