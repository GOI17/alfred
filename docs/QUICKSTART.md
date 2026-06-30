# Alfred Memory — Quick Start (5 minutes)

If you have never used a terminal before, follow this guide. It assumes
nothing except that you have Node 22+ installed on your computer.

## 0. Install Node 22+ (one-time)

Download from <https://nodejs.org>. Choose the LTS version. On macOS, the
`.pkg` installer is fine. After installing, open a fresh terminal (on macOS:
`Cmd+Space`, type "Terminal", press Enter) and run:

```sh
node -v
# should print something like v22.x or v24.x
```

## 1. Decide what you want

Pick **one** of these profiles:

| Profile | What it does | What you need |
|---|---|---|
| `web` | Use Alfred Memory from ChatGPT / Claude / Gemini. **No coding tools needed.** | A Postgres database URL (free tier from Neon or Supabase). |
| `coding` | Use Alfred Memory from a coding agent (opencode, Codex, Pi). | Nothing extra. |
| `both` | Use Alfred Memory from both kinds of agents. | A Postgres database URL. |

If you just want to try it out without a database, use `coding`. It creates
a local SQLite file you can keep on your computer.

## 2. Run the installer

Open a terminal. Pick a folder where you want Alfred's code to live. The
default is `~/.alfred`.

### Web profile (most common)

```sh
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --profile=web --name=my-mem
```

The installer will ask for your Postgres connection string. It looks like:
`postgres://user:pass@host/dbname?sslmode=require`. Get this from your
database provider's dashboard.

If you don't have a Postgres database yet, you can sign up for a free
tier on:

- <https://neon.tech> (serverless Postgres, free tier)
- <https://supabase.com> (full platform, free tier)
- <https://render.com> (managed Postgres)

### Coding profile (no database needed)

```sh
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --profile=coding --name=acme
```

This creates a SQLite file under `~/.alfred/tenants/acme.sqlite`. No
network calls.

## 3. Save the API key

The installer will print a long string that looks like:
`alk_Em8DQ4gKm8075gAm4Vl589h3n-qK_jkS`. **This is shown only once.**
Copy it and paste it into a password manager, or email it to yourself,
or just leave it in the terminal.

## 4. Open the web console (optional, recommended)

If you started the server with `--start-server`, you can open:

<http://localhost:3000/console>

Paste the API key into the field at the top. You'll see the list of your
tenants, the API keys, and copy-paste instructions for connecting each
agent.

### Recommended deploy: Vercel + self-hosted API

The cleanest production setup is to host the console on a static host
(Vercel, Netlify, GitHub Pages) and your memory API on your own server.

```sh
# 1. Build the console pointing at your API
cd packages/console-web
ALFRED_API_BASE=https://alfred.example.com npm run build
# upload dist/ to Vercel (drag-and-drop works)
# Result: https://alfred-console.vercel.app

# 2. On the API server, tell it where the console lives
export ALFRED_CONSOLE_URL=https://alfred-console.vercel.app
alfred serve
# Visiting https://alfred.example.com/console now redirects to the
# Vercel deployment, and /console/api/* still works locally.

# 3. Tell the API to allow the console's origin
export ALFRED_MEMORY_ALLOWED_ORIGINS=https://alfred-console.vercel.app
```

If you don't want to manage two deployments, set `ALFRED_CONSOLE_DIR`
to the built `dist/` path and the server serves both HTML and JSON from
the same port (no CORS needed).

## 5. Connect a service

### ChatGPT (Plus / Pro / Enterprise)

1. Open <https://chat.openai.com/gpts/editor> → Create a GPT.
2. Configure → Actions → **Import OpenAPI** → upload
   `~/.alfred/packages/chatgpt-adapter/openapi.json`.
3. Authentication: **API Key** · **Bearer** · paste your `alk_...` key.
4. Save, then in the GPT Builder test: "list my last 5 memories".

### Claude Desktop

1. Quit Claude Desktop.
2. Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
   (on macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).
3. Add this entry:
   ```json
   {
     "mcpServers": {
       "alfred-memory": {
         "command": "node",
         "args": ["~/.alfred/packages/anthropic-adapter/bin/alfred-mcp.mjs"],
         "env": {
           "ALFRED_MEMORY_API_KEY": "alk_...",
           "ALFRED_MEMORY_BASE_URL": "http://localhost:3000"
         }
       }
     }
   }
   ```
4. Restart Claude Desktop. The tools appear in the conversation panel.

### Google Gemini / AI Studio

1. Open <https://aistudio.google.com> → Tools → Extensions → Create Extension.
2. Upload `~/.alfred/packages/gemini-adapter/openapi.json`.
3. Auth: API Key · header `x-api-key` · paste your `alk_...` key.
4. Save, then test the extension from a prompt.

### Coding agents (opencode, Codex, Pi)

1. `cd` into your project directory.
2. Run `alfred init --profile=coding --name=<project>`.
3. This writes `.alfred/config.json` in your project.
4. The agent picks it up automatically on the next session.

## 6. Get more keys or rotate

```sh
# Get a fresh key (rotates the old one)
alfred keys issue --tenant=<id> --label="chatgpt-laptop"

# List all keys
alfred key list --tenant=<id> --include-revoked

# Revoke a key
alfred key revoke --key=<key_id>

# Open the dashboard
alfred dashboard
```

## 7. Self-host in production

For multi-machine setups (e.g. your laptop and a cloud server sharing
memory), the `self-hosted` mode runs Alfred over HTTPS. The minimum setup:

```sh
export ALFRED_MEMORY_HOSTING=self-hosted
export ALFRED_MEMORY_PORT=443
export ALFRED_MEMORY_BIND=0.0.0.0
export ALFRED_MEMORY_TLS_CERT=/path/to/fullchain.pem
export ALFRED_MEMORY_TLS_KEY=/path/to/privkey.pem
export ALFRED_MEMORY_ALLOWED_ORIGINS=https://chat.openai.com,https://claude.ai
export ALFRED_MEMORY_DB=postgres://user:pass@dbhost/dbname
alfred serve
```

For high availability, put the server behind nginx or Caddy. Backups: run
`pg_dump $ALFRED_MEMORY_DB` daily.

## 8. Where to go from here

- **Documentation index**: <https://github.com/GOI17/alfred>
- **Architecture**: `.ai/architecture/memory-hosting-modes.md`
- **Policies**: `.ai/policies/memory-hosting-policy.md` and
  `.ai/policies/memory-workspace-policy.md`
- **Roadmap**: `.ai/roadmaps/0.3.0.md`
