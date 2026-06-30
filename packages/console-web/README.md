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

Then set `ALFREED_API_BASE` to `https://alfred.example.com` and re-build.
