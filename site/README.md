# Alfred — Pages site

Static, no-build landing + docs + memory-console for Alfred, served
from **https://goi17.github.io/alfred/** via GitHub Pages.

## Deployed layout

```
https://goi17.github.io/alfred/
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

All internal links in `site/` are **absolute under `/alfred/`** so
they resolve correctly under the Pages subpath.

## Local preview

```sh
cd site
python3 -m http.server 8080
# open http://localhost:8080/landing/   (landing)
# open http://localhost:8080/landing/docs/
# open http://localhost:8080/landing/memory/
# open http://localhost:8080/landing/memory/app/
```

> **Note:** when previewing locally the absolute `/alfred/` paths
> point to `localhost:8080/alfred/`, not the root. Either symlink it
> (`ln -s . alfred`) or use the option below.

### Serve as if under `/alfred/`

```sh
cd site
mkdir -p .serve && ln -sfn .. alfred
python3 -m http.server 8080
# now /alfred/ resolves to site/
```

## Build the memory console with a real API base

The console SPA needs to know the URL of your self-hosted
`alfred serve` instance. Two ways to set it:

### Local dev (default)

```sh
# builds with ALFRED_API_BASE=http://localhost:3000
cd packages/console-web && npm run build
cp dist/index.html ../../site/memory/app/index.html
```

### Production (deployed Pages)

```sh
cd packages/console-web
ALFRED_API_BASE="https://alfred.example.com" npm run build
cp dist/index.html ../../site/memory/app/index.html
```

Then commit `site/memory/app/index.html` and push, or just push
`packages/console-web/**` and let the workflow rebuild.

## Deployment

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
