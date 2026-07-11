#!/bin/sh
# Alfred Memory installer. One-shot, no dependencies beyond Node 22+.
#
# USAGE
#   curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --profile=web --name my-mem
#   curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --profile=coding --path ~/clients/acme
#
# WHAT IT DOES
#   1. Clones (or reuses) the Alfred repo into a target path.
#   2. Runs `alfred init` with the requested profile.
#   3. Optionally starts the server + bridge in the background.
#   4. Prints the API key and integration steps.
#
# FLAGS
#   --profile=<coding|web|both>   Default: web (most common, no coding deps)
#   --name <name>                 Display name for the tenant
#   --path <dir>                  Where to clone the repo. Default: ~/.alfred
#   --start-server                Start alfred serve in the background after init
#   --no-clone                    Assume repo already exists at --path
#   --registry <path>             Override registry path
#   --dry-run                     Preview install and model assignment without writes
#   --skip-models                 Skip model assignment preview
#   --accept-model-defaults       Write proposed ~/.alfred/models.json atomically
#   --help                        Show this message
#
# Requires Node 22+. macOS / Linux supported.

set -e

VERSION="0.3.0"
REPO_URL="https://github.com/GOI17/alfred.git"
NODE_MIN="22"

# Default flags.
PROFILE="web"
NAME=""
TARGET_PATH="$HOME/.alfred"
START_SERVER=false
NO_CLONE=false
DRY_RUN=false
SKIP_MODELS=false
ACCEPT_MODEL_DEFAULTS=false
REGISTRY_PATH=""
CWD_OVERRIDE=""

for arg in "$@"; do
  case "$arg" in
    --profile=*)  PROFILE="${arg#*=}" ;;
    --name=*)     NAME="${arg#*=}" ;;
    --path=*)     TARGET_PATH="${arg#*=}" ;;
    --registry=*) REGISTRY_PATH="${arg#*=}" ;;
    --cwd=*)      CWD_OVERRIDE="${arg#*=}" ;;
    --start-server) START_SERVER=true ;;
    --no-clone)    NO_CLONE=true ;;
    --dry-run)     DRY_RUN=true ;;
    --skip-models) SKIP_MODELS=true ;;
    --accept-model-defaults) ACCEPT_MODEL_DEFAULTS=true ;;
    --help|-h)     sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "[alfred] Unknown flag: $arg (use --help)"; exit 2 ;;
  esac
done

log()  { printf "[alfred] %s\n" "$*"; }
err()  { printf "[alfred][error] %s\n" "$*" 1>&2; exit 1; }
note() { printf "[alfred] %s\n" "$*"; }

model_config_json() {
  node --input-type=module <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const env = process.env;
const home = os.homedir();
const detected = [];
const add = (provider, model, source) => detected.push({ provider, model, source });
const firstEnv = (names) => names.find((name) => typeof env[name] === "string" && env[name].trim() !== "");

if (env.OLLAMA_HOST && env.OLLAMA_HOST.trim() !== "") {
  add("ollama", "ollama/qwen2.5-coder:7b", "env:OLLAMA_HOST");
} else {
  const sockets = ["/var/run/ollama.sock", "/tmp/ollama.sock", path.join(home, ".ollama", "ollama.sock")];
  const socket = sockets.find((candidate) => fs.existsSync(candidate));
  if (socket) add("ollama", "ollama/qwen2.5-coder:7b", `socket:${socket}`);
}

const openai = firstEnv(["OPENAI_API_KEY"]);
if (openai) add("openai", "openai/gpt-4.1-mini", `env:${openai}`);
const copilot = firstEnv(["GITHUB_COPILOT_TOKEN", "COPILOT_TOKEN"]);
if (copilot) add("copilot", "copilot/gpt-4.1", `env:${copilot}`);
const anthropic = firstEnv(["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]);
if (anthropic) add("anthropic", "anthropic/claude-sonnet-4", `env:${anthropic}`);
const gemini = firstEnv(["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]);
if (gemini) add("gemini", "gemini/gemini-2.5-flash", `env:${gemini}`);

const providerOrder = ["ollama", "openai", "gemini", "copilot", "anthropic"];
const fallbacks = [...new Set(providerOrder.flatMap((provider) => detected.filter((item) => item.provider === provider).map((item) => item.model)))];
const pick = (providers) => providers.map((provider) => detected.find((item) => item.provider === provider)).find(Boolean);
const wildcard = pick(["ollama", "openai", "gemini", "copilot", "anthropic"]);
const capable = pick(["anthropic", "openai", "copilot", "gemini", "ollama"]);
const config = {};
if (wildcard) config["*"] = { primary: wildcard.model, fallbacks: fallbacks.filter((model) => model !== wildcard.model) };
if (capable && capable.model !== config["*"]?.primary) {
  config.orchestrator = { primary: capable.model };
  config.developer = { primary: capable.model };
}
config.fallbacks = fallbacks;
console.log(JSON.stringify({ detected, config }, null, 2));
NODE
}

preview_model_assignment() {
  if [ "$SKIP_MODELS" = true ]; then
    log "Skipping model assignment preview."
    return 0
  fi
  log "Model assignment preview (no harness config writes):"
  MODEL_PREVIEW="$(model_config_json)"
  printf '%s\n' "$MODEL_PREVIEW"
  log "Proposed target: $HOME/.alfred/models.json"
  log "Trace events: model_assignment_configured, provider_request_avoided (provider_calls=0)"
}

write_model_assignment() {
  target="$HOME/.alfred/models.json"
  trace_file="$HOME/.alfred/observability/model-assignment-trace.json"
  mkdir -p "$(dirname "$target")" "$(dirname "$trace_file")"
  tmp_file="${target}.$$.tmp"
  trace_tmp="${trace_file}.$$.tmp"
  model_config_json | node --input-type=module -e 'let input=""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => { const preview = JSON.parse(input); process.stdout.write(JSON.stringify(preview.config, null, 2) + "\n"); });' > "$tmp_file"
  mv "$tmp_file" "$target"
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%NZ")
  printf '{\n  "trace_id": "model-assignment-configuration",\n  "timestamp": "%s",\n  "event": "model_assignment_configured",\n  "actor": "alfred-installer",\n  "data": { "target_path": "%s", "action": "write", "provider_calls": 0 }\n}\n' "$timestamp" "$target" > "$trace_tmp"
  mv "$trace_tmp" "$trace_file"
  log "Wrote model assignment config: $target"
  log "Wrote trace: $trace_file"
}

# Node check.
NODE_VERSION="$(node -v 2>/dev/null || true)"
if [ -z "$NODE_VERSION" ]; then
  err "Node.js is not on PATH. Install Node 22+ first (https://nodejs.org)."
fi
NODE_MAJOR="$(printf '%s' "$NODE_VERSION" | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt "$NODE_MIN" ] 2>/dev/null; then
  err "Node $NODE_VERSION found, but $NODE_MIN+ required."
fi

if [ "$DRY_RUN" = true ]; then
  log "DRY-RUN MODE: no files will be modified."
  log "Would install Alfred v$VERSION into $TARGET_PATH with profile $PROFILE."
  preview_model_assignment
  exit 0
fi

# Clone or reuse.
if [ "$NO_CLONE" = true ] && [ -d "$TARGET_PATH" ]; then
  log "Reusing existing repo at $TARGET_PATH"
else
  if [ -d "$TARGET_PATH/.git" ]; then
    log "Repo already cloned at $TARGET_PATH. Pulling latest."
    (cd "$TARGET_PATH" && git pull --ff-only 2>/dev/null || true)
  else
    log "Cloning Alfred v$VERSION into $TARGET_PATH ..."
    if command -v git >/dev/null 2>&1; then
      git clone --depth 1 --branch "v$VERSION" "$REPO_URL" "$TARGET_PATH" 2>/dev/null || \
        git clone --depth 1 "$REPO_URL" "$TARGET_PATH"
    else
      err "git is required. Install git or use --no-clone with the repo pre-cloned."
    fi
  fi
fi

# Resolve registry path.
if [ -z "$REGISTRY_PATH" ]; then
  REGISTRY_PATH="$HOME/.alfred/registry.sqlite"
fi
export ALFRED_MEMORY_REGISTRY="$REGISTRY_PATH"
mkdir -p "$(dirname "$REGISTRY_PATH")"

# Build init args.
INIT_ARGS="--profile=$PROFILE --non-interactive"
if [ -n "$NAME" ]; then INIT_ARGS="$INIT_ARGS --name=$NAME"; fi
if [ -n "$CWD_OVERRIDE" ]; then INIT_ARGS="$INIT_ARGS --cwd=$CWD_OVERRIDE"; fi

case "$PROFILE" in
  coding)
    WORKSPACE_PATH="${CWD_OVERRIDE:-$PWD}"
    INIT_ARGS="$INIT_ARGS --cwd=$WORKSPACE_PATH"
    # Default: derive a per-tenant sqlite file under the install dir.
    if [ -z "$NAME" ]; then NAME="alfred-coding-$(date +%F)"; fi
    if [ -z "$CWD_OVERRIDE" ]; then
      CWD_OVERRIDE="$WORKSPACE_PATH"
    fi
    ;;
  web)
    # No workspace binding. We just need a tenant + key. Postgres is required
    # by hosting policy for human_agent, but if the operator has no Postgres
    # we fall back to SQLite+human_agent as bootstrap, which is rejected by
    # the registry. So in the installer we prompt for a connection string.
    if [ -z "${ALFRED_MEMORY_DB:-}" ]; then
      printf "[alfred] Web profile requires a Postgres connection. Set ALFRED_MEMORY_DB=postgres://user:pass@host/db or pass --db-connection.\n" 1>&2
      if [ -t 0 ]; then
        printf "Postgres URL: "
        read -r DB_URL
      else
        DB_URL=""
      fi
      if [ -z "$DB_URL" ]; then
        err "No Postgres URL provided. Set ALFRED_MEMORY_DB and re-run."
      fi
      export ALFRED_MEMORY_DB="$DB_URL"
    fi
    INIT_ARGS="$INIT_ARGS --db-connection=$ALFRED_MEMORY_DB"
    ;;
  both)
    WORKSPACE_PATH="${CWD_OVERRIDE:-$PWD}"
    INIT_ARGS="$INIT_ARGS --cwd=$WORKSPACE_PATH"
    if [ -z "$NAME" ]; then NAME="alfred-shared-$(date +%F)"; fi
    if [ -z "${ALFRED_MEMORY_DB:-}" ]; then
      printf "[alfred] 'both' profile requires a Postgres connection. Set ALFRED_MEMORY_DB=postgres://user:pass@host/db or pass --db-connection.\n" 1>&2
      if [ -t 0 ]; then
        printf "Postgres URL: "
        read -r DB_URL
      else
        DB_URL=""
      fi
      if [ -z "$DB_URL" ]; then
        err "No Postgres URL provided. Set ALFRED_MEMORY_DB and re-run."
      fi
      export ALFRED_MEMORY_DB="$DB_URL"
    fi
    INIT_ARGS="$INIT_ARGS --db-connection=$ALFRED_MEMORY_DB"
    ;;
  *) err "Unknown profile: $PROFILE (use coding, web, or both)" ;;
esac

log "Running: alfred init $INIT_ARGS"
log "(registry: $REGISTRY_PATH)"

INIT_OUTPUT="$(cd "$TARGET_PATH" && node packages/memory-server/scripts/alfred.mjs init $INIT_ARGS 2>&1)" || {
  printf '%s\n' "$INIT_OUTPUT" 1>&2
  err "alfred init failed"
}
printf '%s\n' "$INIT_OUTPUT"

preview_model_assignment
if [ "$ACCEPT_MODEL_DEFAULTS" = true ] && [ "$SKIP_MODELS" != true ]; then
  write_model_assignment
else
  log "Model assignment preview only. Re-run with --accept-model-defaults to write ~/.alfred/models.json."
fi

# Capture the API key from the JSON output.
API_KEY="$(printf '%s\n' "$INIT_OUTPUT" | grep -oE '"api_key": *"alk_[A-Za-z0-9_]+' | head -1 | sed 's/.*"alk_/alk_/' | tr -d ' ')"

if [ "$START_SERVER" = true ]; then
  log "Starting alfred-memory server in background (logs: $TARGET_PATH/alfred-server.log)"
  nohup node "$TARGET_PATH/packages/memory-server/scripts/serve.mjs" \
    >"$TARGET_PATH/alfred-server.log" 2>&1 &
  disown 2>/dev/null || true
  log "Server starting. After ~1s, health check: curl http://localhost:3000/health"
fi

cat <<EOF

==============================================================
ALFRED MEMORY INSTALLED
==============================================================

Repository:    $TARGET_PATH
Registry:      $REGISTRY_PATH
Profile:       $PROFILE
API key:       ${API_KEY:-<not captured>}

NEXT STEPS
EOF

case "$PROFILE" in
  web)
    cat <<EOF2
  - For ChatGPT: my GPTs > Create > Actions > Import
    $TARGET_PATH/packages/chatgpt-adapter/openapi.json
    Auth: API Key, Bearer, value=\$API_KEY
  - For Claude Desktop: edit claude_desktop_config.json and add:
    {"mcpServers": {"alfred-memory": {"command": "node", "args": ["$TARGET_PATH/packages/anthropic-adapter/bin/alfred-mcp.mjs"], "env": {"ALFRED_MEMORY_API_KEY": "\$API_KEY"}}}}
  - For Gemini / AI Studio: Tools > Extensions > Import
    $TARGET_PATH/packages/gemini-adapter/openapi.json
    Auth: API Key, header x-api-key, value=\$API_KEY
  - Run a server: $TARGET_PATH/scripts/serve.sh
  - Get another key: alfred keys issue --tenant <id>
EOF2
    ;;
  coding|both)
    cat <<EOF2
  - Your config is in \$(pwd)/.alfred/config.json
  - Run a server: $TARGET_PATH/scripts/serve.sh
  - Wire ChatGPT/Claude/Gemini with: alfred adapters instructions <name>
EOF2
    ;;
esac

cat <<EOF3
  - Issue another key:   alfred keys issue --tenant <id>
  - Show all tenants:    alfred list
  - Validate policy:     alfred validate-policy
  - Migrate data:        alfred migrate --from sqlite --to postgres --tenant <id>

Get help:        alfred --help
EOF3
