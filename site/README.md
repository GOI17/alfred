# Alfred — Pages site

Static landing, documentation, and Memory Console for Alfred.

- Current rollback host: **https://goi17.github.io/alfred/**
- Production host: **https://alfred.alfredlabs.org/** on Cloudflare Pages

The checked-in HTML remains compatible with the GitHub Pages `/alfred/`
subpath. `npm run pages:build` creates the root-hosted Cloudflare artifact in
`dist/cloudflare-pages/` without changing the source pages.

## Deployed layout

```
https://alfred.alfredlabs.org/
├── /                → site/index.html          (landing)
├── /assets/*        → site/assets/*            (CSS, favicon)
├── /docs/*          → site/docs/*              (documentation)
├── /memory/         → site/memory/index.html   (memory console landing)
└── /memory/app/     → built console-web SPA    (API-key manager)
```

The memory console is the existing standalone SPA from
`packages/console-web/`. The workflow rebuilds it on every push to
`main` (or via manual `workflow_dispatch` with a custom
`ALFRED_API_BASE`).

All internal links in `site/` are **absolute under `/alfred/`** for the
rollback deployment. The Cloudflare build rewrites that prefix to
`SITE_BASE_PATH` (`/` by default).

## Local preview

```sh
ALFRED_API_BASE=http://localhost:3000 npm run pages:build
npm run pages:check
python3 -m http.server 8080 --directory dist/cloudflare-pages
# open http://localhost:8080/
```

## Build the memory console with a real API base

The console SPA needs to know the URL of your self-hosted
`alfred serve` instance. Two ways to set it:

### Local dev

```sh
ALFRED_API_BASE=http://localhost:3000 npm run pages:build
```

### Production (deployed Pages)

```sh
ALFRED_API_BASE="https://alfred-labs-memory.fly.dev" npm run pages:build
npm run pages:check
```

The generated artifact is ignored by Git. The deployment workflow always
rebuilds it from source.

## Cloudflare Pages deployment

The workflow `.github/workflows/cloudflare-pages-deploy.yml` builds every
relevant pull request and deploys it when Cloudflare credentials are present.
`main` is production; other branches become preview deployments.

### One-time Cloudflare setup

1. Create a Direct Upload Pages project named `alfred` with production branch
   `main`:

   ```sh
   npx wrangler pages project create alfred --production-branch main
   ```

2. Add these GitHub Actions secrets:

   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN` with Cloudflare Pages edit permission

3. Optionally add these GitHub repository variables:

   - `CLOUDFLARE_PAGES_PROJECT=alfred`
   - `CLOUDFLARE_PAGES_BASE_PATH=/`
   - `ALFRED_API_BASE=https://alfred-labs-memory.fly.dev`

4. Add the production Pages origin to the Memory server and redeploy it:

   ```sh
   ALFRED_MEMORY_ALLOWED_ORIGINS=https://alfred.alfredlabs.org
   ALFRED_CONSOLE_URL=https://alfred.alfredlabs.org/memory/app/
   ```

   Include the custom-domain origin too when one is attached. The server uses
   exact origins, so a preview alias must be listed before testing authenticated
   Console calls from that preview.

### Verification and cutover

1. Run the workflow manually and verify `/`, `/docs/`, `/memory/`, and
   `/memory/app/` at the returned `pages.dev` preview URL.
2. Unlock the Console with an owner key and verify tenant/history requests.
3. Attach `alfred.alfredlabs.org` in Cloudflare and repeat the checks at the
   production domain.
4. Only then disable `.github/workflows/pages-deploy.yml` or GitHub Pages.

### Rollback

Keep GitHub Pages enabled until the custom domain has been stable. To roll back,
restore the previous DNS target; the `/alfred/` source paths and GitHub workflow
remain intact throughout the migration.

## GitHub Pages rollback deployment

Push to `main` (or run the workflow manually):

- **Trigger paths:** `site/**`, `packages/console-web/**`, the
  workflow file itself.
- **Permissions:** `pages: write`, `id-token: write` (workflow
  default; env: `github-pages`).
- **.nojekyll:** the workflow touches both `site/.nojekyll` and
  `dist/.nojekyll` so Pages serves files starting with `.` raw
  (we don't have any, but it's the safe default).
- **Concurrency:** one in-flight deploy at a time; new pushes cancel
  the in-flight run.

## Theme

All colors are CSS custom properties in `assets/styles.css`. The
Kanagawa / Darcula palette is defined in `:root`. To swap it, edit
that block.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#1f1f28` | background (sumi-ink 900) |
| `--bg-3` | `#2a2a37` | card surface |
| `--fg` | `#dcd7ba` | text (fuji white) |
| `--accent` | `#7e9cd8` | crystal blue (CTA, links) |
| `--accent-2` | `#957fb8` | onion violet |
| `--accent-4` | `#d27e99` | sakura pink |
| `--green` | `#98bb6c` | spring green |
| `--yellow` | `#e6c384` | autumn yellow |
| `--red` | `#e46876` | wave red |

## Files

```
site/
├── .nojekyll
├── _headers               ← Cloudflare response headers
├── _redirects             ← canonical trailing-slash routes
├── index.html              ← landing
├── README.md
├── assets/
│   ├── styles.css
│   └── favicon.svg
├── docs/
│   ├── index.html
│   ├── install.html
│   ├── configuration.html
│   ├── architecture.html
│   ├── agents.html
│   ├── skills.html
│   ├── memory.html
│   ├── security.html
│   ├── evals.html
│   ├── tracing.html
│   ├── permissions.html
│   └── harnesses-*.html
└── memory/
    ├── index.html          ← memory console landing (wraps the SPA)
    └── app/
        └── index.html      ← built console-web SPA
```

<!-- refreshed: 2026-07-02T01:20:29Z -->
