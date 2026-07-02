# Deploying Alfred Memory to Fly.io

This is the official deploy path for Alfred Memory v0.4.1. It assumes
**zero prior Fly.io knowledge** and walks you from `git clone` to a
live HTTPS endpoint in roughly 15 minutes.

Total cost during the free tier: **$0/month** (with 256MB RAM, 1GB
Postgres storage, and 1GB persistent volume). Move to paid only when
you outgrow the free tier — see "When to scale" at the end.

## 0. Prerequisites

You need:

- A Fly.io account (free; the free tier requires a credit card on file
  but you will not be charged as long as you stay within limits).
- The `flyctl` CLI installed locally.
- A domain you control (optional but recommended for the GPT Store).

```sh
# Install flyctl (macOS, others: https://fly.io/docs/hands-on/install-flyctl/)
brew install flyctl

# Or: curl -L https://fly.io/install.sh | sh

# Sign up (opens browser)
flyctl auth signup
```

If you already have an account:

```sh
flyctl auth login
```

## 1. Create the app

The repo is already configured to deploy. From the project root:

```sh
cd /path/to/alfred

# Pick a unique app name. Suggestions: alfred-{your-name}, alfred-{org}.
# The name becomes your URL: alfred-your-name.fly.dev
flyctl launch --no-deploy
```

`flyctl launch` will read `fly.toml` and ask you to confirm:

- **App name**: change to your unique name
- **Region**: `gru` (São Paulo) for Mexico, or `eze` (Buenos Aires)
- **Postgres**: decline (we'll create it separately in step 2)
- **Redis**: decline

When it asks "Would you like to deploy now?", say **No** (`--no-deploy`
does this for you, but just in case).

## 2. Create the Postgres database (free tier)

```sh
# 1. Create the database. --region must match the app's primary_region.
flyctl postgres create --name alfred-db --region gru
# It will print: postgres://...:...@...-alfred-db.flycast/alfred_db?sslmode=disable

# 2. Attach it to your app. This sets DATABASE_URL automatically.
flyctl postgres attach alfred-db

# 3. Create a second database for the SaaS Web Onboarding flow.
#    Bootstrap creates per-tenant schemas in this DB.
flyctl postgres connect alfred-db -- -c "CREATE DATABASE alfred_saas;"

# 4. Get the connection string for alfred_saas (run the same query
#    against the new DB).
DATABASE_URL=$(flyctl postgres connect alfred-db -- -c "SELECT current_database();" 2>/dev/null && \
  flyctl secrets get DATABASE_URL)
# Set the SaaS URL — it points to alfred_saas on the same cluster:
# Replace the trailing /alfred_db with /alfred_saas in DATABASE_URL.
```

## 3. Create the persistent volume (for SQLite)

The free tier includes 1GB of persistent volume per app. We use it to
store the alfred_registry SQLite file. Without it, you lose all
tenants on every restart.

```sh
flyctl volumes create alfred_data --size 1
```

The volume is referenced in `fly.toml` as `source = "alfred_data"` and
mounted at `/app/data` inside the container.

## 4. Set the secrets

Secrets are environment variables that Fly encrypts at rest. Run:

```sh
flyctl secrets set \
  ALFRED_MEMORY_HOSTING=self-hosted \
  ALFRED_PUBLIC_URL="https://alfred-your-name.fly.dev" \
  ALFRED_SAAS_DATABASE_URL="postgres://...alfred_saas" \
  ALFRED_SMTP_HOST="smtp.gmail.com" \
  ALFRED_SMTP_PORT="587" \
  ALFRED_SMTP_USER="your-account@gmail.com" \
  ALFRED_SMTP_PASSWORD="your-gmail-app-password" \
  ALFRED_SMTP_FROM="your-account@gmail.com" \
  ALFRED_TURNSTILE_SITE_KEY="1x00000000000000000000AA" \
  ALFRED_TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA" \
  ALFRED_MEMORY_ALLOWED_ORIGINS="https://chat.openai.com,https://chatgpt.com"
```

Notes:

- **Gmail SMTP**: use an App Password, not your real Gmail password.
  https://myaccount.google.com/apppasswords
- **Turnstile**: Cloudflare's free test keys. Get real ones at
  https://dash.cloudflare.com → Turnstile when you go to production.
- **`ALFRED_PUBLIC_URL`** must match your actual domain.

## 5. Deploy

```sh
flyctl deploy
```

This will:

1. Build the Docker image locally (or remotely if you pass `--remote-only`).
2. Push it to Fly's registry.
3. Run `migrate-on-boot.mjs` (idempotent schema bootstrap).
4. Start the server on port 8080 inside the VM.
5. Wire up the public HTTP and HTTPS edges (port 80 + 443).
6. Run the health check: `GET /health` every 30s. If it fails 3 times,
   Fly rolls back to the previous version.

Expected output (last 10 lines):

```
==> Monitoring deployment...
1 desired, 1 placed, 1 healthy, 0 unhealthy
```

## 6. Verify

```sh
# Health check
curl https://alfred-your-name.fly.dev/health
# {"status":"ok","version":"0.4.1","mode":"openapi"}

# Agent manifest (public, no auth)
curl https://alfred-your-name.fly.dev/agents/manifest | head -c 200

# Open the console in a browser
open https://alfred-your-name.fly.dev/console
```

You should see:

- A signup form (if `ALFRED_SAAS_DATABASE_URL` is set).
- The "paste your API key" view (the default).
- A health badge in the corner.

## 7. CI auto-deploy (optional)

To deploy on every push to `main`:

1. Get a Fly API token:

   ```sh
   flyctl auth token
   ```

2. Add it to GitHub: https://github.com/GOI17/alfred/settings/secrets/actions
   - Name: `FLY_API_TOKEN`
   - Value: the token from step 1

3. Push to `main`. The `.github/workflows/deploy-fly.yml` workflow will:

   - Run `validate:policies` and `validate:release-0.4.1`
   - `docker buildx build --check` to catch Dockerfile errors
   - `flyctl deploy --remote-only`
   - Smoke-test the new release with a `GET /health`

## 8. Custom domain (for the GPT Store)

The default URL `alfred-your-name.fly.dev` works for the Custom GPT
during development. For production:

1. Buy a domain (Namecheap, Cloudflare Registrar, Porkbun, etc).
2. Add an A record pointing to Fly's anycast IP. The exact value is
   shown after:

   ```sh
   flyctl ips list
   ```

3. Or use Fly's automatic Let's Encrypt certificate:

   ```sh
   flyctl certs create alfred.your-domain.com
   ```

4. Update `ALFRED_PUBLIC_URL` in your secrets:

   ```sh
   flyctl secrets set ALFRED_PUBLIC_URL="https://alfred.your-domain.com"
   ```

5. Update the OpenAPI in `packages/memory-openapi/openapi.yaml` →
   `servers[0].url` to match.

6. In the GPT editor, update the Action's URL.

## 9. Observability

```sh
# Live logs
flyctl logs

# Or with filtering
flyctl logs --app alfred-your-name | grep -E 'rate_limited|forbidden'

# Metrics
flyctl dashboard

# Status
flyctl status
```

Logs are kept for 7 days on the free tier. If you need longer,
ship them to Logtail or a similar service via the `fly-logs` plugin.

## 10. Backup the registry

The SQLite registry lives in `/app/data/registry.sqlite` on the
persistent volume. To back it up:

```sh
# Snapshot the volume (paid feature, ~$0.04/GB/month)
flyctl volumes snapshots create alfred_data

# Or copy the file out via sftp
flyctl sftp shell
> get /app/data/registry.sqlite /tmp/alfred-registry-backup.sqlite
> exit
```

The free tier does not include automatic snapshots. For production,
upgrade to a paid plan or set up an offsite backup via cron.

## 11. When to scale

| Signal | Action |
|---|---|
| Cold start > 1s on every request | Set `min_machines_running = 1` in fly.toml. Costs $0.50-2/day. |
| Memory > 80% | Bump `memory_mb` to 512 or 1024. |
| Postgres > 2GB | Upgrade to paid tier ($5-15/mo for 10GB). |
| Region latency > 200ms | Add a region: `flyctl regions add iad` etc. |
| Steady > 100 users | Consider 2+ machines with the load balancer (built into Fly). |
| > 10K users | Migrate to a managed Postgres (Crunchy, Supabase, Neon) and run Alfred as a stateless container. |

## 12. Teardown

If you want to stop paying for anything (even free tier allocations):

```sh
flyctl apps destroy alfred-your-name
# Confirms with "Destroy app alfred-your-name?": type the app name

flyctl postgres destroy alfred-db
flyctl volumes destroy alfred_data
```

This removes everything. Re-run step 1-5 to bring it back.
