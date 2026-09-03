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
  ALFRED_SMTP_HOST="smtp.resend.com" \
  ALFRED_SMTP_PORT="465" \
  ALFRED_SMTP_USER="resend" \
  ALFRED_SMTP_PASSWORD="<Resend sending-only key restricted to alfredlabs.org>" \
  ALFRED_SMTP_FROM="Alfred Memory <recovery@alfredlabs.org>" \
  ALFRED_TURNSTILE_SITE_KEY="1x00000000000000000000AA" \
  ALFRED_TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA" \
  ALFRED_MEMORY_ALLOWED_ORIGINS="https://chat.openai.com,https://chatgpt.com"
```

Notes:

- **Transactional email**: AlfredLabs production uses Resend's authenticated
  SMTP relay. The SMTP password is a Resend API key with `Sending access`
  restricted to `alfredlabs.org`; it is not a personal mailbox credential.
- **Cost**: Resend Free includes 3,000 transactional messages per month with a
  100-message daily limit. The first paid transactional tier is Pro at
  $20/month for 50,000 messages, with $0.90 per additional 1,000. Confirm
  current pricing before approving a purchase.
- **Recovery readiness**: production deploys require the complete five-value
  SMTP configuration. `POST /console/api/recover` returns
  `503 recovery_unavailable` before any email lookup when the transport cannot
  authenticate, so it does not falsely claim that a message was sent.
- **Turnstile**: Cloudflare's free test keys. Get real ones at
  https://dash.cloudflare.com → Turnstile when you go to production.
- **`ALFRED_PUBLIC_URL`** must match your actual domain.

### AlfredLabs sender approval gate

Do not create the Resend account/domain, buy a plan, change DNS, rotate a
GitHub/Fly secret, deploy, or send a production test until a human explicitly
approves the corresponding action. Repository preparation and public DNS
inspection do not grant that authority.

The selected identity and transport are:

| Setting | Exact value |
|---|---|
| Provider/domain | Resend; verify `alfredlabs.org` in North Virginia (`us-east-1`) |
| Visible From | `Alfred Memory <recovery@alfredlabs.org>` |
| SMTP host | `smtp.resend.com` |
| SMTP port/security | `465`, implicit TLS |
| SMTP username | `resend` |
| SMTP password | Resend sending-only key restricted to `alfredlabs.org` |

The current primary-source comparison for this low-volume recovery workload
is:

| Provider | Entry cost | Relevant tradeoff |
|---|---:|---|
| **Resend (selected)** | $0 for 3,000/month, capped at 100/day; Pro is $20/month for 50,000 | Fits the existing SMTP adapter and supports a domain-restricted sending key. The free tier uses shared IPs and retains email data for 30 days. |
| Postmark | $0 for 100/month; Basic is $15/month for 10,000 | Transactional message streams and per-stream SMTP tokens are strong operational boundaries, but the useful free allowance is much smaller and the first paid tier has a fixed monthly cost. |
| Amazon SES Essentials | $0.16 per 1,000 messages at the first volume band | Lowest variable cost at scale, but adds AWS region/IAM, SMTP-credential, identity, custom MAIL FROM, and account-operability surface for a tiny workload. |

Sources: [Resend pricing](https://resend.com/pricing?product=transactional),
[Resend API-key permissions](https://resend.com/docs/dashboard/api-keys/introduction),
[Postmark pricing](https://postmarkapp.com/pricing/), and
[Amazon SES pricing](https://aws.amazon.com/ses/pricing/). Resend is selected
for the smallest operational change and a $0 starting cost, not because it is
the cheapest option at high volume.

As of 2026-09-02, public DNS already has Cloudflare Email Routing MX records
and `v=spf1 include:_spf.mx.cloudflare.net ~all` at the root. Keep those
records. Enter the Resend records manually so Resend receives no broad
Domain Connect permission:

| Type | Cloudflare name | Content | Priority | Proxy |
|---|---|---|---:|---|
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 | DNS only |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — | DNS only |
| TXT | `resend._domainkey` | `p=<exact public key generated by Resend>` | — | DNS only |
| TXT | `_dmarc` | `v=DMARC1; p=none; adkim=r; aspf=r; pct=100` | — | DNS only |

The DKIM public key does not exist until the approved Resend domain is
created. At that point, copy the full provider-generated TXT value into the
plan and obtain DNS-change approval before publishing any record. It is public
key material, but it must still never be guessed or truncated. Do not enable
Resend inbound email; the root MX records remain owned by Cloudflare Email
Routing.

The initial DMARC `p=none` policy proves alignment without risking rejection
of legitimate mail that has not yet been inventoried. It monitors rather than
blocking spoofed mail; moving to `quarantine` and then `reject` is a separate,
approval-gated hardening step after authentication evidence is stable.

After Resend reports SPF and DKIM verified, create a key named
`alfred-memory-production` with `Sending access` restricted to
`alfredlabs.org`. Store its value only as:

- GitHub Actions secret: `ALFRED_RESEND_SMTP_PASSWORD`.
- Fly runtime secret: `ALFRED_SMTP_PASSWORD` (the deploy workflow maps the
  GitHub secret to this provider-neutral runtime name).

The deploy workflow fixes the other four `ALFRED_SMTP_*` values to the
reviewed non-secret configuration above and imports all OAuth/SMTP values in
one staged operation. After a successful Resend delivery check, remove the
five superseded `ALFRED_SMTP_*` entries from GitHub Actions (the workflow no
longer reads them). The Fly values keep those provider-neutral names and are
overwritten atomically by the new deployment. Never print old or new
credential values while rotating.

Verification after the approved deploy:

1. Confirm the Resend domain status is `verified` for SPF and DKIM.
2. Query public DNS for `send.alfredlabs.org`,
   `resend._domainkey.alfredlabs.org`, and `_dmarc.alfredlabs.org` and compare
   every value with the approved plan.
3. Request recovery for the registered Gmail test recipient without logging
   its address, recovery URL, token, or generated key.
4. In Gmail, open **Show original** and require `spf=pass`, `dkim=pass` with
   `header.d=alfredlabs.org`, and `dmarc=pass` with
   `header.from=alfredlabs.org`.
5. Confirm the visible From is exactly
   `Alfred Memory <recovery@alfredlabs.org>` and the recovery link works.

To enable direct ChatGPT OAuth, first create the Custom GPT Action and copy
the exact callback URLs it displays. Then set all OAuth values together;
setting only some of them intentionally prevents startup:

```sh
flyctl secrets set \
  ALFRED_OAUTH_CLIENT_ID="alfred-chatgpt" \
  ALFRED_OAUTH_CLIENT_SECRET="<random value of at least 32 characters>" \
  ALFRED_OAUTH_REDIRECT_URIS="https://chatgpt.com/aip/g-YOUR-GPT-ID/oauth/callback,https://chat.openai.com/aip/g-YOUR-GPT-ID/oauth/callback"
```

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

   Add `ALFRED_RESEND_SMTP_PASSWORD` as an Actions secret. The workflow owns
   the four reviewed, non-secret SMTP values, validates OAuth and the Resend
   credential as one complete production configuration, and stages them
   together before deploying.

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
