# Alfred Memory Console — Web v0.3.0

Standalone web console for Alfred Memory. Single static page (~12 KB)
that talks to your self-hosted Alfred Memory Server. Deployable to:

- **GitHub Pages** — push to `gh-pages` branch, set Pages to serve from `/`
- **Vercel** — connect this directory, builds automatically
- **Netlify** — connect this directory, builds automatically
- **Cloudflare Pages** — point Pages at this directory
- **Any static host** (S3, nginx, etc.) — `npm run build` then upload `dist/`

## Build

```bash
# Build with default API base (http://localhost:3000)
npm run build

# Build pointing at your production Alfred server
ALFRED_API_BASE=https://alfred.example.com npm run build

# Build with a custom key prefix in the page
ALFRED_API_BASE=https://alfred.example.com ALFRED_BUILD_VERSION=1.0.0 npm run build
```

The output is `dist/index.html`. That's the whole deployment.

## Local dev

```bash
npm run serve
# open http://localhost:4321
```

Set `ALFREED_API_BASE` before serving to point at your server.

## Deployment modes

The console is a single static page. It can be deployed in three ways:

### Static host (recommended)

Deploy `dist/index.html` to any static host: Vercel, Netlify, GitHub
Pages, Cloudflare Pages, S3, nginx, etc. After deployment, set on the
Alfred Memory Server:

```bash
export ALFRED_CONSOLE_URL=https://your-console-host.example.com
alfred serve
```

The server will redirect `/console` to that URL and continue to serve
the API under `/console/api/*`.

### Bundled with the server

If you prefer to ship the console and the API in the same process, build
the console and point the server at the `dist/` directory:

```bash
# Build
ALFRED_API_BASE=https://alfred.example.com npm run build

# Run the server with the dist path
export ALFRED_CONSOLE_DIR=/opt/alfred/console-web/dist
alfred serve
```

The server serves the same-origin HTML and the API from the same port.

### Local development

Run the server in dev mode (auto-discovery picks up the console from
the workspace) or use `npm run serve` to spin up a local Vite dev server.

## CORS

The Alfred Memory Server must allow your deployment's origin. If you
deploy to `https://alfred-console.vercel.app` and your server runs at
`https://alfred.example.com`, set on the server:

```
ALFRED_MEMORY_ALLOWED_ORIGINS=https://alfred-console.vercel.app
```

Without that, the browser will block API calls from the console.

## Authentication

The console asks the user to paste an API key (`alk_...`). The key is
stored in `localStorage` only — never sent to anyone except the Alfred
server the SPA is pointed at. The "Unlock" button validates the key by
calling `/console/api/tenants` and falling back to a known-endpoint check.
While unlocked, the **Current session** panel keeps the key masked by default
and provides explicit show, hide, and copy actions. **Log out** removes the
key from this browser and clears secret-bearing UI state; it does not revoke
the key for other browsers or connected agents.

## Deploy on GitHub Pages (most common)

1. Build the dist: `ALFRED_API_BASE=https://your-server npm run build`.
2. Commit the `dist/` folder to a `gh-pages` branch:
   ```bash
   git checkout -b gh-pages
   git add dist
   git commit -m "Deploy console"
   git push origin gh-pages
   ```
3. In GitHub: Settings → Pages → Source: `gh-pages` branch, `/` (root).
4. Open the URL GitHub gives you. Paste an API key.

You can also use the included `.nojekyll` file to ensure the dist serves
as static files.

## Deploy on Vercel

1. `vercel` from this directory (or connect the repo on the Vercel dashboard).
2. Set the environment variable `ALFRED_API_BASE` to your server's URL.
3. The included `vercel.json` tells Vercel to run `node scripts/build.mjs`
   and publish the `dist/` folder. No framework preset needed.

## Deploy on Netlify

1. `netlify deploy --dir=dist --prod` (after `npm run build`).
2. Or connect the repo on Netlify. The included `netlify.toml` configures
   the build command and publish directory.
3. Set the `ALFRED_API_BASE` env var in the Netlify dashboard.

## Deploy on Cloudflare Pages

The Alfred repository publishes the Console together with the landing page and
documentation using `.github/workflows/cloudflare-pages-deploy.yml`. Configure
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as GitHub Actions secrets,
then set the repository variable:

```text
ALFRED_API_BASE=https://alfred-labs-memory.fly.dev
```

For a standalone Console deployment, build this package and upload `dist/`:

```sh
ALFRED_API_BASE=https://alfred-labs-memory.fly.dev npm run build
npx wrangler pages deploy dist --project-name=alfred-console
```

Add the resulting `pages.dev` or custom-domain origin to
`ALFRED_MEMORY_ALLOWED_ORIGINS` on the Memory server before unlocking the
Console in a browser.

## Embedding the API key

For an internal team, you can hardcode an admin key in the build so users
don't have to paste one. Edit `src/index.html` and add:

```html
<script>window.ALFRED_DEFAULT_API_KEY = "alk_...";</script>
```

before the build script. The console will auto-fill the field.

(Don't publish this publicly — anyone can extract the key from the page.)

## Custom domain

After deploying, set a CNAME in your DNS to point at the host:

- GitHub Pages: `CNAME alfred-console.example.com -> <user>.github.io`
- Vercel/Netlify: use their dashboard
- Cloudflare Pages: attach the domain in Workers & Pages, then apply the DNS
  record Cloudflare provides

Then set `ALFREED_API_BASE` to `https://alfred.example.com` and re-build.

## History and connected agents

After unlocking, Memory history shows 25 saved memories per page with content,
creation/update times, source, tags, namespace and project ID. Filter by exact
namespace, project ID or memory type; applying different filters resets navigation.
Current saved records are shown, not an edit/deletion audit. The scrollable history
region is keyboard-focusable so activity remains reachable below it.

Connected agents shows server-observed requests, not registered credentials.
Connected means a request is open (maximum 5-minute observation lease); completed
requests are recently active for 60 seconds, then inactive. Interrupted requests
are disconnected and revoked credentials are labeled separately. Rows represent
credential/transport observations, potentially shared by several agents, from this
server process only; workspace membership is unknown. Restart, bounded capacity
and 24-hour retention can remove observations, so absence does not prove global
inactivity. API Keys shows credential validity independently.

Activity refreshes every 15 seconds while the page is visible, skipping pending
requests. Both views offer manual retry, mark snapshots with their observation or
refresh time, use no-store requests and a 10-second request timeout, and clear data
on failure or logout. Credential changes abort outstanding view requests and reject
late responses. Memory and client fields are rendered as escaped text.

Behavior checks: `node --test packages/console-web/test/*.mjs` from the repository
root; build with `node packages/console-web/scripts/build.mjs`.
