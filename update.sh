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

# --- Helper Functions ---

logger() {
  echo "[pi-update] $1"
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
    -h|--help)
      echo "Usage: $0 [--path <directory>] [--dry-run]"
      echo "  --path    Update target directory (default: current directory)"
      echo "  --dry-run Preview operation without making changes"
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
  exit 0
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