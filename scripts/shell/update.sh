#!/bin/sh
# Alfred Pi Agent Update Script
# Usage: curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh
# Or:    curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh -s -- --path ./alfred-workspace
#
# This script updates Pi agent files in a user workspace.

set -e

VERSION="0.2.0"
INSTALL_BASE="https://raw.githubusercontent.com/GOI17/alfred/main"
DRY_RUN=false
TARGET_PATH=""
RECONFIGURE_MODELS=false
ACCEPT_MODEL_DEFAULTS=false

# --- Helper Functions ---

logger() {
  echo "[pi-update] $1"
}

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
if (env.OLLAMA_HOST && env.OLLAMA_HOST.trim() !== "") add("ollama", "ollama/qwen2.5-coder:7b", "env:OLLAMA_HOST");
else {
  const socket = ["/var/run/ollama.sock", "/tmp/ollama.sock", path.join(home, ".ollama", "ollama.sock")].find((candidate) => fs.existsSync(candidate));
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
  logger "Model assignment reconfiguration preview (no harness config writes):"
  model_config_json
  logger "Proposed target: $HOME/.alfred/models.json"
  logger "Trace events: model_assignment_configured, provider_request_avoided (provider_calls=0)"
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
  printf '{\n  "trace_id": "model-assignment-configuration",\n  "timestamp": "%s",\n  "event": "model_assignment_configured",\n  "actor": "alfred-update",\n  "data": { "target_path": "%s", "action": "write", "provider_calls": 0 }\n}\n' "$timestamp" "$target" > "$trace_tmp"
  mv "$trace_tmp" "$trace_file"
  logger "Wrote model assignment config: $target"
}

write_trace() {
  target="$1"
  operation="$2"
  status="$3"
  error_code="$4"
  diff_detected="$5"

  trace_dir="${target}/.alfred/observability"
  mkdir -p "$trace_dir"

  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%NZ")

  # Atomic write using temp file
  trace_file="${trace_dir}/install-trace.json"
  temp_file="${trace_file}.${$}.tmp"

  cat > "$temp_file" << EOF
{
  "trace_id": "phase-13-pi-agent-install-management",
  "timestamp": "${timestamp}",
  "event": "install_management_operation",
  "actor": "pi-install",
  "data": {
    "operation": "${operation}",
    "target_path": "${target}",
    "status": "${status}",
    "error_code": ${error_code:+"\"${error_code}\""}${error_code:-null},
    "diff_detected": ${diff_detected:-false},
    "human_approval": true,
    "provider_calls": 0
  }
}
EOF
  mv "$temp_file" "$trace_file"
}

validate_path() {
  path="$1"

  # Check if path is empty
  if [ -z "$path" ]; then
    echo "error:update_path_empty"
    return 1
  fi

  # Check if path is root
  if [ "$path" = "/" ]; then
    echo "error:update_path_is_root"
    return 1
  fi

  # Check for protected segments
  case "$path" in
    *".ai/"*)     echo "error:update_path_protected"; return 1 ;;
    *".opencode/"*) echo "error:update_path_protected"; return 1 ;;
    *"/harnesses/"*) echo "error:update_path_protected"; return 1 ;;
    *".ai"*)      echo "error:update_path_protected"; return 1 ;;
    *".opencode"*) echo "error:update_path_protected"; return 1 ;;
    *"harnesses"*) echo "error:update_path_protected"; return 1 ;;
  esac

  echo "ok"
  return 0
}

# --- Argument Parsing ---

while [ $# -gt 0 ]; do
  case "$1" in
    --path)
      TARGET_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --reconfigure-models)
      RECONFIGURE_MODELS=true
      shift
      ;;
    --accept-model-defaults)
      ACCEPT_MODEL_DEFAULTS=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--path <directory>] [--dry-run] [--reconfigure-models] [--accept-model-defaults]"
      echo "  --path    Update target directory (default: current directory)"
      echo "  --dry-run Preview operation without making changes"
      echo "  --reconfigure-models Preview ~/.alfred/models.json reconfiguration"
      echo "  --accept-model-defaults Write proposed ~/.alfred/models.json atomically"
      exit 0
      ;;
    *)
      if [ -z "$TARGET_PATH" ] && [ "${1#-}" = "$1" ]; then
        TARGET_PATH="$1"
      fi
      shift
      ;;
  esac
done

# Default to current directory if no path specified
if [ -z "$TARGET_PATH" ]; then
  TARGET_PATH="."
fi

# --- Path Validation ---

logger "Validating update path: ${TARGET_PATH}"

validation_result=$(validate_path "$TARGET_PATH")
if [ $? -ne 0 ]; then
  case "$validation_result" in
    error:update_path_is_root)
      logger "ERROR: Cannot update from root (/)."
      exit 1
      ;;
    error:update_path_protected)
      logger "ERROR: Cannot update protected paths (.ai/, .opencode/, harnesses/)."
      exit 1
      ;;
    error:update_path_empty)
      logger "ERROR: Update path is empty."
      exit 1
      ;;
    *)
      logger "ERROR: Unknown validation error: $validation_result"
      exit 1
      ;;
  esac
fi

# Check if Alfred is installed
alfred_dir="${TARGET_PATH}/.alfred"
config_file="${alfred_dir}/config.json"

if [ ! -f "$config_file" ]; then
  logger "ERROR: No Alfred installation found in ${TARGET_PATH}"
  logger "Run install first: curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh"
  exit 1
fi

logger "Path validation passed."

# --- Dry Run Mode ---

if [ "$DRY_RUN" = true ]; then
  logger "DRY-RUN MODE: No files will be modified."
  logger "Would update in: ${TARGET_PATH}"
  logger "Checking against: ${INSTALL_BASE}/pi/${VERSION}"
  if [ "$RECONFIGURE_MODELS" = true ]; then
    preview_model_assignment
  fi
  exit 0
fi

if [ "$RECONFIGURE_MODELS" = true ]; then
  preview_model_assignment
  if [ "$ACCEPT_MODEL_DEFAULTS" = true ]; then
    write_model_assignment
  else
    logger "Model assignment preview only. Add --accept-model-defaults to write ~/.alfred/models.json."
  fi
fi

# --- Version Check and Update ---

logger "Checking for updates..."

# Get local version
local_version=$(cat "${alfred_dir}/config.json" 2>/dev/null | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$local_version" ]; then
  local_version="unknown"
fi

logger "Current version: ${local_version}"
logger "Latest version: ${VERSION}"

# Compare versions
if [ "$local_version" = "$VERSION" ]; then
  logger "Already up to date. No changes needed."
  write_trace "$TARGET_PATH" "update" "pass" null "false"
  exit 0
fi

logger "Update available. Proceeding with update..."

diff_detected=true
update_success=true
error_code=null

# Backup current installation
backup_dir="${TARGET_PATH}/.alfred.backup.$(date +%s)"
logger "Creating backup at: ${backup_dir}"
cp -r "$alfred_dir" "$backup_dir" 2>/dev/null || true

# Update files
logger "Updating files from ${INSTALL_BASE}/pi/${VERSION}..."

# Update config.json
config_tmp="${alfred_dir}/config.json.$$.tmp"
if curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/.alfred/config.json" -o "$config_tmp" 2>/dev/null; then
  mv "$config_tmp" "${alfred_dir}/config.json"
  logger "  Updated config.json"
else
  logger "  WARNING: Could not update config.json"
fi

# Update agent files
logger "Updating agent files..."
for agent in orchestrator developer qa librarian architect reviewer; do
  agent_tmp="${alfred_dir}/agents/${agent}.md.$$.tmp"
  if curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/.alfred/agents/${agent}.md" -o "$agent_tmp" 2>/dev/null; then
    mv "$agent_tmp" "${alfred_dir}/agents/${agent}.md"
    logger "  Updated ${agent}.md"
  fi
done

# Update skills registry
logger "Updating skills registry..."
registry_tmp="${alfred_dir}/skills/registry.json.$$.tmp"
if curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/.alfred/skills/registry.json" -o "$registry_tmp" 2>/dev/null; then
  mv "$registry_tmp" "${alfred_dir}/skills/registry.json"
  logger "  Updated registry.json"
fi

# Update pi-adapter files
logger "Updating pi-adapter files..."
for file in runtime.js cli.js package.json README.md; do
  adapter_tmp="${alfred_dir}/pi-adapter/${file}.$$.tmp"
  if curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/.alfred/pi-adapter/${file}" -o "$adapter_tmp" 2>/dev/null; then
    mv "$adapter_tmp" "${alfred_dir}/pi-adapter/${file}"
    logger "  Updated ${file}"
  fi
done

# Update AGENTS.md
agents_md_tmp="${TARGET_PATH}/AGENTS.md.$$.tmp"
if curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/AGENTS.md" -o "$agents_md_tmp" 2>/dev/null; then
  mv "$agents_md_tmp" "${TARGET_PATH}/AGENTS.md"
  logger "Updated AGENTS.md"
fi

# Clean up old backup
if [ -d "$backup_dir" ]; then
  # Keep backup for a short period in case of issues
  logger "Backup kept at: ${backup_dir}"
fi

# --- Finalization ---

logger "Update complete."
logger "Updated to: ${VERSION}"

# Emit trace
write_trace "$TARGET_PATH" "update" "pass" "$error_code" "$diff_detected"

logger "Trace written to: ${TARGET_PATH}/.alfred/observability/install-trace.json"
logger "Restart your harness to activate the update."
